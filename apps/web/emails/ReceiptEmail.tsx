import React from 'react';
// @ts-expect-error: @react-email/components lacks type definitions
import { Html, Head, Preview, Body, Container, Section, Text, Link } from '@react-email/components';
import { formatTimestamp } from '../src/lib/format-timestamp';

export interface ReceiptEmailProps {
  txHash: string;
  merchantName: string;
  amount: string;
  date: Date | string | number;
}

export const ReceiptEmail: React.FC<ReceiptEmailProps> = ({
  txHash,
  merchantName,
  amount,
  date,
}) => {
  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;

  return (
    <Html>
      <Head />
      <Preview>
        Your receipt from {merchantName} · {amount}
      </Preview>
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'sans-serif' }}>
        <Container>
          <Section>
            <Text style={{ fontSize: '24px', fontWeight: 'bold' }}>
              Receipt from {merchantName}
            </Text>
            <Text>Amount: {amount}</Text>
            <Text>Date: {formatTimestamp(date)}</Text>
            <Text>Transaction Hash: {txHash}</Text>
            <Link href={explorerUrl}>View on Stellar Explorer</Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};
