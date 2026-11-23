// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingStepper } from './OnboardingStepper';

describe('OnboardingStepper', () => {
  const steps = [
    { title: 'Connect wallet', complete: true },
    { title: 'Set up store', complete: false },
    { title: 'Add payment address', complete: false },
    { title: 'Review', complete: false },
  ];

  it('announces a completed step without exposing the checkmark glyph', () => {
    render(<OnboardingStepper steps={steps} activeStep={0} onSelect={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Step 1 of 4, completed: Connect wallet' });
    expect(button).toHaveAttribute('aria-current', 'step');
    expect(button).toHaveTextContent('Connect wallet');
    expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true');
    expect(button).not.toHaveTextContent('Step 1 of 4');
    expect(screen.queryByRole('button', { name: /✓/ })).not.toBeInTheDocument();
  });

  it('announces a pending step and leaves the visible number and aria-current unchanged', () => {
    render(<OnboardingStepper steps={steps} activeStep={0} onSelect={vi.fn()} />);

    const button = screen.getByRole('button', {
      name: 'Step 2 of 4, not completed: Set up store',
    });
    expect(button).not.toHaveAttribute('aria-current');
    expect(screen.getByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveTextContent('Set up store');
  });

  it('selects the step whose button is activated', () => {
    const onSelect = vi.fn();
    render(<OnboardingStepper steps={steps} activeStep={0} onSelect={onSelect} />);

    screen.getByRole('button', { name: 'Step 3 of 4, not completed: Add payment address' }).click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
  });
});
