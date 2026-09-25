'use client';

import React from 'react';
import { DisputeReason } from '../DisputeFlowModal';

export interface StepPreviewProps {
  transactionHash: string;
  refundAmount: string;
  assetSymbol: string;
  reason: DisputeReason;
  description: string;
  hasProof: boolean;
}

const reasonLabels: Record<DisputeReason, string> = {
  [DisputeReason.NON_DELIVERY]: 'Item Not Received',
  [DisputeReason.DEFECTIVE_GOODS]: 'Defective or Not as Described',
  [DisputeReason.UNAUTHORIZED_CHARGE]: 'Unauthorized Charge',
};

/**
 * Step 3: Preview on-chain transaction fees, dispute window rules, and submission confirmation
 * 
 * Displays summary of the dispute request including:
 * - Transaction details
 * - Refund amount
 * - Dispute reason
 * - Estimated on-chain fees
 * - Dispute window information
 */
export function StepPreview({
  transactionHash,
  refundAmount,
  assetSymbol,
  reason,
  description,
  hasProof,
}: StepPreviewProps) {
  // Estimated transaction fee (in stroops, 1 stroop = 0.0000001 XLM)
  const estimatedFeeStroops = 10000; // 0.001 XLM
  const estimatedFeeXlm = (estimatedFeeStroops / 10000000).toFixed(7);

  const truncatedTxHash = `${transactionHash.slice(0, 8)}...${transactionHash.slice(-8)}`;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-2">Review & Confirm</h3>
        <p className="text-gray-600 text-sm">
          Please review the details below before submitting your dispute request.
        </p>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        <div className="flex justify-between items-start">
          <span className="text-gray-600">Transaction</span>
          <div className="text-right">
            <div className="font-mono text-sm">{truncatedTxHash}</div>
            <div className="text-sm text-gray-500">{refundAmount} {assetSymbol}</div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <div className="flex justify-between items-start">
            <span className="text-gray-600">Refund Amount</span>
            <span className="font-medium">
              {refundAmount} {assetSymbol}
            </span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <div className="flex justify-between items-start">
            <span className="text-gray-600">Dispute Reason</span>
            <span className="font-medium">{reasonLabels[reason]}</span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <div className="flex justify-between items-start">
            <span className="text-gray-600">Description</span>
            <span className="text-right text-sm max-w-xs">{description}</span>
          </div>
        </div>

        {hasProof && (
          <div className="border-t border-gray-200 pt-4">
            <div className="flex justify-between items-start">
              <span className="text-gray-600">Proof Attached</span>
              <span className="text-green-600 text-sm">Yes</span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">Transaction Fees</h4>
        <div className="space-y-1 text-sm text-blue-800">
          <div className="flex justify-between">
            <span>Estimated on-chain fee</span>
            <span>{estimatedFeeXlm} XLM</span>
          </div>
          <div className="flex justify-between">
            <span>Network</span>
            <span>Stellar Mainnet</span>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <h4 className="font-medium text-amber-900 mb-2">Important Information</h4>
        <ul className="space-y-2 text-sm text-amber-800">
          <li className="flex items-start gap-2">
            <span className="text-amber-600 mt-0.5">•</span>
            <span>Dispute window: You have 30 days from the transaction date to file a dispute.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-600 mt-0.5">•</span>
            <span>Once submitted, the dispute will be reviewed by the escrow contract.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-600 mt-0.5">•</span>
            <span>You will need to sign this transaction with your Freighter wallet.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-600 mt-0.5">•</span>
            <span>False disputes may result in account restrictions.</span>
          </li>
        </ul>
      </div>

      <div className="flex items-start gap-2 p-3 bg-gray-100 rounded-lg">
        <input type="checkbox" id="confirm" className="mt-1" required />
        <label htmlFor="confirm" className="text-sm text-gray-700">
          I confirm that the information provided is accurate and I understand the dispute process.
        </label>
      </div>
    </div>
  );
}
