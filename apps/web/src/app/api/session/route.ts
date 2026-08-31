import { NextResponse } from 'next/server';
import { roleFromRequest, type Role } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Exposes the signed-in session's role to client components (#156).
 *
 * The middleware has already verified the session cookie and forwarded the
 * role as `x-accensa-role` before this route runs; this handler simply echoes
 * it back. Client components use it to hide admin-only actions (refunds,
 * settings) from viewer sessions — the server routes themselves enforce the
 * same boundary, so hiding UI here is a convenience, not the security
 * control.
 */
export async function GET(request: Request) {
  const role: Role = roleFromRequest(request);
  return NextResponse.json({ role });
}
