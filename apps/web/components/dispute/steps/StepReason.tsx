'use client';

import React from 'react';
import { DisputeReason } from '../DisputeFlowModal';

export interface StepReasonProps {
  reason: DisputeReason | null;
  description: string;
  proofAttachment: string | null;
  onReasonChange: (reason: DisputeReason) => void;
  onDescriptionChange: (description: string) => void;
  onProofChange: (proof: string | null) => void;
}

/**
 * Step 2: Reason classification with optional proof attachment
 * 
 * Customer selects dispute reason from predefined categories:
 * - Non-delivery: Item was never received
 * - Defective goods: Item arrived but is defective/not as described
 * - Unauthorized charge: Charge was not authorized by the customer
 * 
 * Optional proof attachment can be provided (screenshots, receipts, etc.)
 */
export function StepReason({
  reason,
  description,
  proofAttachment,
  onReasonChange,
  onDescriptionChange,
  onProofChange,
}: StepReasonProps) {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onProofChange(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeProof = () => {
    onProofChange(null);
  };

  const reasons = [
    {
      value: DisputeReason.NON_DELIVERY,
      title: 'Item Not Received',
      description: 'The item was never delivered or the seller failed to provide the service',
    },
    {
      value: DisputeReason.DEFECTIVE_GOODS,
      title: 'Defective or Not as Described',
      description: 'The item arrived but is defective, damaged, or does not match the description',
    },
    {
      value: DisputeReason.UNAUTHORIZED_CHARGE,
      title: 'Unauthorized Charge',
      description: 'This charge was not authorized by you or appears to be fraudulent',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-2">Select Dispute Reason</h3>
        <p className="text-gray-600 text-sm">
          Choose the category that best describes your issue. This helps us process your dispute faster.
        </p>
      </div>

      <div className="space-y-3">
        {reasons.map((r) => (
          <button
            key={r.value}
            onClick={() => onReasonChange(r.value)}
            className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
              reason === r.value
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <div className="font-medium">{r.title}</div>
            <div className="text-sm text-gray-600 mt-1">{r.description}</div>
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Please provide details about your issue..."
          rows={4}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          maxLength={500}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-500">Minimum 10 characters</span>
          <span className="text-xs text-gray-500">{description.length}/500</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Proof Attachment (Optional)
        </label>
        {!proofAttachment ? (
          <div>
            <input
              type="file"
              id="proof-upload"
              accept="image/*,.pdf"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label
              htmlFor="proof-upload"
              className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <div className="text-gray-500">
                <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm">Click to upload proof</p>
                <p className="text-xs text-gray-400 mt-1">Images or PDF (max 5MB)</p>
              </div>
            </label>
          </div>
        ) : (
          <div className="relative">
            {proofAttachment.startsWith('data:image') ? (
              <img
                src={proofAttachment}
                alt="Proof attachment"
                className="max-h-48 rounded-lg border border-gray-300"
              />
            ) : (
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-300">
                <p className="text-sm text-gray-600">PDF document attached</p>
              </div>
            )}
            <button
              onClick={removeProof}
              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
