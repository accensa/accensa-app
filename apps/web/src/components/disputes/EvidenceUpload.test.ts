import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES, validateEvidenceFile } from './EvidenceUpload';

describe('validateEvidenceFile', () => {
  it('accepts supported documents and images within the size limit', () => {
    expect(validateEvidenceFile({ type: 'application/pdf', size: MAX_EVIDENCE_BYTES })).toBeNull();
    expect(validateEvidenceFile({ type: 'image/png', size: 100 })).toBeNull();
  });

  it('rejects unsupported types and oversized files', () => {
    expect(validateEvidenceFile({ type: 'text/plain', size: 100 })).toBeTruthy();
    expect(validateEvidenceFile({ type: 'image/jpeg', size: MAX_EVIDENCE_BYTES + 1 })).toBeTruthy();
  });
});
