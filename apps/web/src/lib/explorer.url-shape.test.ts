import { afterEach, describe, expect, it } from 'vitest';
import { STELLAR_EXPERT_ORIGIN, explorerContractUrl, explorerTxUrl } from './explorer';

const TX_HASH = 'AB'.repeat(32);
const CONTRACT_ID = 'C' + 'A'.repeat(55);

describe('explorer URL shapes', () => {
  const originalNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK;

  afterEach(() => {
    if (originalNetwork === undefined) delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    else process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalNetwork;
  });

  it('keeps a 64-character uppercase transaction hash unchanged on both networks', () => {
    expect(TX_HASH).toHaveLength(64);
    expect(explorerTxUrl(TX_HASH, 'testnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/testnet/tx/${TX_HASH}`,
    );
    expect(explorerTxUrl(TX_HASH, 'mainnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/public/tx/${TX_HASH}`,
    );
  });

  it('keeps a 56-character contract id unchanged on both networks', () => {
    expect(CONTRACT_ID).toHaveLength(56);
    expect(explorerContractUrl(CONTRACT_ID, 'testnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/testnet/contract/${CONTRACT_ID}`,
    );
    expect(explorerContractUrl(CONTRACT_ID, 'mainnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/public/contract/${CONTRACT_ID}`,
    );
  });

  it('follows NEXT_PUBLIC_STELLAR_NETWORK when the network argument is omitted', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    expect(explorerContractUrl(CONTRACT_ID)).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/public/contract/${CONTRACT_ID}`,
    );

    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    expect(explorerContractUrl(CONTRACT_ID)).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/testnet/contract/${CONTRACT_ID}`,
    );
  });
});
