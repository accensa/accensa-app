import {
  decryptPayload,
  deriveKey,
  encryptPayload,
  fromBase64,
  PBKDF2_ITERATIONS,
  randomBytes,
  toBase64,
} from './crypto';
import {
  clearSession,
  createSession,
  loadSession,
  saveSession,
  SESSION_STORAGE_KEY,
  type ChatMessage,
  type ChatSession,
  type StorageLike,
} from './session';

export type UnlockResult =
  | { kind: 'unlocked'; fresh: boolean }
  | { kind: 'locked'; reason: 'different-wallet' }
  | { kind: 'error'; message: string };

/**
 * E2EE chat client for the merchant support conversation.
 *
 * Key lifecycle:
 *  - A session is created with a random salt the first time a merchant opens
 *    the chat from a given wallet.
 *  - The AES key is derived from (walletAddress, salt) and held in memory
 *    only — never persisted.
 *  - Messages are encrypted before being stored, and decrypted on read.
 *  - A transcript started by a different wallet refuses to unlock rather than
 *    silently deriving a wrong key and producing garbage.
 */
export class SecureChatClient {
  private key: CryptoKey | null = null;
  private session: ChatSession | null = null;

  constructor(
    private storage: StorageLike,
    private iterations: number = PBKDF2_ITERATIONS,
  ) {}

  /** Unlocks (or creates) the chat session for a merchant wallet. */
  async unlock(walletAddress: string): Promise<UnlockResult> {
    try {
      const existing = loadSession(this.storage);
      if (existing && existing.merchantAddress !== walletAddress) {
        return { kind: 'locked', reason: 'different-wallet' };
      }

      const fresh = !existing;
      const session = existing ?? createSession(walletAddress);
      this.key = await deriveKey(walletAddress, fromBase64(session.salt), this.iterations);
      this.session = session;
      if (fresh) saveSession(this.storage, session);
      return { kind: 'unlocked', fresh };
    } catch (error: unknown) {
      this.key = null;
      this.session = null;
      return {
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not unlock the chat session',
      };
    }
  }

  /** Encrypts and persists a message from the merchant side. */
  async send(text: string): Promise<ChatMessage> {
    if (!this.key || !this.session) {
      throw new Error('Chat session is not unlocked');
    }
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Message cannot be empty');

    const message: ChatMessage = {
      id: toBase64(randomBytes(16)),
      role: 'merchant',
      createdAt: new Date().toISOString(),
      payload: await encryptPayload(this.key, trimmed),
    };
    this.session.messages.push(message);
    saveSession(this.storage, this.session);
    return message;
  }

  /** Decrypts a stored message for display. */
  async read(message: ChatMessage): Promise<string> {
    if (!this.key) throw new Error('Chat session is not unlocked');
    return decryptPayload(this.key, message.payload);
  }

  /** Wipes the transcript and the derived key. */
  reset(): void {
    this.key = null;
    this.session = null;
    clearSession(this.storage);
  }

  get isUnlocked(): boolean {
    return this.key !== null && this.session !== null;
  }

  get merchantAddress(): string | null {
    return this.session?.merchantAddress ?? null;
  }

  get messages(): readonly ChatMessage[] {
    return this.session?.messages ?? [];
  }
}

export { SESSION_STORAGE_KEY, PBKDF2_ITERATIONS };
