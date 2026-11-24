import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth';

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ success: true });
  } catch (error) {
    // A merchant logging out a compromised session must get a readable failure
    // contract, never a framework 500 with no body. Log the cause and keep the
    // rejection message out of the response.
    console.error('Logout failed:', error);
    return NextResponse.json({ success: false, error: 'Logout failed' }, { status: 500 });
  }
}
