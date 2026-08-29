// The single source of truth, in code, for which `payments` columns this tool
// can and cannot vouch for. Every report this package produces renders this
// table, rather than leaving a reader to infer the boundary - see issue #170:
// "That distinction is exactly what this issue should make explicit and
// testable, rather than paper over."

/**
 * @typedef {'chain' | 'merchant-reported'} Provenance
 */

/** @type {{ column: string, provenance: Provenance, note: string }[]} */
export const COLUMN_PROVENANCE = [
  {
    column: 'tx_hash',
    provenance: 'chain',
    note: 'The Stellar transaction hash. Reconstructed and compared.',
  },
  {
    column: 'ledger',
    provenance: 'chain',
    note: 'Ledger sequence the transfer closed in. Reconstructed and compared.',
  },
  {
    column: 'payer',
    provenance: 'chain',
    note: 'SAC transfer `from` address. Reconstructed and compared.',
  },
  {
    column: 'amount',
    provenance: 'chain',
    note: 'SAC transfer i128 amount, as stroops. Reconstructed and compared.',
  },
  {
    column: 'asset',
    provenance: 'chain',
    note: 'SEP-11 asset identifier from the transfer topic. Reconstructed and compared.',
  },
  {
    column: 'ts',
    provenance: 'chain',
    note: 'Ledger close time. Reconstructed and compared.',
  },
  {
    column: 'route',
    provenance: 'merchant-reported',
    note:
      'Which HTTP endpoint was paid for. Not present anywhere in a SAC transfer event - only ' +
      "the merchant's own server knows what it sold. Reported via POST /api/hook/settle. " +
      'NOT reconstructed; excluded from this report by design.',
  },
  {
    column: 'method',
    provenance: 'merchant-reported',
    note: 'HTTP method of the paid route. Same provenance and exclusion as `route`.',
  },
  {
    column: 'request_id',
    provenance: 'merchant-reported',
    note: "The merchant's own request identifier. Same provenance and exclusion as `route`.",
  },
  {
    column: 'hook_reported_at',
    provenance: 'merchant-reported',
    note: 'When the merchant-reported columns were recorded. Same provenance and exclusion.',
  },
];

export const RECONSTRUCTED_COLUMNS = COLUMN_PROVENANCE.filter((c) => c.provenance === 'chain').map(
  (c) => c.column,
);

export const EXCLUDED_COLUMNS = COLUMN_PROVENANCE.filter(
  (c) => c.provenance === 'merchant-reported',
).map((c) => c.column);

/** Renders the provenance table as plain text for a CLI/CI report. */
export function renderTrustBoundary() {
  const lines = ['Trust boundary (per column):', ''];
  for (const { column, provenance, note } of COLUMN_PROVENANCE) {
    const tag = provenance === 'chain' ? '[chain, reconstructed]' : '[merchant-reported, excluded]';
    lines.push(`  ${column.padEnd(18)} ${tag}`);
    lines.push(`    ${note}`);
  }
  return lines.join('\n');
}
