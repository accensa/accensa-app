// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FaqAccordion, type FaqData } from './faq-accordion';

const mockFaqs: FaqData[] = [
  {
    question: 'How does payment attribution work?',
    answer: 'Payments are attributed via route tags attached during API execution.',
  },
  {
    question: 'What assets are supported?',
    answer: 'Accensa supports XLM and native Stellar assets such as USDC.',
  },
  {
    question: 'How do I verify a receipt?',
    answer: 'Receipts can be verified cryptographically against Soroban contract Merkle roots.',
  },
];

describe('FaqAccordion', () => {
  beforeEach(() => {
    const style = document.createElement('style');
    style.id = 'faq-test-style';
    style.textContent = '.opacity-0 { opacity: 0; } .opacity-100 { opacity: 1; }';
    document.head.appendChild(style);
  });

  afterEach(() => {
    cleanup();
    document.getElementById('faq-test-style')?.remove();
  });

  it('renders all questions with answers initially not visible', () => {
    render(<FaqAccordion items={mockFaqs} />);

    expect(screen.getByText('How does payment attribution work?')).toBeInTheDocument();
    expect(screen.getByText('What assets are supported?')).toBeInTheDocument();
    expect(screen.getByText('How do I verify a receipt?')).toBeInTheDocument();

    expect(
      screen.getByText('Payments are attributed via route tags attached during API execution.'),
    ).not.toBeVisible();
    expect(
      screen.getByText('Accensa supports XLM and native Stellar assets such as USDC.'),
    ).not.toBeVisible();
    expect(
      screen.getByText(
        'Receipts can be verified cryptographically against Soroban contract Merkle roots.',
      ),
    ).not.toBeVisible();
  });

  it('makes the answer visible only for the open item', () => {
    render(<FaqAccordion items={mockFaqs} />);

    fireEvent.click(screen.getByText('How does payment attribution work?'));

    expect(
      screen.getByText('Payments are attributed via route tags attached during API execution.'),
    ).toBeVisible();
    expect(
      screen.getByText('Accensa supports XLM and native Stellar assets such as USDC.'),
    ).not.toBeVisible();
    expect(
      screen.getByText(
        'Receipts can be verified cryptographically against Soroban contract Merkle roots.',
      ),
    ).not.toBeVisible();
  });

  it('closes the previously open item when another item is opened', () => {
    render(<FaqAccordion items={mockFaqs} />);

    fireEvent.click(screen.getByText('How does payment attribution work?'));
    expect(
      screen.getByText('Payments are attributed via route tags attached during API execution.'),
    ).toBeVisible();

    fireEvent.click(screen.getByText('What assets are supported?'));
    expect(
      screen.getByText('Payments are attributed via route tags attached during API execution.'),
    ).not.toBeVisible();
    expect(
      screen.getByText('Accensa supports XLM and native Stellar assets such as USDC.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Receipts can be verified cryptographically against Soroban contract Merkle roots.',
      ),
    ).not.toBeVisible();
  });

  it('closes an open item when clicked again so that no answers are open', () => {
    render(<FaqAccordion items={mockFaqs} />);

    const firstQuestion = screen.getByText('How does payment attribution work?');
    fireEvent.click(firstQuestion);
    expect(
      screen.getByText('Payments are attributed via route tags attached during API execution.'),
    ).toBeVisible();

    fireEvent.click(firstQuestion);
    expect(
      screen.getByText('Payments are attributed via route tags attached during API execution.'),
    ).not.toBeVisible();
    expect(
      screen.getByText('Accensa supports XLM and native Stellar assets such as USDC.'),
    ).not.toBeVisible();
    expect(
      screen.getByText(
        'Receipts can be verified cryptographically against Soroban contract Merkle roots.',
      ),
    ).not.toBeVisible();
  });
});
