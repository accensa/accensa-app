import { Horizon } from '@stellar/stellar-sdk';

export const FEE_LOOKUP_TIMEOUT_MS = 2_000;
export const FEE_LOOKUP_CONCURRENCY = 6;

const HASH_64 = /^[0-9a-fA-F]{64}$/;

export function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_64.test(value);
}

export type FeeFetcher = (txHash: string) => Promise<{ fee_charged?: number | string | null }>;

export function horizonFeeFetcher(server: Horizon.Server): FeeFetcher {
  return async (txHash) => server.transactions().transaction(txHash).call();
}

export function defaultHorizonUrl(): string {
  const configured = process.env.HORIZON_URL ?? process.env.STELLAR_HORIZON_URL;
  if (configured) return configured;
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK?.trim().toLowerCase();
  return network === 'mainnet' || network === 'public' || network === 'pubnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
}

export function createHorizonFeeFetcher(url: string = defaultHorizonUrl()): FeeFetcher {
  return horizonFeeFetcher(new Horizon.Server(url));
}

export function parseFeeStroops(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const stroops = BigInt(text);
  return stroops >= 0n ? stroops.toString() : null;
}

export interface FeeResolution {
  fees: Map<string, string>;
  unpriced: string[];
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Horizon fee lookup timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveTransactionFees(
  hashes: readonly string[],
  fetchFee: FeeFetcher,
  options: { timeoutMs?: number; concurrency?: number } = {},
): Promise<FeeResolution> {
  const timeoutMs = options.timeoutMs ?? FEE_LOOKUP_TIMEOUT_MS;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? FEE_LOOKUP_CONCURRENCY, 32));
  const fees = new Map<string, string>();
  const unpriced: string[] = [];
  const unique = new Set<string>();

  for (const hash of hashes) {
    if (!isTransactionHash(hash)) {
      unpriced.push(String(hash));
      continue;
    }
    const normalized = hash.toLowerCase();
    if (!unique.has(normalized)) unique.add(normalized);
  }

  const targets = [...unique];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const hash = targets[next++];
      try {
        const record = await withTimeout(
          Promise.resolve().then(() => fetchFee(hash)),
          timeoutMs,
        );
        const fee = parseFeeStroops(record?.fee_charged);
        if (fee === null) unpriced.push(hash);
        else fees.set(hash, fee);
      } catch {
        unpriced.push(hash);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
  return { fees, unpriced };
}
