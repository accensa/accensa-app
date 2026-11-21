import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSession, decrypt } from '@/lib/auth';
import { parseRole } from '@/lib/rbac';

export async function POST(_request: Request) {
  const token = (await cookies()).get('accensa_session')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown> | undefined;
  try {
    payload = await decrypt(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const publicKey = payload?.publicKey;
  if (typeof publicKey !== 'string' || !publicKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await createSession(publicKey, parseRole(payload?.role) ?? 'viewer');
  return NextResponse.json({ success: true });
}
