'use client';

export type PaymentStatus = 'pending' | 'confirmed' | 'failed';

const messages: Record<PaymentStatus, string> = {
  pending: 'Payment pending',
  confirmed: 'Payment confirmed',
  failed: 'Payment failed',
};

export function PaymentStatusAnnouncer({ status }: { status: PaymentStatus }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {messages[status]}
    </div>
  );
}
