/**
 * Dispute reason categories as defined in the escrow contract.
 *
 * Lives in its own module rather than in `DisputeFlowModal.tsx` so the step
 * components can import it without creating an import cycle back through the
 * modal (which would leave `DisputeReason` undefined at module-init time).
 */
export enum DisputeReason {
  NON_DELIVERY = 'non_delivery',
  DEFECTIVE_GOODS = 'defective_goods',
  UNAUTHORIZED_CHARGE = 'unauthorized_charge',
}
