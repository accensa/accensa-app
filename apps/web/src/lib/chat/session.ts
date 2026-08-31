import { randomBytes, toBase64, type EncryptedPayload } from './crypto';

/**
 * A stored support-chat message. Only ciphertext is persisted — plaintext
 * exists solely in memory for as long as the session is unlocked.
 */
export interface ChatMessage {
  id: string;
  role: 'merchant' | 'buyer';
  createdAt: string;
  payload: EncryptedPayload;
}

/**
 * A chat session bound to one merchant wallet. The salt is persisted so the
 * key can be re-derived on the next visit; the address is stored to detect
 * that a different wallet is trying to open this transcript.
 */
export interface ChatSession {
  merchantAddress: string;
  salt: string;
  createdAt: string;
  messages: ChatMessage[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_STORAGE_KEY = 'accensa.support-chat.session';

export function createSession(merchantAddress: string): ChatSession {
  return {
    merchantAddress,
    salt: toBase64(randomBytes(16)),
    createdAt: new Date().toISOString(),
    messages: [],
  };
}

export function loadSession(storage: StorageLike): ChatSession | null {
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatSession;
    if (typeof parsed.merchantAddress !== 'string' || typeof parsed.salt !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(storage: StorageLike, session: ChatSession): void {
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(storage: StorageLike): void {
  storage.removeItem(SESSION_STORAGE_KEY);
}
