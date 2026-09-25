'use client';

import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft, AlertCircle } from 'lucide-react';
import { z } from 'zod';
import { StepSelection } from './steps/StepSelection';
import { StepReason } from './steps/StepReason';
import { StepPreview } from './steps/StepPreview';

/**
 * Dispute reason categories as defined in the escrow contract
 */
export enum DisputeReason {
  NON_DELIVERY = 'non_delivery',
  DEFECTIVE_GOODS = 'defective_goods',
  UNAUTHORIZED_CHARGE = 'unauthorized_charge',
}

/**
 * Validation schema for dispute request payload
 */
export const disputeRequestSchema = z.object({
  txHash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Invalid transaction hash'),
  refundAmount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'Invalid amount format'),
  reason: z.nativeEnum(DisputeReason),
  description: z.string().min(10, 'Description must be at least 10 characters').max(500),
  proofAttachment: z.string().optional(),
});

export type DisputeRequest = z.infer<typeof disputeRequestSchema>;

export interface DisputeFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionHash: string;
  transactionAmount: string;
  assetSymbol: string;
  onSubmitDispute: (request: DisputeRequest) => Promise<void>;
}

export type DisputeStep = 'selection' | 'reason' | 'preview';

export interface DisputeFormData {
  refundAmount: string;
  reason: DisputeReason | null;
  description: string;
  proofAttachment: string | null;
}

/**
 * Multi-step modal for customer dispute and refund requests
 * 
 * State machine manages transitions between:
 * 1. Selection - Choose refund amount from transaction
 * 2. Reason - Classify dispute type with optional proof
 * 3. Preview - Review fees and confirm submission
 */
export function DisputeFlowModal({
  isOpen,
  onClose,
  transactionHash,
  transactionAmount,
  assetSymbol,
  onSubmitDispute,
}: DisputeFlowModalProps) {
  const [currentStep, setCurrentStep] = useState<DisputeStep>('selection');
  const [formData, setFormData] = useState<DisputeFormData>({
    refundAmount: transactionAmount,
    reason: null,
    description: '',
    proofAttachment: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const canProceed = () => {
    switch (currentStep) {
      case 'selection':
        return formData.refundAmount && parseFloat(formData.refundAmount) > 0;
      case 'reason':
        return formData.reason && formData.description.length >= 10;
      case 'preview':
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    setError(null);
    if (currentStep === 'selection') setCurrentStep('reason');
    else if (currentStep === 'reason') setCurrentStep('preview');
  };

  const handleBack = () => {
    setError(null);
    if (currentStep === 'reason') setCurrentStep('selection');
    else if (currentStep === 'preview') setCurrentStep('reason');
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const request: DisputeRequest = {
        txHash: transactionHash,
        refundAmount: formData.refundAmount,
        reason: formData.reason!,
        description: formData.description,
        proofAttachment: formData.proofAttachment || undefined,
      };

      // Validate against schema
      disputeRequestSchema.parse(request);

      await onSubmitDispute(request);
      onClose();
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.issues[0].message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to submit dispute');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitles: Record<DisputeStep, string> = {
    selection: 'Select Refund Amount',
    reason: 'Dispute Reason',
    preview: 'Review & Confirm',
  };

  const stepNumbers: Record<DisputeStep, number> = {
    selection: 1,
    reason: 2,
    preview: 3,
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold">Request Refund</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Stepper */}
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between mb-6">
            {(['selection', 'reason', 'preview'] as DisputeStep[]).map((step) => (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      currentStep === step
                        ? 'bg-blue-600 text-white'
                        : stepNumbers[currentStep] > stepNumbers[step]
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {stepNumbers[currentStep] > stepNumbers[step] ? '✓' : stepNumbers[step]}
                  </div>
                  <span className="text-xs mt-2 text-gray-600">{stepTitles[step]}</span>
                </div>
                {step !== 'preview' && (
                  <div className="flex-1 h-0.5 mx-2 bg-gray-200" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Step Content */}
        <div className="p-6">
          {currentStep === 'selection' && (
            <StepSelection
              transactionAmount={transactionAmount}
              assetSymbol={assetSymbol}
              refundAmount={formData.refundAmount}
              onAmountChange={(amount) => setFormData({ ...formData, refundAmount: amount })}
            />
          )}

          {currentStep === 'reason' && (
            <StepReason
              reason={formData.reason}
              description={formData.description}
              proofAttachment={formData.proofAttachment}
              onReasonChange={(reason) => setFormData({ ...formData, reason })}
              onDescriptionChange={(description) => setFormData({ ...formData, description })}
              onProofChange={(proof) => setFormData({ ...formData, proofAttachment: proof })}
            />
          )}

          {currentStep === 'preview' && (
            <StepPreview
              transactionHash={transactionHash}
              refundAmount={formData.refundAmount}
              assetSymbol={assetSymbol}
              reason={formData.reason!}
              description={formData.description}
              hasProof={!!formData.proofAttachment}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          {currentStep !== 'selection' && (
            <button
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}

          {currentStep !== 'preview' ? (
            <button
              onClick={handleNext}
              disabled={!canProceed() || isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Dispute'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
