import type { NextRequest } from 'next/server';
import { createDisputeChatStream } from '@/lib/dispute-chat-events';

export const dynamic = 'force-dynamic';

/** Server-Sent Events subscription for one dispute's negotiation chat. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createDisputeChatStream(request, id);
}
