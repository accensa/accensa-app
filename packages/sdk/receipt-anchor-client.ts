import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Reads Accensa's on-chain `ReceiptAnchor` contract via Soroban RPC simulation.
 *
 * Mirrors `apps/web/src/lib/receipt-anchor.ts` as a reusable, merchant-
 * configurable client: every call is a read-only simulation - nothing is
 * signed, nothing is submitted, and no fees are paid. That matters because a
 * merchant verifying a receipt (or an agent checking one) should not need an
 * account, a wallet, or any trust in Accensa's own servers.
 *
 * By default this points at the `ReceiptAnchor` instance Accensa operates on
 * Stellar testnet. A merchant who has deployed their own `ReceiptAnchor`
 * instance - for example on a different network, or to control anchoring
 * themselves - overrides `contractId` (see the constructor and the SDK
 * README's "Custom contract initialization" section).
 */

/** The Accensa-operated `ReceiptAnchor` deployment on Stellar testnet. */
export const DEFAULT_CONTRACT_ID = 'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV';

export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';

export const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * Simulation needs a source account, but never uses its balance or sequence.
 * A well-known address with a zero sequence keeps the client usable by
 * callers who have no Stellar account at all.
 */
export const DEFAULT_SIMULATION_SOURCE = 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';

export interface BatchRecord {
  root: string;
  count: number;
  periodStart: number;
  periodEnd: number;
}

/** The subset of `rpc.Server` the client calls. Lets tests inject a fake server. */
export interface RpcServerLike {
  simulateTransaction: InstanceType<typeof rpc.Server>['simulateTransaction'];
}

export interface ReceiptAnchorClientOptions {
  /**
   * The `ReceiptAnchor` contract to read from.
   *
   * Defaults to the Accensa-operated instance on testnet
   * ({@link DEFAULT_CONTRACT_ID}). Pass your own contract ID if you have
   * deployed a private `ReceiptAnchor` instance - see the SDK README for the
   * implications (in particular, `rpcUrl` and `networkPassphrase` must point
   * at the network that contract is actually deployed on).
   */
  contractId?: string;
  /** Soroban RPC endpoint to simulate against. Defaults to {@link DEFAULT_RPC_URL}. */
  rpcUrl?: string;
  /** Network passphrase for `rpcUrl`. Defaults to {@link DEFAULT_NETWORK_PASSPHRASE} (testnet). */
  networkPassphrase?: string;
  /** Source account for read-only simulation. Defaults to {@link DEFAULT_SIMULATION_SOURCE}. */
  simulationSource?: string;
  /** Injected in tests. Defaults to a real `rpc.Server` against `rpcUrl`. */
  rpcServerFactory?: (rpcUrl: string) => RpcServerLike;
}

function hexToScValBytes(hex: string) {
  return xdr.ScVal.scvBytes(Buffer.from(hex.trim(), 'hex'));
}

/**
 * Reads a merchant's `ReceiptAnchor` contract - the default Accensa-operated
 * instance, or a custom one a merchant has deployed themselves.
 *
 * ```ts
 * import { ReceiptAnchorClient } from '@accensa/sdk/receipt-anchor-client';
 *
 * // Default: reads Accensa's own ReceiptAnchor on testnet.
 * const client = new ReceiptAnchorClient();
 *
 * // Custom: reads a merchant-deployed ReceiptAnchor instance instead.
 * const merchantClient = new ReceiptAnchorClient({
 *   contractId: 'C...',
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: Networks.TESTNET,
 * });
 * ```
 */
export class ReceiptAnchorClient {
  readonly contractId: string;
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  private readonly simulationSource: string;
  private readonly server: RpcServerLike;

  constructor(opts: ReceiptAnchorClientOptions = {}) {
    this.contractId = opts.contractId ?? DEFAULT_CONTRACT_ID;
    this.rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
    this.networkPassphrase = opts.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
    this.simulationSource = opts.simulationSource ?? DEFAULT_SIMULATION_SOURCE;
    this.server = opts.rpcServerFactory
      ? opts.rpcServerFactory(this.rpcUrl)
      : new rpc.Server(this.rpcUrl, { allowHttp: this.rpcUrl.startsWith('http://') });
  }

  private async simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
    const contract = new Contract(this.contractId);
    const source = new Account(this.simulationSource, '0');

    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(sim.error);
    }
    if (!('result' in sim) || !sim.result?.retval) {
      throw new Error(`${method} returned no value`);
    }
    return scValToNative(sim.result.retval);
  }

  /**
   * Verifies a receipt against an anchored batch, on-chain.
   *
   * Returns the contract's own answer - the point of verifying on-chain
   * rather than with {@link verifyReceipt} is that this number comes from the
   * ledger, not from Accensa.
   */
  async verifyReceiptOnChain(batchId: number, leaf: string, proof: string[]): Promise<boolean> {
    const result = await this.simulate('verify_receipt', [
      nativeToScVal(batchId, { type: 'u64' }),
      hexToScValBytes(leaf),
      xdr.ScVal.scvVec(proof.map(hexToScValBytes)),
    ]);
    return result === true;
  }

  /** Reads an anchored batch from {@link contractId}. Throws if the batch does not exist. */
  async getBatch(batchId: number): Promise<BatchRecord> {
    const raw = (await this.simulate('get_batch', [
      nativeToScVal(batchId, { type: 'u64' }),
    ])) as Record<string, unknown>;

    const root = raw.root;
    return {
      root: Buffer.isBuffer(root)
        ? root.toString('hex')
        : Buffer.from(root as Uint8Array).toString('hex'),
      count: Number(raw.count),
      periodStart: Number(raw.period_start),
      periodEnd: Number(raw.period_end),
    };
  }
}
