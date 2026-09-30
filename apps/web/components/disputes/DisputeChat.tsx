'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, ShieldCheck, XCircle } from 'lucide-react';
import { useDisputeChat, type DisputeAttachment } from './useDisputeChat';

export interface DisputeChatProps {
  disputeId: string;
  /** Which side of the negotiation this browser represents. */
  role: 'buyer' | 'merchant';
  onAcceptPartialRefund?: () => void | Promise<void>;
  onCancelDispute?: () => void | Promise<void>;
}

const MAX_ATTACHMENT_EDGE_PX = 640;

/** Downscales an image client-side so only a small thumbnail ever leaves the browser. */
function compressImage(file: File): Promise<DisputeAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the attachment'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read the attachment'));
      img.onload = () => {
        const scale = Math.min(1, MAX_ATTACHMENT_EDGE_PX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas is not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          name: file.name,
          contentType: 'image/jpeg',
          dataUrl: canvas.toDataURL('image/jpeg', 0.7),
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Real-time negotiation chat between a buyer and merchant on an active
 * dispute (#429). Messages are end-to-end encrypted before leaving the
 * browser (`useDisputeChat`) and stream in over SSE.
 */
export default function DisputeChat({
  disputeId,
  role,
  onAcceptPartialRefund,
  onCancelDispute,
}: DisputeChatProps) {
  const { messages, send, connected, error } = useDisputeChat(disputeId, role);
  const [draft, setDraft] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<DisputeAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAttachError('Only image attachments are supported');
      return;
    }
    try {
      setAttachError(null);
      setPendingAttachment(await compressImage(file));
    } catch (err: unknown) {
      setAttachError(err instanceof Error ? err.message : 'Could not attach that file');
    }
  };

  const handleSend = async () => {
    if (!draft.trim() && !pendingAttachment) return;
    setSending(true);
    try {
      await send(draft, pendingAttachment);
      setDraft('');
      setPendingAttachment(null);
    } catch (err: unknown) {
      setAttachError(err instanceof Error ? err.message : 'Could not send the message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="flex h-full flex-col rounded-lg border border-gray-200"
      data-testid="dispute-chat"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 p-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Dispute negotiation</h3>
          <p className="text-xs text-gray-500" data-testid="dispute-chat-status">
            {connected ? 'Live' : 'Connecting…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onAcceptPartialRefund?.()}
            className="flex items-center gap-1 rounded-md border border-green-600 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Accept partial refund
          </button>
          <button
            type="button"
            onClick={() => void onCancelDispute?.()}
            className="flex items-center gap-1 rounded-md border border-red-600 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel dispute
          </button>
        </div>
      </div>

      {error && (
        <p className="px-3 pt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto p-3"
        data-testid="dispute-chat-messages"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            data-testid="dispute-chat-message"
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              message.role === role ? 'ml-auto bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
            }`}
          >
            {message.attachment && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.attachment.dataUrl}
                alt={message.attachment.name}
                className="mb-1 max-h-40 rounded-md"
              />
            )}
            {message.text && <p>{message.text}</p>}
          </div>
        ))}
      </div>

      {attachError && (
        <p className="px-3 text-xs text-red-600" role="alert">
          {attachError}
        </p>
      )}
      {pendingAttachment && (
        <div className="flex items-center gap-2 px-3 text-xs text-gray-600">
          <span>Attached: {pendingAttachment.name}</span>
          <button type="button" onClick={() => setPendingAttachment(null)} className="text-red-600">
            Remove
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-gray-200 p-3">
        <label className="cursor-pointer text-gray-500 hover:text-gray-700">
          <Paperclip className="h-4 w-4" />
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message the other party…"
          aria-label="Message"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || (!draft.trim() && !pendingAttachment)}
          aria-label="Send message"
          className="rounded-md bg-blue-600 p-2 text-white disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
