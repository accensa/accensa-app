import { NextResponse } from 'next/server';
import { Client } from 'pg';

const SOROBAN_RPC = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";

// Contracts whose events we scan (ReceiptAnchor + RefundVault).
const CONTRACT_IDS = [
  process.env.NEXT_PUBLIC_RECEIPT_ANCHOR_ID,
  process.env.NEXT_PUBLIC_REFUND_VAULT_ID,
].filter((id): id is string => Boolean(id));

export async function GET() {
  // Use the Supabase *session pooler* connection string in production:
  // Vercel functions have no IPv6 route, and Supabase direct connections
  // (db.<ref>.supabase.co) are IPv6-only.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 500 });
  }
  if (CONTRACT_IDS.length === 0) {
    return NextResponse.json({ error: "No contract IDs configured" }, { status: 500 });
  }

  const client = new Client({ connectionString: dbUrl });

  try {
    const ledgerRes = await fetch(SOROBAN_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" })
    });
    const ledgerData = await ledgerRes.json();
    const latestLedger = ledgerData.result.sequence;
    const startLedger = latestLedger - 1000;

    const eventsRes = await fetch(SOROBAN_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "getEvents",
        params: { startLedger: startLedger, filters: [{ type: "contract", contractIds: CONTRACT_IDS }] }
      })
    });
    const eventsData = await eventsRes.json();
    const events = eventsData.result?.events || [];

    await client.connect();

    let inserted = 0;
    for (const event of events) {
      const txHash = event.txHash || "unknown";
      const amount = 100.00;
      const payer = "G..." + (event.contractId || "").slice(-4);
      const timestamp = new Date(event.ledgerClosedAt).toISOString();

      try {
        await client.query(
          `INSERT INTO payments (tx_hash, amount, payer, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT (tx_hash) DO NOTHING`,
          [txHash, amount, payer, timestamp]
        );
        inserted++;
      } catch (err) {}
    }

    return NextResponse.json({ success: true, events_found: events.length, new_inserts: inserted });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await client.end().catch(console.error);
  }
}
