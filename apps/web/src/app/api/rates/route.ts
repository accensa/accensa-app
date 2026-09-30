import { NextResponse } from 'next/server';
import { getExchangeRates } from '@/lib/rates/exchangeRateService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getExchangeRates(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Exchange rates are temporarily unavailable' },
      { status: 503 },
    );
  }
}
