import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  appendMessage,
  getRoomSalt,
  listMessages,
  type DisputeAttachment,
} from '@/lib/dispute-chat-store';
import { broadcastDisputeChatMessage } from '@/lib/dispute-chat-events';
import type { EncryptedPayload } from '@/lib/chat/crypto';

export const dynamic = 'force-dynamic';

export interface DisputeMessagesResponse {
  /** Base64 salt; combine with the dispute id to derive the room's AES key. */
  salt: string;
  messages: ReturnType<typeof listMessages>;
}

/** History + the salt needed to derive the room key, for a chat opened fresh. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json<DisputeMessagesResponse>({
    salt: getRoomSalt(id),
    messages: listMessages(id),
  });
}

interface SendMessageBody {
  role: 'buyer' | 'merchant';
  payload: EncryptedPayload;
  attachment?: DisputeAttachment | null;
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  const payload = value as EncryptedPayload | null;
  return !!payload && typeof payload.ciphertext === 'string' && typeof payload.iv === 'string';
}

/** Appends an already-encrypted message and fans it out over SSE. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: SendMessageBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  if (body.role !== 'buyer' && body.role !== 'merchant') {
    return NextResponse.json({ error: 'role must be "buyer" or "merchant"' }, { status: 400 });
  }
  if (!isEncryptedPayload(body.payload)) {
    return NextResponse.json(
      { error: 'payload must be an encrypted { ciphertext, iv } produced client-side' },
      { status: 400 },
    );
  }

  const message = appendMessage(id, {
    id: randomUUID(),
    role: body.role,
    createdAt: new Date().toISOString(),
    payload: body.payload,
    attachment: body.attachment ?? null,
  });

  broadcastDisputeChatMessage(id, message);
  return NextResponse.json({ message }, { status: 201 });
}
