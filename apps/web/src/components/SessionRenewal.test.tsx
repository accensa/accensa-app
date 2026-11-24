// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseSessionRenewal } = vi.hoisted(() => ({
  mockUseSessionRenewal: vi.fn(),
}));

vi.mock('@/hooks/useSessionRenewal', () => ({
  useSessionRenewal: mockUseSessionRenewal,
}));

import { SessionRenewal } from './SessionRenewal';

describe('SessionRenewal', () => {
  beforeEach(() => {
    mockUseSessionRenewal.mockClear();
  });

  it('calls the renewal hook once on mount, not on rerender, and unmounts cleanly', () => {
    const element = <SessionRenewal />;
    const { container, rerender, unmount } = render(element);

    expect(mockUseSessionRenewal).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();

    rerender(element);

    expect(mockUseSessionRenewal).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();

    expect(() => unmount()).not.toThrow();
    expect(container).toBeEmptyDOMElement();
  });
});
