import { NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';

export async function POST(request: Request) {
  const merchantAddress = request.headers.get('x-accensa-merchant');
  if (!merchantAddress) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await createSession(merchantAddress);
  return NextResponse.json({ success: true });
}
