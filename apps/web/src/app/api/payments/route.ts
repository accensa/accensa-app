import { NextResponse } from 'next/server';
import { Client } from 'pg';

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 500 });
  }

  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT tx_hash, amount, payer, timestamp FROM payments ORDER BY timestamp DESC LIMIT 100`
    );
    return NextResponse.json(result.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await client.end().catch(console.error);
  }
}
