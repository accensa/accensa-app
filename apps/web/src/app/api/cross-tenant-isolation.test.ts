/**
 * Proves that no endpoint can return one merchant's data to another.
 *
 * The fake database below behaves the way Postgres does once
 * migrations/004_multi_merchant.sql is applied: `payments` carries rows for
 * two merchants, and any query that does not filter on `merchant_id` gets
 * back nothing at all — that is what `FORCE ROW LEVEL SECURITY` guarantees
 * even if an application-level `WHERE` clause were ever dropped by mistake.
 * A query that filters on the *wrong* merchant_id also gets back nothing,
 * which is what proves isolation rather than mere correctness.
 *
 * This exercises every read endpoint that touches `payments`: GET
 * /api/payments and GET /api/routes. GET /api/sync's cursor isolation is
 * covered separately in db.ts (per-merchant sync_state), and POST
 * /api/hook/settle's isolation is that the *signature* — not caller input —
 * selects the merchant, covered in hook/settle/route.test.ts.
 *
 * The second block covers `zk_commitments` (#586), the zero-knowledge
 * commitment ledger: its isolation is now the database's, not just the
 * application's — ENABLE + FORCE ROW LEVEL SECURITY with an
 * `accensa.merchant_id` policy, the same shape as every sibling table. The
 * fake below behaves the way that policy does: the session GUC picks the
 * scope, WITH CHECK raises Postgres' own error on a mismatched write (the
 * policy refuses, application code never gets a say), and reads only ever
 * see rows inside the scope.
 */
import { readFileSync } from 'node:fs';
import { expect, test, vi, describe, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { ensureZkCommitmentsSchema, recordVerifiedCommitment } from '@/lib/zk-ledger';

const MERCHANT_A = { id: 1, address: 'GAAA' };
const MERCHANT_B = { id: 2, address: 'GBBB' };

const PAYMENTS = [
  {
    merchant_id: 1,
    tx_hash: 'a'.repeat(64),
    payer: 'GPAYERA',
    amount: '100',
    asset: 'XLM',
    ts: new Date().toISOString(),
    route: '/a',
    method: 'GET',
  },
  {
    merchant_id: 2,
    tx_hash: 'b'.repeat(64),
    payer: 'GPAYERB',
    amount: '999',
    asset: 'XLM',
    ts: new Date().toISOString(),
    route: '/b',
    method: 'GET',
  },
];

const ROUTE_TOTALS = [
  { merchant_id: 1, route: '/a', method: 'GET', total_revenue: '100', calls: 1 },
  { merchant_id: 2, route: '/b', method: 'GET', total_revenue: '999', calls: 1 },
];

/**
 * Mimics FORCE ROW LEVEL SECURITY plus the app's own WHERE clause: a query
 * without `merchant_id = $1` (or filtering on the wrong id) returns nothing,
 * exactly like a policy that closes instead of leaking on a missing scope.
 */
function fakeQuery(table: { merchant_id: number }[]) {
  return vi.fn(async (sql: string, params: unknown[] = []) => {
    if (!/merchant_id\s*=\s*\$1/.test(sql)) return { rows: [] };
    const merchantId = params[0];
    return { rows: table.filter((row) => row.merchant_id === merchantId) };
  });
}

let currentMerchant: typeof MERCHANT_A | typeof MERCHANT_B;

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: vi.fn(async () => currentMerchant),
}));

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  withMerchantClient: vi.fn(
    async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: currentQuery }),
  ),
  ensureSchema: vi.fn(),
  getSyncState: vi.fn().mockResolvedValue(null),
}));

let currentQuery: ReturnType<typeof fakeQuery>;

