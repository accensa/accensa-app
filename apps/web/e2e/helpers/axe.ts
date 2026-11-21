import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Shared axe runner for the accessibility gates (#791).
 *
 * `e2e/a11y.spec.ts` has its own copy of this logic and is deliberately not
 * refactored to import from here: its allowlist handling belongs to another
 * issue, and rewriting a passing gate to make a new one possible is how a
 * green suite picks up an unrelated regression. New specs import this file.
 *
 * ## Allowlisting
 *
 * A violation may be carried rather than fixed, but only with a tracker: every
 * entry names the rule, the surface it lands on, a reason, **and** the open
 * issue that will remove it. {@link IssueUrl} is a template literal type, so an
 * entry without a real issue URL does not compile — "temporarily disabled" is
 * not expressible here.
 *
 * The list is a record of known defects, not a severity threshold: nothing here
 * silences a whole category of finding forever, and when the linked issue lands
 * the entry must be deleted so the rule starts failing again. Entries that stop
 * being reported are logged as stale on each run, so the list cannot quietly
 * grow past the defects it describes.
 */

/** A tracker URL. Any other string is a type error, by construction. */
export type IssueUrl = `https://github.com/accensa/accensa-app/issues/${number}`;

export interface AllowlistEntry {
  /** axe rule id, e.g. `color-contrast`. */
  rule: string;
  /** The element or surface the violation applies to, for the log line. */
  element: string;
  /** The open issue that tracks the fix. Required — see {@link IssueUrl}. */
  issue: IssueUrl;
  /** Why the violation is tolerated until that issue lands. */
  reason: string;
}

export type Allowlist = readonly AllowlistEntry[];

/** What a failing run prints: rule id, impact and up to three element targets. */
export interface ViolationSummary {
  rule: string;
  impact: string;
  help: string;
  elements: string[];
  helpUrl: string;
}

/** A violation that was carried by the allowlist, for the summary log. */
export interface AllowlistedViolation {
  rule: string;
  element: string;
  issue: IssueUrl;
  reason: string;
  elements: string[];
}

export interface AxeSummary {
  /** Violations that were neither fixed nor allowlisted. Empty on success. */
  violations: ViolationSummary[];
  /** Violations that were carried by the allowlist. */
  allowlisted: AllowlistedViolation[];
}

/**
 * Run axe over the current page and fail on any violation that is not carried
 * by `allowlist`.
 *
 * `label` names the surface in the failure message, the way `a11y.spec.ts`
 * does, so a red run says where to look without reading the diff.
 */
export async function runAxe(
  page: Page,
  label: string,
  allowlist: Allowlist = [],
): Promise<AxeSummary> {
  const byRule = new Map(allowlist.map((entry) => [entry.rule, entry] as const));
  const results = await new AxeBuilder({ page }).analyze();

  const allowlisted: AllowlistedViolation[] = [];
  const violations: ViolationSummary[] = [];

  for (const violation of results.violations) {
    const elements = violation.nodes.map((node) => node.target.join(' '));
    const entry = byRule.get(violation.id);

    if (entry) {
      allowlisted.push({
        rule: violation.id,
        element: entry.element,
        issue: entry.issue,
        reason: entry.reason,
        elements,
      });
      console.log(
        `[allowlist] ${label}: ${violation.id} on "${entry.element}" ` +
          `(${violation.impact}) — tracked: ${entry.issue}`,
      );
      continue;
    }

    violations.push({
      rule: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      helpUrl: violation.helpUrl,
      elements: elements.slice(0, 3),
    });
  }

  // An entry that no longer matches anything is a rule silently switched off
  // for a defect that has been fixed. Warn rather than fail: axe classifies
  // some results as `incomplete` depending on the browser, and a stale warning
  // is cheap to read while a false red is not.
  const reported = new Set(results.violations.map((violation) => violation.id));
  for (const entry of allowlist) {
    if (!reported.has(entry.rule)) {
      console.warn(
        `[allowlist:stale?] ${label}: no "${entry.rule}" violation was reported. ` +
          `If that defect is fixed, drop the entry and close out ${entry.issue}.`,
      );
    }
  }

  expect(
    violations,
    `Accessibility violations on ${label}:\n` +
      violations
        .map(
          (violation) =>
            `- ${violation.rule} (${violation.impact}): ${violation.help} on ` +
            `${violation.elements.join(', ')}\n  ${violation.helpUrl}`,
        )
        .join('\n'),
  ).toEqual([]);

  return { violations, allowlisted };
}
