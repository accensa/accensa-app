'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decryptPayload,
  deriveKey,
  encryptPayload,
  fromBase64,
  type EncryptedPayload,
} from '../../src/lib/chat/crypto';

export interface DisputeAttachment {
  name: string;
  contentType: string;
  dataUrl: string;
}

export interface DisputeChatMessage {
  id: string;
  disputeId: string;
  role: 'buyer' | 'merchant';
  createdAt: string;
  attachment: DisputeAttachment | null;
  /** Decrypted client-side; empty while the key hasn't unlocked the message yet. */
  text: string;
}

interface RawMessage {
  id: string;
  disputeId: string;
  role: 'buyer' | 'merchant';
  createdAt: string;
  payload: EncryptedPayload;
  attachment: DisputeAttachment | null;
}

/**
 * Drives the in-app dispute negotiation chat (#429): loads history, opens an
 * SSE subscription for new messages, and encrypts/decrypts everything with a
 * key both the buyer and the merchant derive from the dispute id plus a
 * server-issued salt (see `dispute-chat-store.ts`).
 */
export function useDisputeChat(disputeId: string, role: 'buyer' | 'merchant') {
  const [messages, setMessages] = useState<DisputeChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);

  const decorate = useCallback(async (raw: RawMessage): Promise<DisputeChatMessage> => {
    const key = keyRef.current;
    const text = key
      ? await decryptPayload(key, raw.payload).catch(() => '[unable to decrypt]')
      : '';
    return {
      id: raw.id,
      disputeId: raw.disputeId,
      role: raw.role,
      createdAt: raw.createdAt,
      attachment: raw.attachment,
      text,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    async function bootstrap() {
      try {
        const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/messages`);
        if (!response.ok) throw new Error('Could not load the dispute chat');
        const body: { salt: string; messages: RawMessage[] } = await response.json();
        keyRef.current = await deriveKey(disputeId, fromBase64(body.salt));
        const decorated = await Promise.all(body.messages.map(decorate));
        if (!cancelled) setMessages(decorated);

        source = new EventSource(`/api/disputes/${encodeURIComponent(disputeId)}/messages/stream`);
        source.addEventListener('open', () => {
          if (!cancelled) setConnected(true);
        });
        source.addEventListener('message', async (event) => {
          const raw = JSON.parse(event.data) as RawMessage;
          const decorated = await decorate(raw);
          if (!cancelled) {
            setMessages((prev) =>
              prev.some((m) => m.id === decorated.id) ? prev : [...prev, decorated],
            );
          }
        });
        source.addEventListener('error', () => {
          if (!cancelled) setConnected(false);
        });
      } catch (err: unknown) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Could not open the dispute chat');
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [disputeId, decorate]);

  const send = useCallback(
    async (text: string, attachment?: DisputeAttachment | null) => {
      const key = keyRef.current;
      if (!key) throw new Error('Chat is not unlocked yet');
      const trimmed = text.trim();
      if (!trimmed && !attachment) return;

      const payload = await encryptPayload(key, trimmed);
      const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, payload, attachment: attachment ?? null }),
      });
      if (!response.ok) throw new Error('Could not send the message');
      const { message: raw }: { message: RawMessage } = await response.json();
      const decorated = await decorate(raw);
      setMessages((prev) =>
        prev.some((m) => m.id === decorated.id) ? prev : [...prev, decorated],
      );
    },
    [disputeId, role, decorate],
  );

  return { messages, send, connected, error };
}