describe('cross-tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
  });

  test('GET /api/payments never returns another merchant’s rows', async () => {
    const { GET } = await import('./payments/route');
    currentQuery = fakeQuery(PAYMENTS);

    currentMerchant = MERCHANT_A;
    const resA = await GET(new Request('http://localhost/api/payments'));
    const dataA = await resA.json();
    expect(dataA.payments).toHaveLength(1);
    expect(dataA.payments[0].tx_hash).toBe('a'.repeat(64));

    currentMerchant = MERCHANT_B;
    const resB = await GET(new Request('http://localhost/api/payments'));
    const dataB = await resB.json();
    expect(dataB.payments).toHaveLength(1);
    expect(dataB.payments[0].tx_hash).toBe('b'.repeat(64));

    // Neither response ever contains the other merchant's transaction hash.
    expect(JSON.stringify(dataA)).not.toContain('b'.repeat(64));
    expect(JSON.stringify(dataB)).not.toContain('a'.repeat(64));
  });

  test('GET /api/routes never returns another merchant’s revenue', async () => {
    const { GET } = await import('./routes/route');
    currentQuery = fakeQuery(ROUTE_TOTALS);

    currentMerchant = MERCHANT_A;
    const resA = await GET(new Request('http://localhost/api/routes'));
    const dataA = await resA.json();
    expect(dataA.routes.map((r: { route: string }) => r.route)).toEqual(['/a']);

    currentMerchant = MERCHANT_B;
    const resB = await GET(new Request('http://localhost/api/routes'));
    const dataB = await resB.json();
    expect(dataB.routes.map((r: { route: string }) => r.route)).toEqual(['/b']);
  });

  test('a query that omits the merchant scope returns nothing, not everything', () => {
    const q = fakeQuery(PAYMENTS);
    return q('SELECT * FROM payments', []).then((res) => {
      expect(res.rows).toHaveLength(0);
    });
  });
});

type ZkRow = {
  merchant_id: number;
  commitment: string;
  payload_hash: string;
  proof_scheme: string;
};

/**
 * Mimics `zk_commitments` once migrations/009's row-level security is
 * applied, the same way `fakeQuery` mimics payments': the session's
 * `accensa.merchant_id` GUC *is* the scope, a WITH CHECK violation raises
 * Postgres' own error, and a read sees only rows in scope — no
 * application-level filter decides any of it.
 */
