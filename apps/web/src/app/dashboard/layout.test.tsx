// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from './layout';

let shouldThrow = false;
const onSentinelRender = vi.fn();

function Sentinel() {
  onSentinelRender();
  return <p>sentinel child</p>;
}

function MaybeThrows() {
  if (shouldThrow) throw new Error('widget exploded');
  return <p>recovered child</p>;
}

beforeEach(() => {
  shouldThrow = false;
  onSentinelRender.mockClear();
  // React and the boundary both log the expected crash.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardLayout', () => {
  it('renders a child route exactly once', () => {
    render(
      <DashboardLayout>
        <Sentinel />
      </DashboardLayout>,
    );

    expect(screen.getByText('sentinel child')).toBeInTheDocument();
    expect(onSentinelRender).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('shows the fallback instead of the children when a child throws', () => {
    shouldThrow = true;
    render(
      <DashboardLayout>
        <MaybeThrows />
      </DashboardLayout>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('widget exploded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('recovered child')).not.toBeInTheDocument();
  });

  it('removes sibling content when the boundary trips, then restores it on retry', () => {
    shouldThrow = true;
    render(
      <DashboardLayout>
        <Sentinel />
        <MaybeThrows />
      </DashboardLayout>,
    );

    expect(screen.queryByText('sentinel child')).not.toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByText('sentinel child')).toBeInTheDocument();
    expect(screen.getByText('recovered child')).toBeInTheDocument();
  });
});
