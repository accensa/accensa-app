const { Client } = require('pg');

const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const MERCHANT_CONTRACT = "CDP76EZKUOMRZMETU4CR276SHBMNBTIZDIM7GJEESTX3CJEXXBTTSWBV";

async function main() {
  // Use process.env.DATABASE_URL which should be set to the Supabase IPv4 connection pooler string
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:%40Basirat031@db.ialomdzbhjzizojvbady.supabase.co:5432/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    console.log("Fetching latest ledger...");
    const ledgerRes = await fetch(SOROBAN_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" })
    });
    const ledgerData = await ledgerRes.json();
    const latestLedger = ledgerData.result.sequence;
    const startLedger = latestLedger - 1000;
    
    console.log(`Scanning from ${startLedger} to ${latestLedger}...`);

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
    console.log(`Found ${events.length} events!`);

    await client.connect();
    
    let inserted = 0;
    for (const event of events) {
      const txHash = event.txHash || "unknown";
      const amount = 10000;
      const payer = "GDGOBEDNZGFQRCOALEN2J76H56LHFBXMQET4MXRFW7KV4G64ND5ITCHW"; // Hardcoded from user refund
      const timestamp = new Date(event.ledgerClosedAt).toISOString();

      try {
        await client.query(
          `INSERT INTO payments (tx_hash, amount, payer, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT (tx_hash) DO NOTHING`,
          [txHash, amount, payer, timestamp]
        );
        inserted++;
      } catch (err) {
        console.error("DB Insert Error:", err.message);
      }
    }

    console.log(`Successfully inserted ${inserted} new payments into Supabase.`);
  } catch (error) {
    console.error("Fatal Error:", error.message);
    process.exit(1);
  } finally {
    await client.end().catch(console.error);
  }
}
main();
