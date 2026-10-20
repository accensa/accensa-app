'use client';

import React from 'react';
import {
  calculateTax,
  type MerchantTaxRule,
  type ProductTaxClassification,
  type TaxBreakdown,
} from '../../src/lib/tax/taxService';

export interface TaxLineItemProps {
  subtotal: number;
  country?: string;
  postalCode?: string;
  classification?: ProductTaxClassification;
  rule?: MerchantTaxRule;
  onTaxCalculated?: (result: TaxBreakdown) => void;
  className?: string;
}

/**
 * Renders an estimated sales tax or VAT line item in checkout totals.
 * Transparently displays tax percentage, jurisdiction, and calculated amount before payment authorization.
 */
export default function TaxLineItem({
  subtotal,
  country = 'US',
  postalCode = '',
  classification = 'standard',
  rule,
  onTaxCalculated,
  className = 'flex justify-between text-gray-600',
}: TaxLineItemProps) {
  const ruleKey = JSON.stringify(rule ?? null);
  const tax = React.useMemo(
    () => calculateTax({ subtotal, country, postalCode, classification, rule }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subtotal, country, postalCode, classification, ruleKey],
  );

  const cbRef = React.useRef(onTaxCalculated);
  React.useEffect(() => {
    cbRef.current = onTaxCalculated;
  });

  React.useEffect(() => {
    cbRef.current?.(tax);
  }, [tax]);

  const label =
    tax.type === 'EU_VAT'
      ? `Estimated VAT (${tax.jurisdiction})`
      : tax.type === 'US_STATE'
        ? `Estimated Sales Tax (${tax.jurisdiction})`
        : `Estimated Tax (${tax.jurisdiction})`;

  return (
    <div className={className} data-testid="checkout-tax-line">
      <span data-testid="checkout-tax-label">
        {label} ({tax.percentage.toFixed(2)}%)
      </span>
      <span data-testid="checkout-tax-amount">${tax.amount.toFixed(2)}</span>
    </div>
  );
}

export { TaxLineItem };
