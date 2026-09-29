/**
 * Comprehensive TypeScript generic types for all Accensa Soroban contract events.
 *
 * Provides strongly-typed schemas and discriminating union types for all events emitted
 * across Accensa smart contracts (Deposit, Refund, Dispute, Anchor, and Multisig).
 */

export interface BaseContractEvent<
  TType extends string = string,
  TMetadata = Record<string, unknown>,
> {
  /** Paging cursor or unique event ID from Soroban RPC. */
  id?: string;
  /** Address of the emitting smart contract. */
  contractId: string;
  /** Event discriminator type. */
  type: TType;
  /** Stellar transaction hash. */
  txHash: string;
  /** Ledger sequence number the event was committed in. */
  ledger: number;
  /** ISO-8601 timestamp or ledger close timestamp. */
  ledgerClosedAt: string;
  /** Arbitrary or generic event metadata. */
  metadata?: TMetadata;
}

/**
 * Event emitted when a merchant or party deposits funds or float into a contract/vault.
 */
export interface DepositEvent<TMetadata = Record<string, unknown>> extends BaseContractEvent<
  'deposit',
  TMetadata
> {
  type: 'deposit';
  /** Account address of the depositor. */
  from: string;
  /** Address of the vault or recipient contract. */
  vault: string;
  /** SEP-11 asset string or token contract address (e.g. 'native' or SAC address). */
  token: string;
  /** Integer amount in stroops (7 decimals for Stellar assets, never lossy). */
  amount: bigint;
  /** Fixed-point decimal string representation of the amount. */
  amountDecimal: string;
  /** Optional identifier for the deposit or float allocation. */
  depositId?: string | number;
}

/**
 * Event emitted when a merchant-authorized refund is executed from a RefundVault.
 */
export interface RefundEvent<TMetadata = Record<string, unknown>> extends BaseContractEvent<
  'refund',
  TMetadata
> {
  type: 'refund';
  /** Address of the refund vault or sender. */
  from: string;
  /** Address of the buyer / refund recipient. */
  to: string;
  /** SEP-11 asset string or token contract address. */
  token: string;
  /** Integer amount in stroops. */
  amount: bigint;
  /** Fixed-point decimal string representation of the amount. */
  amountDecimal: string;
  /** Identifier of the original payment, receipt, or order being refunded. */
  paymentId?: string;
  /** Reason provided for the refund. */
  reason?: string;
}

/**
 * Status of a state channel, escrow, or payment dispute.
 */
export type DisputeStatus = 'initiated' | 'challenged' | 'resolved' | 'expired' | 'canceled';

/**
 * Event emitted during payment or channel disputes.
 */
export interface DisputeEvent<TMetadata = Record<string, unknown>> extends BaseContractEvent<
  'dispute',
  TMetadata
> {
  type: 'dispute';
  /** Identifier of the disputed channel, payment, or escrow. */
  disputeId: string;
  /** Address of the party initiating or updating the dispute. */
  claimant: string;
  /** Counterparty address. */
  respondent?: string;
  /** Disputed amount or bond posted in stroops. */
  amount?: bigint;
  /** Fixed-point decimal string representation of the amount. */
  amountDecimal?: string;
  /** Current state of the dispute lifecycle. */
  status: DisputeStatus;
  /** Ledger sequence after which the dispute concludes. */
  timeoutLedger?: number;
  /** Description or reason for the dispute. */
  reason?: string;
}

/**
 * Event emitted when a batch of receipts is anchored to the ReceiptAnchor contract.
 */
export interface AnchorEvent<TMetadata = Record<string, unknown>> extends BaseContractEvent<
  'anchor',
  TMetadata
> {
  type: 'anchor';
  /** Address of the merchant whose receipts are anchored. */
  merchant: string;
  /** Sequential batch number. */
  batchId: number;
  /** 32-byte hexadecimal Merkle root. */
  root: string;
  /** Total count of receipts included in this anchored batch. */
  count: number;
  /** Unix timestamp marking the start of the batch period. */
  periodStart: number;
  /** Unix timestamp marking the end of the batch period. */
  periodEnd: number;
}

/**
 * Operations executed within multisig governance or treasury contracts.
 */
export type MultisigOperation = 'proposed' | 'approved' | 'executed' | 'revoked';

/**
 * Event emitted for multisig proposal, authorization, or execution.
 */
export interface MultisigEvent<TMetadata = Record<string, unknown>> extends BaseContractEvent<
  'multisig',
  TMetadata
> {
  type: 'multisig';
  /** Operation stage. */
  operation: MultisigOperation;
  /** Unique proposal or transaction identifier. */
  proposalId: string | number;
  /** Address of the signer performing this operation. */
  signer: string;
  /** All signers currently approving the proposal. */
  signers?: string[];
  /** Required signature threshold. */
  threshold?: number;
  /** Destination contract or recipient address. */
  target?: string;
}

/**
 * Exhaustive discriminated union of all Accensa Soroban contract events.
 */
export type AccensaEvent<TMetadata = Record<string, unknown>> =
  | DepositEvent<TMetadata>
  | RefundEvent<TMetadata>
  | DisputeEvent<TMetadata>
  | AnchorEvent<TMetadata>
  | MultisigEvent<TMetadata>;

export type AccensaEventType = AccensaEvent['type'];

/**
 * Shape of raw event payloads returned by Soroban RPC `getEvents`.
 */
export interface RawSorobanRpcEvent {
  id?: string;
  type?: string;
  ledger?: number;
  ledgerClosedAt?: string;
  contractId?: string;
  topic?: unknown[];
  value?: unknown;
  txHash?: string;
  pagingToken?: string;
}
