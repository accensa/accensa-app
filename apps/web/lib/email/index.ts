import { ReceiptEmailProps } from '../../emails/ReceiptEmail';

export type SendReceiptResult =
  { status: 'sent' } | { status: 'not-configured' } | { status: 'invalid-recipient' };

function isValidEmail(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

// Mock adapter for SendGrid / Resend
export const sendReceiptEmail = async (
  to: string,
  props: ReceiptEmailProps,
): Promise<SendReceiptResult> => {
  if (!isValidEmail(to)) {
    return { status: 'invalid-recipient' };
  }
  console.log(`[Email Adapter] No provider configured for transaction ${props.txHash}`);
  // In a real implementation, we would use Resend or SendGrid SDK here
  return { status: 'not-configured' };
};
