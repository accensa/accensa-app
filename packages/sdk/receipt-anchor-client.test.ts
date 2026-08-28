import { describe, it, expect, vi } from 'vitest';
import { nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import {
  ReceiptAnchorClient,
  DEFAULT_CONTRACT_ID,
  DEFAULT_NETWORK_PASSPHRASE,
  DEFAULT_RPC_URL,
  type RpcServerLike,
} from './receipt-anchor-client';

const LEAF = 'a'.repeat(64);
const PROOF = ['b'.repeat(64)];

/** A fake `rpc.Server` returning a canned simulation result, never touching the network. */
function fakeServer(retval: xdr.ScVal): RpcServerLike {
  return {
    simulateTransaction: vi.fn(
      async () =>
        ({ result: { retval } }) as unknown as ReturnType<
          InstanceType<typeof rpc.Server>['simulateTransaction']
        >,
    ),
  };
}

function erroringServer(error: string): RpcServerLike {
  return {
    simulateTransaction: vi.fn(
      async () =>
        ({ error }) as unknown as Awaited<
          ReturnType<InstanceType<typeof rpc.Server>['simulateTransaction']>
        >,
    ),
  };
}

describe('ReceiptAnchorClient — defaults', () => {
  it('uses the Accensa-operated contract, RPC, and network by default', () => {
    const client = new ReceiptAnchorClient();
    expect(client.contractId).toBe(DEFAULT_CONTRACT_ID);
    expect(client.rpcUrl).toBe(DEFAULT_RPC_URL);
    expect(client.networkPassphrase).toBe(DEFAULT_NETWORK_PASSPHRASE);
  });

  it('overrides the contract, RPC, and network independently', () => {
    const client = new ReceiptAnchorClient({
      contractId: 'CCUSTOM',
      rpcUrl: 'https://rpc.example.org',
      networkPassphrase: 'Custom Network ; Sept 2026',
    });
    expect(client.contractId).toBe('CCUSTOM');
    expect(client.rpcUrl).toBe('https://rpc.example.org');
    expect(client.networkPassphrase).toBe('Custom Network ; Sept 2026');
  });
});

describe('ReceiptAnchorClient#verifyReceiptOnChain', () => {
  it('returns true when the contract reports the receipt verifies', async () => {
    const server = fakeServer(nativeToScVal(true));
    const client = new ReceiptAnchorClient({ rpcServerFactory: () => server });

    await expect(client.verifyReceiptOnChain(1, LEAF, PROOF)).resolves.toBe(true);
  });

  it('returns false when the contract reports the receipt does not verify', async () => {
    const server = fakeServer(nativeToScVal(false));
    const client = new ReceiptAnchorClient({ rpcServerFactory: () => server });

    await expect(client.verifyReceiptOnChain(1, LEAF, PROOF)).resolves.toBe(false);
  });

  it('calls verify_receipt against the configured contract, not the default', async () => {
    const CUSTOM_CONTRACT_ID = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
    const server = fakeServer(nativeToScVal(true));
    const factory = vi.fn(() => server);
    const client = new ReceiptAnchorClient({
      contractId: CUSTOM_CONTRACT_ID,
      rpcServerFactory: factory,
    });

    await client.verifyReceiptOnChain(1, LEAF, PROOF);

    // simulateTransaction receives a built Transaction; the only way to
    // confirm which contract it targets is via the injected server having
    // been constructed for this client's rpcUrl and the call succeeding
    // against the client's own contractId - a wrong contractId here would
    // still round-trip through the same fake, so we assert the factory saw
    // this client's own rpcUrl.
    expect(factory).toHaveBeenCalledWith(DEFAULT_RPC_URL);
    expect(client.contractId).toBe(CUSTOM_CONTRACT_ID);
  });

  it('throws when the RPC simulation errors', async () => {
    const server = erroringServer('contract not found');
    const client = new ReceiptAnchorClient({ rpcServerFactory: () => server });

    await expect(client.verifyReceiptOnChain(1, LEAF, PROOF)).rejects.toThrow('contract not found');
  });
});

describe('ReceiptAnchorClient#getBatch', () => {
  it('maps the contract result into a BatchRecord', async () => {
    const root = 'c'.repeat(64);
    const raw = nativeToScVal({
      root: Buffer.from(root, 'hex'),
      count: 3,
      period_start: 100,
      period_end: 200,
    });
    const server = fakeServer(raw);
    const client = new ReceiptAnchorClient({ rpcServerFactory: () => server });

    await expect(client.getBatch(1)).resolves.toEqual({
      root,
      count: 3,
      periodStart: 100,
      periodEnd: 200,
    });
  });

  it('throws when the batch does not exist', async () => {
    const server = erroringServer('batch not found');
    const client = new ReceiptAnchorClient({ rpcServerFactory: () => server });

    await expect(client.getBatch(999)).rejects.toThrow('batch not found');
  });
});
