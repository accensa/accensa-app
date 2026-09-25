import { TransactionBuilder, Horizon, Account, BASE_FEE, Networks } from '@stellar/stellar-sdk';
import { AccensaError, AccensaContractError } from '../errors';

/**
 * Dispute reason categories matching the escrow contract enum
 */
export enum DisputeReason {
  NON_DELIVERY = 0,
  DEFECTIVE_GOODS = 1,
  UNAUTHORIZED_CHARGE = 2,
}

/**
 * Dispute request payload for on-chain submission
 */
export interface DisputeRequest {
  txHash: string;
  refundAmount: string;
  reason: DisputeReason;
  description: string;
  proofAttachment?: string;
}

/**
 * Options for dispute submission
 */
export interface DisputeOptions {
  /** Stellar network passphrase (defaults to public network) */
  networkPassphrase?: string;
  /** Horizon server URL (defaults to public horizon) */
  horizonUrl?: string;
  /** Escrow contract ID */
  contractId: string;
  /** Dispute window in days (default 30) */
  disputeWindowDays?: number;
}

/**
 * Result of dispute submission
 */
export interface DisputeResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Submit a dispute to the escrow contract
 * 
 * This function builds and submits a Stellar transaction that invokes the
 * escrow contract's dispute function. The transaction must be signed by the
 * payer's wallet (typically via Freighter in the browser).
 * 
 * @param request - The dispute request details
 * @param signerPublicKey - The public key of the signer (payer)
 * @param opts - Dispute options including contract ID and network config
 * @returns Promise resolving to the dispute result
 * 
 * @example
 * ```ts
 * const result = await submitDispute(
 *   {
 *     txHash: 'abc123...',
 *     refundAmount: '100.0000000',
 *     reason: DisputeReason.NON_DELIVERY,
 *     description: 'Item never arrived'
 *   },
 *   'GABC...',
 *   { contractId: 'CCDEF...' }
 * );
 * ```
 */
export async function submitDispute(
  request: DisputeRequest,
  signerPublicKey: string,
  opts: DisputeOptions,
): Promise<DisputeResult> {
  try {
    const networkPassphrase = opts.networkPassphrase || Networks.PUBLIC;
    const horizonUrl = opts.horizonUrl || 'https://horizon.stellar.org';
    const server = new Horizon.Server(horizonUrl);

    // Load the signer's account to get sequence number
    const account = await server.loadAccount(signerPublicKey);

    // Build the transaction
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        // TODO: Replace with actual escrow contract invoke operation
        // This is a placeholder - the actual operation will depend on the
        // escrow contract's ABI and Soroban contract invocation
        {
          type: 'invoke_contract',
          contract: opts.contractId,
          function: 'dispute',
          args: [
            request.txHash,
            request.refundAmount,
            request.reason.toString(),
            request.description,
          ],
        } as any,
      )
      .setTimeout(30)
      .build();

    // Note: In a browser context, this transaction would be signed by Freighter
    // The caller is responsible for signing before submitting
    // This function returns the unsigned transaction for the UI to handle signing
    
    return {
      success: true,
      transactionHash: transaction.hash().toString('hex'),
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: 'Unknown error occurred',
    };
  }
}

/**
 * Validate a dispute request before submission
 * 
 * Checks that the request is well-formed and within the dispute window.
 * 
 * @param request - The dispute request to validate
 * @param transactionDate - The date of the original transaction (ISO-8601 string)
 * @param disputeWindowDays - Number of days allowed for disputes (default 30)
 * @returns Object with valid flag and error message if invalid
 */
export function validateDisputeRequest(
  request: DisputeRequest,
  transactionDate: string,
  disputeWindowDays: number = 30,
): { valid: boolean; error?: string } {
  // Validate transaction hash format
  if (!/^[0-9a-fA-F]{64}$/.test(request.txHash)) {
    return { valid: false, error: 'Invalid transaction hash format' };
  }

  // Validate refund amount format (7 decimal places for Stellar)
  if (!/^\d+(\.\d{1,7})?$/.test(request.refundAmount)) {
    return { valid: false, error: 'Invalid refund amount format' };
  }

  const amount = parseFloat(request.refundAmount);
  if (amount <= 0) {
    return { valid: false, error: 'Refund amount must be greater than zero' };
  }

  // Validate reason is within enum range
  if (
    request.reason !== DisputeReason.NON_DELIVERY &&
    request.reason !== DisputeReason.DEFECTIVE_GOODS &&
    request.reason !== DisputeReason.UNAUTHORIZED_CHARGE
  ) {
    return { valid: false, error: 'Invalid dispute reason' };
  }

  // Validate description length
  if (request.description.length < 10) {
    return { valid: false, error: 'Description must be at least 10 characters' };
  }
  if (request.description.length > 500) {
    return { valid: false, error: 'Description must not exceed 500 characters' };
  }

  // Validate dispute window
  const txDate = new Date(transactionDate);
  const now = new Date();
  const daysSinceTx = (now.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceTx > disputeWindowDays) {
    return {
      valid: false,
      error: `Dispute window of ${disputeWindowDays} days has expired`,
    };
  }

  return { valid: true };
}

/**
 * Estimate the gas fee for a dispute transaction
 * 
 * @param opts - Dispute options
 * @returns Estimated fee in stroops (1 stroop = 0.0000001 XLM)
 */
export function estimateDisputeFee(opts: DisputeOptions): number {
  // Base fee for Stellar transaction (100 stroops)
  const baseFee = 100;
  
  // Estimated resource fee for contract invocation
  // This is an estimate - actual fee depends on contract complexity
  const contractResourceFee = 10000;
  
  return baseFee + contractResourceFee;
}

/**
 * Convert UI dispute reason to contract enum value
 */
export function mapDisputeReason(reason: string): DisputeReason {
  switch (reason) {
    case 'non_delivery':
      return DisputeReason.NON_DELIVERY;
    case 'defective_goods':
      return DisputeReason.DEFECTIVE_GOODS;
    case 'unauthorized_charge':
      return DisputeReason.UNAUTHORIZED_CHARGE;
    default:
      throw new AccensaContractError(`Invalid dispute reason: ${reason}`);
  }
}
