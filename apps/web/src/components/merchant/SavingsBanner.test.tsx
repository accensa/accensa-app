import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SavingsBanner } from './SavingsBanner';

function render(props: Partial<Parameters<typeof SavingsBanner>[0]> = {}) {
  const html = renderToString(
    <SavingsBanner
      monthSavings="145.6289800"
      totalSavings="148.8289700"
      monthTransactions={2}
      asset="XLM"
      monthLabel="September 2026"
      {...props}
    />,
  );
  // React inserts <!-- --> around interpolated values; strip them so
  // assertions read as the rendered text a user sees.
  return html.replace(/<!-- -->/g, '');
}

describe('SavingsBanner', () => {
  it('shows the animated counter at the month savings figure', () => {
    const html = render();
    expect(html).toContain('You have saved $145.63');
    expect(html).toContain('XLM');
  });

  it('states the month, transaction count, and all-time savings', () => {
    const html = render();
    expect(html).toContain('this month across 2 settled transactions');
    expect(html).toContain('$148.83 all time');
    expect(html).toContain('September 2026');
  });

  it('uses the singular form for one transaction', () => {
    expect(render({ monthTransactions: 1 })).toContain('across 1 settled transaction');
  });

  it('shows a milestone badge once $100 is saved', () => {
    const html = render({ monthSavings: '100.0000000' });
    expect(html).toContain('Milestone reached: $100.00 saved');
  });

  it('shows no milestone badge below $100', () => {
    expect(render({ monthSavings: '99.99' })).not.toContain('Milestone reached');
  });

  it('offers a share control', () => {
    expect(render()).toContain('Share');
  });
});
