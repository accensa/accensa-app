/**
 * Edge pricing engine (#168).
 *
 * The checkout price for a merchant is a function of rules that used to live
 * in the origin server's Node.js API: base price plus markup, volume tiers,
 * region/geography adjustments, and payment-method surcharges. Evaluating
 * that at the origin adds latency for a global buyer on every checkout, so
 * this module moves the evaluation to the CDN edge.
 *
 * Design constraints for edge compatibility:
 *
 * - Pure and deterministic: `price()` is a pure function of (rules, context).
 *   No module-level mutable state, no clocks, no randomness, no `process`,
 *   no Node-only imports. The same inputs always produce the same decimal
 *   output, which is what makes edge caching and `<50ms` global latency
 *   possible.
 * - No `eval`: rules are declarative JSON, so there is no code-injection
 *   surface and nothing to sandbox at runtime — the engine itself is already
 *   the lightweight sandbox. (A Wasm/JS-script variant is unnecessary for the
 *   rule shapes merchants actually set.)
 * - Decimal-safe: amounts are strings end to end and are never float-arithmetic
 *   on the way through. This mirrors `lib/money.ts`: a price tag is a decimal
 *   string, not a number. Rules (markup %, tier thresholds, surcharges) are
 *   themselves tested as exact decimals.
 *
 * The route in `app/api/pricing/route.ts` runs this at the edge with its own
 * edge runtime; the same module stays importable on the origin for tests.
 */

/** Money as a decimal string, e.g. `"123.45"`. Never a float. */
export type DecimalString = string;

/** Geography buckets the edge can cheaply classify from cf-ipcountry. */
export type GeoRegion = 'auto' | 'na' | 'eu' | 'apac' | 'latam' | 'africa' | 'other';

/** HTTP method that generated the request, mirroring the `method` column. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** One declarative markup rule. Applied in order; the first match wins per kind. */
export interface PricingRule {
  /** Machine-readable name, e.g. `volume_tier_1000`. */
  name: string;
  /** Where the rule sits in the evaluation order. Ties fall back to insertion order. */
  priority: number;
  /** Match conditions. Every condition present must hold for the rule to apply. */
  match?: {
    geo?: GeoRegion;
    method?: HttpMethod;
    routePrefix?: string;
    /** Applies only when quantity is at least this. */
    minQuantity?: number;
    /** Applies only when quantity is less than this. */
    maxQuantity?: number;
    /** Applies only when the base price is at least this (decimal string). */
    minBase?: DecimalString;
    /** Applies only when the base price is less than this (decimal string). */
    maxBase?: DecimalString;
  };
  /** What the rule does, once matched. */
  effect:
    | { kind: 'markup_pct'; percent: DecimalString }
    | { kind: 'markup_fixed'; amount: DecimalString }
    | { kind: 'surcharge_pct'; percent: DecimalString }
    | { kind: 'surcharge_fixed'; amount: DecimalString }
    | { kind: 'floor'; amount: DecimalString };
}

/** Everything the edge knows about one checkout attempt. */
export interface PricingContext {
  /** Stellar address of the merchant being paid. */
  merchant: string;
  /** The HTTP route (path) that was paid for, if the caller knows it. */
  route?: string;
  method?: HttpMethod;
  /** Quantity of the purchased good. Defaults to 1. */
  quantity?: number;
  /** Buyer's coarse geo region, classified by the edge. */
  geo?: GeoRegion;
  /** Payment method, e.g. `stellar` (the only one today). */
  methodName?: 'stellar';
}

export interface PriceBreakdown {
  base: DecimalString;
  markup: DecimalString;
  surcharge: DecimalString;
  /** The final total, base + markup + surcharge, floored at 0. */
  total: DecimalString;
  /** Which rules matched, in evaluation order, for observability. */
  applied: { rule: string; effect: string }[];
}

export interface PricingRules {
  rules: PricingRule[];
}

/**
 * Exact decimal arithmetic on string amounts.
 *
 * The engine's contracts (base price, rule amounts, totals) are decimal
 * strings. Working in integer minor units keeps `0.1 + 0.2` exact and mirrors
 * how money.ts treats amounts. `scale` is the number of decimal places the
 * engine preserves (7, matching ledger amounts).
 */
export const PRICE_SCALE = 7;

function parseDecimal(value: DecimalString): bigint {
  const v = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(v)) {
    throw new Error(`PriceEngine: invalid decimal '${v}'`);
  }
  const [int, frac = ''] = v.split('.');
  const padded = (frac + '0'.repeat(PRICE_SCALE)).slice(0, PRICE_SCALE);
  const negative = int.startsWith('-');
  const magnitude = BigInt(`${int.replace('-', '')}${padded}`);
  return negative ? -magnitude : magnitude;
}

