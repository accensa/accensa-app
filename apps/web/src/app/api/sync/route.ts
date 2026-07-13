import { NextResponse } from 'next/server';
import { Client } from 'pg';

const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const MERCHANT_CONTRACT = "CDP76EZKUOMRZMETU4CR276SHBMNBTIZDIM7GJEESTX3CJEXXBTTSWBV";

export async function GET() {
  const dbUrl = "postgresql://postgres:@Basirat031@db.ialomdzbhjzizojvbady.supabase.co:5432/postgres";
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
        params: { startLedger: startLedger, filters: [{ type: "contract", contractIds: [MERCHANT_CONTRACT] }] }
      })
    });
    const eventsData = await eventsRes.json();
    const events = eventsData.result?.events || [];

    await client.connect();
    
    let inserted = 0;
    for (const event of events) {
      const txHash = event.txHash || "unknown";
      const amount = 100.00;
      const payer = "G..." + MERCHANT_CONTRACT.substring(MERCHANT_CONTRACT.length - 4);
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
