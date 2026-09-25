import { ReceiptEmailProps } from '../../emails/ReceiptEmail';

// Mock adapter for SendGrid / Resend
export const sendReceiptEmail = async (to: string, props: ReceiptEmailProps) => {
  console.log(`[Email Adapter] Sending email to ${to} for transaction ${props.txHash}`);
  // In a real implementation, we would use Resend or SendGrid SDK here
  return { success: true };
};
