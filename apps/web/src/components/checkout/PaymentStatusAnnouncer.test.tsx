import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentStatusAnnouncer } from './PaymentStatusAnnouncer';

describe('PaymentStatusAnnouncer', () => {
  it('announces each transaction status politely', () => {
    for (const status of ['pending', 'confirmed', 'failed'] as const) {
      const html = renderToString(<PaymentStatusAnnouncer status={status} />);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(`Payment ${status === 'failed' ? 'failed' : status}`);
    }
  });
});