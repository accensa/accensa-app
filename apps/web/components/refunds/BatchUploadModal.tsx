import React, { useState } from 'react';

export interface RefundRecord {
  transaction_id: string;
  amount: number;
  reason: string;
}

export interface BatchUploadModalProps {
  onClose: () => void;
  escrowBalance: number;
}

export function BatchUploadModal({ onClose, escrowBalance }: BatchUploadModalProps) {
  const [records, setRecords] = useState<RefundRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ id: string; status: 'success' | 'failed' }[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(Boolean);
      const parsedRecords: RefundRecord[] = lines.slice(1).map(line => {
        const [transaction_id, amount, reason] = line.split(',');
        return { 
          transaction_id: transaction_id?.trim() || '', 
          amount: parseFloat(amount?.trim() || '0'), 
          reason: reason?.trim() || ''
        };
      });
      setRecords(parsedRecords);
    };
    reader.readAsText(file);
  };

  const totalAmount = records.reduce((acc, rec) => acc + (rec.amount || 0), 0);
  const isOverdrawn = totalAmount > escrowBalance;

  const processBatch = async () => {
    if (isOverdrawn) return;
    setIsProcessing(true);
    setProgress(0);
    const newResults = [];
    for (let i = 0; i < records.length; i++) {
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 50));
      newResults.push({ id: records[i].transaction_id, status: 'success' as const });
      setProgress(Math.round(((i + 1) / records.length) * 100));
    }
    setResults(newResults);
    setIsProcessing(false);
  };

  const downloadReport = () => {
    if (typeof document === 'undefined') return;
    const csv = ['transaction_id,status', ...results.map(r => `${r.id},${r.status}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'refund_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="batch-upload-modal">
      <h2>Batch Refund Upload</h2>
      {!isProcessing && results.length === 0 && (
        <div>
          <label>
            Upload CSV (transaction_id,amount,reason)
            <input type="file" accept=".csv" onChange={handleFileUpload} />
          </label>
          {records.length > 0 && (
            <div className="preflight-summary">
              <p>Total Records: {records.length}</p>
              <p>Total Amount: {totalAmount}</p>
              {isOverdrawn && <p className="error" style={{ color: 'red' }}>Amount exceeds escrow balance!</p>}
              <button onClick={processBatch} disabled={isOverdrawn} className="process-button">
                Process Batch
              </button>
            </div>
          )}
        </div>
      )}
      {isProcessing && (
        <div className="progress-container">
          <p>Processing: {progress}%</p>
          <progress value={progress} max="100">{progress}%</progress>
        </div>
      )}
      {results.length > 0 && (
        <div className="results-container">
          <p>Processing Complete!</p>
          <button onClick={downloadReport} className="download-report">Download Report</button>
        </div>
      )}
      <button onClick={onClose} className="close-button">Close</button>
    </div>
  );
}
