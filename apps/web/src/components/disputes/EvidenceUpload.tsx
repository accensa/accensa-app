'use client';

import { useRef, useState } from 'react';

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function validateEvidenceFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!ACCEPTED_EVIDENCE_TYPES.includes(file.type)) return 'Upload a PDF, JPG, or PNG file.';
  if (file.size > MAX_EVIDENCE_BYTES) return 'Evidence files must be 10 MB or smaller.';
  return null;
}

interface EvidenceUploadProps {
  disputeId: string;
  onUploaded?: (cid: string) => void;
}

export function EvidenceUpload({ disputeId, onUploaded }: EvidenceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    const validationError = validateEvidenceFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setStatus('Pinning evidence...');
    const body = new FormData();
    body.append('file', file);
    body.append('disputeId', disputeId);

    try {
      const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/evidence`, {
        method: 'POST',
        body,
      });
      if (!response.ok) throw new Error('Evidence could not be pinned.');
      const result = (await response.json()) as { cid: string };
      setStatus('Evidence pinned successfully.');
      onUploaded?.(result.cid);
    } catch (uploadError) {
      setStatus('');
      setError(uploadError instanceof Error ? uploadError.message : 'Evidence upload failed.');
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void upload(file);
  }

  return (
    <section aria-labelledby="evidence-upload-heading">
      <h2 id="evidence-upload-heading" className="text-lg font-semibold">
        Counter-evidence
      </h2>
      <div
        onDragEnter={() => setDragging(true)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`mt-3 rounded-lg border-2 border-dashed p-6 text-center ${dragging ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300'}`}
      >
        <p>Upload proof of shipment, tracking, or signed invoices.</p>
        <p className="mt-1 text-sm text-slate-600">PDF, JPG, or PNG up to 10 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EVIDENCE_TYPES.join(',')}
          className="sr-only"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Choose evidence
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-700">
        {status}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
