import { NextResponse } from 'next/server';
import { withClient } from '@/lib/db';
import type { ServiceHealth } from '@/lib/status/healthChecker';

export const dynamic = 'force-dynamic';

async function checkRpc(): Promise<ServiceHealth> {
  const endpoint = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger', params: {} }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return 'unavailable';
    const result = await response.json();
    return result.result?.sequence ? 'operational' : 'degraded';
  } catch {
    return 'unavailable';
  }
}

async function checkIndexer(): Promise<ServiceHealth> {
  if (!process.env.DATABASE_URL) return 'unavailable';
  try {
    await withClient((client) => client.query('SELECT 1'));
    return 'operational';
  } catch {
    return 'unavailable';
  }
}

async function checkRelayer(): Promise<ServiceHealth> {
  const endpoint = process.env.FACILITATOR_URL;
  if (!endpoint) return 'unknown';
  try {
    const response = await fetch(new URL('/health', endpoint), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? 'operational' : 'degraded';
  } catch {
    return 'unavailable';
  }
}

export async function GET() {
  const [rpc, indexer, relayer] = await Promise.all([checkRpc(), checkIndexer(), checkRelayer()]);
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    services: { rpc, indexer, relayer },
  });
}
