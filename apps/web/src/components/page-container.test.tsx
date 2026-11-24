// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PageContainer } from './page-container';

describe('PageContainer', () => {
  it('defaults to the full width', () => {
    const { container } = render(<PageContainer>Content</PageContainer>);
    const classTokens = container.firstElementChild?.className.split(/\s+/) ?? [];

    expect(classTokens).toContain('w-full');
  });

  it('uses the narrow width without the full width class', () => {
    const { container } = render(<PageContainer width="narrow">Content</PageContainer>);
    const classTokens = container.firstElementChild?.className.split(/\s+/) ?? [];

    expect(classTokens).toContain('max-w-3xl');
    expect(classTokens).not.toContain('w-full');
  });

  it('appends a caller className after the width class', () => {
    const { container } = render(<PageContainer className="custom-width">Content</PageContainer>);
    const classTokens = container.firstElementChild?.className.split(/\s+/) ?? [];

    expect(classTokens.indexOf('w-full')).toBeLessThan(classTokens.indexOf('custom-width'));
  });
});
