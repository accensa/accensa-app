export interface ExpressAllowance {
  spent: string;
  limit: string;
}

interface StoredExpressSession {
  sessionId: string;
  key: CryptoKey;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

const DATABASE_NAME = 'accensa-express-session';
const STORE_NAME = 'sessions';
const DATABASE_VERSION = 1;

function amountUnits(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
}

export function canSpendExpress(amount: string, allowance: ExpressAllowance): boolean {
  const requested = amountUnits(amount);
  const spent = amountUnits(allowance.spent);
  const limit = amountUnits(allowance.limit);
  return (
    requested !== null &&
    spent !== null &&
    limit !== null &&
    requested > 0n &&
    spent + requested <= limit
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) {
    return Promise.reject(new Error('Encrypted session storage is not available in this browser'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open session storage'));
  });
}

function writeSession(database: IDBDatabase, session: StoredExpressSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(session);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save session'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Session save was aborted'));
  });
}

function readSession(
  database: IDBDatabase,
  sessionId: string,
): Promise<StoredExpressSession | undefined> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(sessionId);
    request.onsuccess = () => resolve(request.result as StoredExpressSession | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read session'));
  });
}

export async function storeExpressSessionKey(sessionId: string, privateKey: string): Promise<void> {
  if (!sessionId || !privateKey) throw new Error('A session ID and delegated key are required');

  const database = await openDatabase();
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(privateKey),
    );
    await writeSession(database, { sessionId, key, iv: iv.buffer, ciphertext });
  } finally {
    database.close();
  }
}

export async function getExpressSessionKey(sessionId: string): Promise<string | null> {
  const database = await openDatabase();
  try {
    const session = await readSession(database, sessionId);
    if (!session) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(session.iv) },
      session.key,
      session.ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } finally {
    database.close();
  }
}

export async function removeExpressSession(sessionId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(sessionId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not remove session'));
    });
  } finally {
    database.close();
  }
}