function formatDecimal(value: bigint): DecimalString {
  const negative = value < 0n;
  const sign = negative ? '-' : '';
  const abs = negative ? -value : value;
  const str = abs.toString().padStart(PRICE_SCALE + 1, '0');
  const int = str.slice(0, -PRICE_SCALE);
  const frac = str.slice(-PRICE_SCALE).replace(/0+$/, '');
  return `${sign}${int === '' ? '0' : int}${frac ? `.${frac}` : ''}`;
}

function add(a: bigint, b: bigint): bigint {
  return a + b;
}

function multiplyPct(base: bigint, percent: DecimalString): bigint {
  const p = parseDecimal(percent);
  // base * pct / 100, in integer minor units. p is percent * 10^SCALE, so the
  // division is by 100 * 10^SCALE to keep the result in base's units.
  return (base * p) / (100n * 10n ** BigInt(PRICE_SCALE));
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function matches(rule: PricingRule, ctx: PricingContext, base: bigint): boolean {
  const m = rule.match;
  if (!m) return true;
  if (m.geo && ctx.geo !== m.geo) return false;
  if (m.method && ctx.method !== m.method) return false;
  if (m.routePrefix && !(ctx.route ?? '').startsWith(m.routePrefix)) return false;
  if (m.minQuantity !== undefined && (ctx.quantity ?? 1) < m.minQuantity) return false;
  if (m.maxQuantity !== undefined && (ctx.quantity ?? 1) >= m.maxQuantity) return false;
  if (m.minBase !== undefined && base < parseDecimal(m.minBase)) return false;
  if (m.maxBase !== undefined && base >= parseDecimal(m.maxBase)) return false;
  return true;
}

/**
 * Evaluates the pricing rules for one checkout.
 *
 * Rules are sorted by priority (stable for ties) and the first matching rule
 * of each effect *kind* applies; later rules of the same kind are ignored.
 * Markup is added first, then flat surcharges, then the result is floored at
 * zero. Tiers (rules with minQuantity/maxQuantity/minBase/maxBase) apply only
 * to their matched range, which is where cart volume and basket size express
 * themselves.
 *
 * @throws when rules reference an unsupported effect kind or a malformed
 *   decimal — never silently returns a wrong price.
 */
export function price(
  rules: PricingRule[],
  ctx: PricingContext,
  base: DecimalString,
): PriceBreakdown {
  const quantity = ctx.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`PriceEngine: quantity must be a positive integer, got '${quantity}'`);
  }

  const baseMinor = parseDecimal(base) * BigInt(quantity);
  const ordered = [...rules].sort(
    (a, b) => a.priority - b.priority || rules.indexOf(a) - rules.indexOf(b),
  );

  let markup = 0n;
  let surcharge = 0n;
  let markupSeen = false;
  let surchargeSeen = false;
  let floor = -1n;

  const applied: PriceBreakdown['applied'] = [];

  for (const rule of ordered) {
    if (!matches(rule, ctx, baseMinor)) continue;
    switch (rule.effect.kind) {
      case 'markup_pct':
      case 'markup_fixed':
        if (!markupSeen) {
          markup =
            rule.effect.kind === 'markup_pct'
              ? multiplyPct(baseMinor, rule.effect.percent)
              : parseDecimal(rule.effect.amount) * BigInt(quantity);
          markupSeen = true;
          applied.push({
            rule: rule.name,
            effect: `${rule.effect.kind}:${JSON.stringify(rule.effect)}`,
          });
        }
        break;
      case 'surcharge_pct':
      case 'surcharge_fixed':
        if (!surchargeSeen) {
          surcharge =
            rule.effect.kind === 'surcharge_pct'
              ? multiplyPct(baseMinor, rule.effect.percent)
              : parseDecimal(rule.effect.amount) * BigInt(quantity);
          surchargeSeen = true;
          applied.push({
            rule: rule.name,
            effect: `${rule.effect.kind}:${JSON.stringify(rule.effect)}`,
          });
        }
        break;
      case 'floor':
        if (rule.effect.amount !== '0') floor = max(floor, parseDecimal(rule.effect.amount));
        break;
      default: {
        // TypeScript exhaustiveness guard + runtime defence: an unknown effect
        // kind must never silently produce a price.
        const never: never = rule.effect;
        throw new Error(`PriceEngine: unsupported effect '${JSON.stringify(never)}'`);
      }
    }
  }

  let total = add(baseMinor, add(markup, surcharge));
  if (floor > 0n && total < floor) total = floor;

  return {
    base: formatDecimal(baseMinor),
    markup: formatDecimal(markup),
    surcharge: formatDecimal(surcharge),
    total: formatDecimal(max(total, 0n)),
    applied,
  };
}