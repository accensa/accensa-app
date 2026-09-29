import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BatchUploadModal } from './BatchUploadModal';

describe('BatchUploadModal', () => {
  it('renders the upload input', () => {
    const html = renderToString(<BatchUploadModal onClose={() => {}} escrowBalance={1000} />);
    expect(html).toContain('Batch Refund Upload');
    expect(html).toContain('Upload CSV');
    expect(html).toContain('type="file"');
  });
});