function fakeZkClient() {
  const statements: string[] = [];
  const rows: ZkRow[] = [];
  let sessionMerchant: string | null = null;

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = sql.trim();
      statements.push(text);

      if (/^SELECT current_setting\(/i.test(text)) {
        return { rows: [{ value: sessionMerchant }], rowCount: sessionMerchant === null ? 0 : 1 };
      }
      if (/set_config\(/.test(text)) {
        if (params[0] === 'accensa.merchant_id') sessionMerchant = String(params[1]);
        return { rows: [{ set_config: sessionMerchant }], rowCount: 1 };
      }
      if (/^INSERT INTO zk_commitments/i.test(text)) {
        const [merchantId, commitment, payloadHash, scheme] = params as [
          number,
          string,
          string,
          string,
        ];
        // WITH CHECK — the policy refuses, not application code.
        if (sessionMerchant !== String(merchantId)) {
          throw new Error('new row violates row-level security policy for table "zk_commitments"');
        }
        const already = rows.find(
          (row) => row.merchant_id === merchantId && row.commitment === commitment,
        );
        if (already) return { rows: [], rowCount: 0 };
        rows.push({
          merchant_id: merchantId,
          commitment,
          payload_hash: payloadHash,
          proof_scheme: scheme,
        });
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT .* FROM zk_commitments/is.test(text)) {
        // USING — rows outside the session's scope do not exist for it,
        // whatever the query text says.
        const scoped =
          sessionMerchant === null
            ? []
            : rows.filter((row) => String(row.merchant_id) === sessionMerchant);
        return { rows: scoped, rowCount: scoped.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return {
    client: client as unknown as Client,
    statements,
    rows,
    scopeTo(merchantId: number | null) {
      sessionMerchant = merchantId === null ? null : String(merchantId);
    },
    session() {
      return sessionMerchant;
    },
  };
}

describe('zk_commitments row-level isolation', () => {
  const commitmentA = 'a'.repeat(64);
  const commitmentB = 'b'.repeat(64);
  const commitmentC = 'c'.repeat(64);
  const proof = (commitment: string) => ({
    commitment,
    payloadHash: 'd'.repeat(64),
    scheme: 'sha256-commitment-opening',
  });

  test('the migration and ensureZkCommitmentsSchema carry the same ENABLE + FORCE + policy statements', async () => {
    const zk = fakeZkClient();
    await ensureZkCommitmentsSchema(zk.client);

    const runtimeDdl = zk.statements.join('\n');
    const migration = readFileSync(
      new URL('../../../../../migrations/009_zk_commitments.sql', import.meta.url),
      'utf8',
    );

    for (const source of [runtimeDdl, migration]) {
      expect(source).toContain('ALTER TABLE zk_commitments ENABLE ROW LEVEL SECURITY;');
      // FORCE: the table owner — the role the app connects as — is not
      // exempt, exactly like role_tuples and merchant_stores.
      expect(source).toContain('ALTER TABLE zk_commitments FORCE ROW LEVEL SECURITY;');
      expect(source).toContain(
        'DROP POLICY IF EXISTS zk_commitments_merchant_isolation ON zk_commitments;',
      );
      expect(source).toContain('CREATE POLICY zk_commitments_merchant_isolation ON zk_commitments');
      expect(source).toContain(
        "USING (merchant_id = current_setting('accensa.merchant_id', true)::int)",
      );
      expect(source).toContain(
        "WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int)",
      );
      // Isolation only: the constraint and index this issue must not disturb.
      expect(source).toContain('zk_commitments_unique_commitment');
      expect(source).toContain('idx_zk_commitments_merchant_verified');
    }
  });

  test('merchant A can insert and read back a proof while the session is scoped to A', async () => {
    const zk = fakeZkClient();
    await ensureZkCommitmentsSchema(zk.client);

    // The proofs route resolves the merchant from the session but never sets
    // the GUC itself — the write path must scope the session, or FORCE RLS
    // would refuse every insert (the #508 failure mode).
    expect(zk.session()).toBeNull();

    await expect(
      recordVerifiedCommitment(zk.client, MERCHANT_A.id, proof(commitmentA)),
    ).resolves.toEqual({ recorded: true });
    expect(zk.session()).toBe(String(MERCHANT_A.id));
    expect(zk.rows).toHaveLength(1);

    const readBack = await zk.client.query('SELECT * FROM zk_commitments WHERE commitment = $1', [
      commitmentA,
    ]);
    expect(readBack.rows).toHaveLength(1);
    expect(readBack.rows[0]).toMatchObject({
      merchant_id: MERCHANT_A.id,
      commitment: commitmentA,
      proof_scheme: 'sha256-commitment-opening',
    });

    // The unique (merchant_id, commitment) key still makes a re-submit a
    // no-op rather than a duplicate.
    await expect(
      recordVerifiedCommitment(zk.client, MERCHANT_A.id, proof(commitmentA)),
    ).resolves.toEqual({ recorded: false });
    expect(zk.rows).toHaveLength(1);
  });

  test('a session scoped to merchant B is refused by the policy rather than by application code', async () => {
    const zk = fakeZkClient();
    await ensureZkCommitmentsSchema(zk.client);
    await recordVerifiedCommitment(zk.client, MERCHANT_A.id, proof(commitmentA));

    zk.scopeTo(MERCHANT_B.id);

    // B writes its own commitment: the policy is a scope, not a lockout.
    await expect(
      recordVerifiedCommitment(zk.client, MERCHANT_B.id, proof(commitmentB)),
    ).resolves.toEqual({ recorded: true });

    // A write for merchant A on B's session: the already-set GUC is not
    // silently re-scoped, and the refusal is Postgres' WITH CHECK error —
    // no application-level filter stood in the way.
    await expect(
      recordVerifiedCommitment(zk.client, MERCHANT_A.id, proof(commitmentC)),
    ).rejects.toThrow(/row-level security policy/);
    expect(zk.session()).toBe(String(MERCHANT_B.id));

    // Reads for B see only B's rows: A's proof does not exist for this
    // session, and neither does anything an unscoped session would see.
    const read = await zk.client.query('SELECT * FROM zk_commitments', []);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]).toMatchObject({ merchant_id: MERCHANT_B.id });

    zk.scopeTo(null);
    const unscoped = await zk.client.query('SELECT * FROM zk_commitments', []);
    expect(unscoped.rows).toHaveLength(0);
  });
});
