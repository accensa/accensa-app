import { describe, expect, it } from 'vitest';
import { STELLAR_EXPERT_ORIGIN, explorerTxUrl } from '../src/lib/explorer';
import { receiptExplorerUrl } from './receipt-explorer-url';

const TX_HASH = 'abc123def456';

describe('receiptExplorerUrl', () => {
  it('uses the public explorer path for an explicitly mainnet receipt', () => {
    expect(receiptExplorerUrl(TX_HASH, 'mainnet')).toBe(explorerTxUrl(TX_HASH, 'mainnet'));
    expect(receiptExplorerUrl(TX_HASH, 'mainnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/public/tx/${TX_HASH}`,
    );
  });

  it('uses the testnet explorer path for an explicitly testnet receipt', () => {
    expect(receiptExplorerUrl(TX_HASH, 'testnet')).toBe(explorerTxUrl(TX_HASH, 'testnet'));
    expect(receiptExplorerUrl(TX_HASH, 'testnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/testnet/tx/${TX_HASH}`,
    );
  });
});
