import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { ensureSchema, withClient } from '@/lib/db';
import { getPublicReceiptShare } from '@/lib/receipt-share';
import { isHash32 } from '@/lib/receipt-anchor';
import { assetLabel, formatAmount } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });
  }
  const txHash = new URL(request.url).searchParams.get('txHash') ?? '';
  if (!isHash32(txHash))
    return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });

  let receipt: Awaited<ReturnType<typeof getPublicReceiptShare>>;
  let avatar: string;
  try {
    receipt = await withClient(async (client) => {
      await ensureSchema(client);
      return getPublicReceiptShare(client, txHash.toLowerCase());
    });
    if (!receipt) return NextResponse.json({ error: 'No anchored receipt found' }, { status: 404 });

    const logo = await readFile(join(process.cwd(), 'public', 'accensa-logo-no-bg.png'));
    avatar = `data:image/png;base64,${logo.toString('base64')}`;
  } catch (error) {
    console.error('receipt share image failed:', error);
    return NextResponse.json({ error: 'Could not generate receipt image' }, { status: 500 });
  }

  const merchantAddress = `${receipt.merchantAddress.slice(0, 7)}…${receipt.merchantAddress.slice(-5)}`;
  const amount = `${formatAmount(receipt.amount)} ${assetLabel(receipt.asset)}`;

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#f7faf8',
        color: '#0b1814',
        padding: '56px',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: '106px',
          top: '156px',
          width: '12px',
          height: '28px',
          background: '#e1ae49',
          transform: 'rotate(24deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '84px',
          top: '202px',
          width: '10px',
          height: '18px',
          background: '#13805e',
          transform: 'rotate(-18deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '118px',
          top: '224px',
          width: '9px',
          height: '16px',
          background: '#d87558',
          transform: 'rotate(38deg)',
        }}
      />
      <div
        style={{
          display: 'flex',
          width: '100%',
          border: '2px solid #dce8e2',
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', width: '18px', background: '#13805e' }} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 1,
            padding: '48px 54px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <img
              src={avatar}
              alt="Accensa merchant avatar"
              width="66"
              height="66"
              style={{ objectFit: 'contain', background: '#e8f4ee', padding: '8px' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>Accensa merchant</div>
              <div style={{ fontSize: 13, color: '#60736a' }}>{merchantAddress}</div>
            </div>
            <div
              style={{
                display: 'flex',
                marginLeft: 'auto',
                alignItems: 'center',
                gap: '8px',
                color: '#126a4e',
                border: '1px solid #b7ddcb',
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              ✓ Receipt anchored on Stellar
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: 18, color: '#60736a', fontWeight: 600 }}>Payment confirmed</div>
            <div style={{ fontSize: 66, lineHeight: 1.1, fontWeight: 750 }}>{amount}</div>
            <div style={{ fontSize: 15, color: '#60736a' }}>
              Public receipt · batch #{receipt.batchId}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '1px solid #e5ece8',
              paddingTop: '18px',
              color: '#60736a',
              fontSize: 13,
            }}
          >
            <span>
              Transaction {receipt.txHash.slice(0, 12)}…{receipt.txHash.slice(-8)}
            </span>
            <span>View receipt proof on Accensa</span>
          </div>
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
    },
  );
}
