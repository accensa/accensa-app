'use client';

import React from 'react';

export interface StepSelectionProps {
  transactionAmount: string;
  assetSymbol: string;
  refundAmount: string;
  onAmountChange: (amount: string) => void;
}

/**
 * Step 1: Receipt selection and itemized refund amount specification
 * 
 * Allows the customer to select how much of the transaction to refund.
 * Defaults to full amount but allows partial refunds.
 */
export function StepSelection({
  transactionAmount,
  assetSymbol,
  refundAmount,
  onAmountChange,
}: StepSelectionProps) {
  const maxAmount = parseFloat(transactionAmount) || 0;
  const currentAmount = parseFloat(refundAmount) || 0;

  const handleFullRefund = () => {
    onAmountChange(transactionAmount);
  };

  const handleCustomAmount = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      const numValue = parseFloat(value);
      if (numValue <= maxAmount || value === '') {
        onAmountChange(value);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-2">Select Refund Amount</h3>
        <p className="text-gray-600 text-sm">
          Choose how much of the transaction you want to refund. You can request a full or partial refund.
        </p>
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">Original Transaction Amount</span>
          <span className="font-medium">
            {transactionAmount} {assetSymbol}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <button
          onClick={handleFullRefund}
          className={`w-full p-4 rounded-lg border-2 transition-colors ${
            refundAmount === transactionAmount
              ? 'border-blue-600 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Full Refund</div>
              <div className="text-sm text-gray-600">Refund the entire transaction amount</div>
            </div>
            <div className="text-lg font-semibold">
              {transactionAmount} {assetSymbol}
            </div>
          </div>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">Or request partial refund</span>
          </div>
        </div>

        <div>
          <label htmlFor="custom-amount" className="block text-sm font-medium text-gray-700 mb-2">
            Custom Amount
          </label>
          <div className="relative">
            <input
              id="custom-amount"
              type="text"
              inputMode="decimal"
              value={refundAmount === transactionAmount ? '' : refundAmount}
              onChange={handleCustomAmount}
              placeholder="Enter amount"
              className="w-full p-3 pr-16 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
              {assetSymbol}
            </span>
          </div>
          {currentAmount > 0 && (
            <p className="mt-2 text-sm text-gray-600">
              Refunding {((currentAmount / maxAmount) * 100).toFixed(1)}% of transaction
            </p>
          )}
        </div>
      </div>

      {currentAmount > maxAmount && (
        <p className="text-sm text-red-600">
          Refund amount cannot exceed transaction amount
        </p>
      )}
    </div>
  );
}
