'use client';

import { useState } from 'react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const [format, setFormat] = useState('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = () => {
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;

    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      setError('Enter a valid date for both the From and To fields.');
      return;
    }

    if (from && to && from.getTime() > to.getTime()) {
      setError('The From Date must be on or before the To Date.');
      return;
    }

    setError(null);

    const params = new URLSearchParams();
    if (from) params.set('date_from', from.toISOString());
    if (to) params.set('date_to', to.toISOString());
    if (status !== 'all') {
      // Add status filter if applicable (e.g. refunded etc)
    }

    // In a real app we might handle different formats, but the API currently supports CSV
    const url = `/api/reports/export?${params.toString()}`;
    window.open(url, '_blank');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Export Financial Report</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Format</label>
          <select
            className="w-full border rounded p-2"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="csv">CSV (Accounting / Ledger)</option>
            <option value="json">JSON</option>
            <option value="excel">Excel (XLSX)</option>
          </select>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">From Date</label>
            <input
              type="date"
              className="w-full border rounded p-2"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setError(null);
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">To Date</label>
            <input
              type="date"
              className="w-full border rounded p-2"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setError(null);
              }}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">Transaction Status</label>
          <select
            className="w-full border rounded p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All Transactions</option>
            <option value="settled">Settled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>

        <div className="flex justify-end space-x-2">
          <button className="px-4 py-2 border rounded hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={handleExport}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
