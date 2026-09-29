import { randomBytes, toBase64, type EncryptedPayload } from './chat/crypto';

/**
 * In-app dispute negotiation chat (#429).
 *
 * One "room" per dispute, holding only ciphertext plus a per-dispute salt.
 * The salt lets both the buyer and the merchant derive the same AES-GCM key
 * from the dispute id (see `useDisputeChat`'s `deriveKey(disputeId, salt)`
 * call) without either side needing an out-of-band shared secret, so a
 * database leak exposes salts and ciphertext but not message content.
 *
 * State is held in a module-level Map, matching the MVP pattern already used
 * for the indexer sync relay (`sync-events.ts`): correct on a single
 * instance, and swappable for a real `dispute_messages` table plus Redis
 * Pub/Sub without changing the module's contract.
 */

export interface DisputeAttachment {
  name: string;
  contentType: string;
  /** Client-side compressed thumbnail, base64 data URL. */
  dataUrl: string;
}

export interface DisputeChatMessage {
  id: string;
  disputeId: string;
  role: 'buyer' | 'merchant';
  createdAt: string;
  payload: EncryptedPayload;
  attachment: DisputeAttachment | null;
}

interface DisputeChatRoom {
  salt: string;
  messages: DisputeChatMessage[];
}

const rooms = new Map<string, DisputeChatRoom>();

function getOrCreateRoom(disputeId: string): DisputeChatRoom {
  let room = rooms.get(disputeId);
  if (!room) {
    room = { salt: toBase64(randomBytes(16)), messages: [] };
    rooms.set(disputeId, room);
  }
  return room;
}

/** The base64 salt both parties combine with the dispute id to derive the room key. */
export function getRoomSalt(disputeId: string): string {
  return getOrCreateRoom(disputeId).salt;
}

export function listMessages(disputeId: string): DisputeChatMessage[] {
  return getOrCreateRoom(disputeId).messages;
}

export function appendMessage(
  disputeId: string,
  message: Omit<DisputeChatMessage, 'disputeId'>,
): DisputeChatMessage {
  const room = getOrCreateRoom(disputeId);
  const full: DisputeChatMessage = { ...message, disputeId };
  room.messages.push(full);
  return full;
}

/** Test-only: drops all rooms so suites don't leak state into each other. */
export function __resetDisputeChatStore(): void {
  rooms.clear();
}
