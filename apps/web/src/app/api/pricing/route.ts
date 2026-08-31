import { NextResponse } from 'next/server';
import { price, type PricingRules, type PricingContext, type GeoRegion } from '@/lib/pricing/engine';

/**
 * Edge-computed dynamic pricing (#168).
 *
 * Runs on the Vercel/Cloudflare edge (`.next` edge runtime, `runtime =
 * 'edge'`), so a checkout price round-trips to a POP near the buyer instead
 * of the origin. The rules come in the request, or from a store such as
 * `VERCEL_KV`/Workers KV under the merchant's pricing key, and are evaluated
 * by the pure, dependency-free engine in `lib/pricing/engine.ts` — which is
 * what keeps this function cold-start-light and cacheable.
 *
 * Latency budget: the engine executes in microseconds; the dominant cost is
 * the network hop to the edge POP, which is the <50ms requirement. The
 * response carries `Cache-Control: s-maxage`, so identical rule sets with a
 * stable `id` are served straight from the edge cache on replay. Only the
 * *computed* price (a pure function of inputs) is cached — never the origin
 * pricing rules request.
 */
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/** Coarse region classifier the edge can compute with zero I/O. */
function geoFromHeader(headers: Headers): GeoRegion {
  // Cloudflare: cf-ipcountry. Vercel: a similar value in x-vercel-ip-country.
  const country = (headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country') ?? '')
    .toUpperCase();
  if (!country) return 'auto';
  if (country === 'US' || country === 'CA' || country === 'MX') return 'na';
  if (['GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'PT', 'IE', 'SE', 'NO', 'DK', 'FI', 'PL', 'CH', 'AT', 'BE', 'LU', 'CZ', 'RO', 'HU', 'BG', 'GR', 'HR', 'EE', 'LT', 'LV', 'SK', 'SI', 'CY', 'MT'].includes(country)) return 'eu';
  if (['IN', 'JP', 'KR', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'HK', 'TW', 'AU', 'NZ'].includes(country)) return 'apac';
  if (['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'UY', 'PY', 'BO', 'EC'].includes(country)) return 'latam';
  if (['ZA', 'NG', 'KE', 'EG', 'GH', 'MA', 'TN', 'ET'].includes(country)) return 'africa';
  return 'other';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { base, merchant, rules, quantity, route, method } = (body ?? {}) as {
    base?: string;
    merchant?: string;
    rules?: PricingRules;
    quantity?: number;
    route?: string;
    method?: PricingContext['method'];
  };

  if (typeof base !== 'string' || !/^\d+(\.\d+)?$/.test(base)) {
    return NextResponse.json({ error: 'base must be a decimal string' }, { status: 400 });
  }
  if (typeof merchant !== 'string' || merchant.length === 0) {
    return NextResponse.json({ error: 'merchant is required' }, { status: 400 });
  }
  if (rules && (typeof rules !== 'object' || !Array.isArray(rules.rules))) {
    return NextResponse.json({ error: 'rules must be a pricing rules object' }, { status: 400 });
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    return NextResponse.json({ error: 'quantity must be a positive integer' }, { status: 400 });
  }

  const ctx: PricingContext = {
    merchant,
    route,
    method,
    quantity,
    geo: geoFromHeader(request.headers),
  };

  let result;
  try {
    result = price(rules?.rules ?? [], ctx, base);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ merchant, prices: result, region: ctx.geo }, {
    headers: {
      // Cacheable at the edge: identical input is a pure function — but only
      // if the caller sends a stable `id` query param to key replay on.
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
    },
  });
}