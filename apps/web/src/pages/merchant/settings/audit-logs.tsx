import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { AuditTable, AuditLog } from '../../../components/audit/AuditTable';

// Mock data to represent server response
const MOCK_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    actor: 'admin@merchant.com',
    ipAddress: '192.168.1.100',
    timestamp: new Date().toISOString(),
    actionType: 'Changed Treasury Address',
    details: {
      before: { address: 'GABC...' },
      after: { address: 'GXYZ...' },
    },
  },
  {
    id: 'log-2',
    actor: 'staff@merchant.com',
    ipAddress: '10.0.0.50',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    actionType: 'Issued Refund',
    details: {
      description: 'Refunded $45.00 for order #12345',
    },
  },
  {
    id: 'log-3',
    actor: 'admin@merchant.com',
    ipAddress: '192.168.1.100',
    timestamp: new Date(Date.now() - 172800000).toISOString(),
    actionType: 'Revoked API Key',
    details: {
      description: 'Revoked key ending in ...8f9a',
    },
  },
];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Simulate fetching data with cursor-based pagination
  const fetchLogs = (filters: { actionType?: string; actor?: string }) => {
    setIsLoading(true);
    setTimeout(() => {
      let filtered = [...MOCK_LOGS];
      if (filters.actionType) {
        filtered = filtered.filter((l) => l.actionType === filters.actionType);
      }
      if (filters.actor) {
        filtered = filtered.filter((l) => l.actor.includes(filters.actor!));
      }
      setLogs(filtered);
      setIsLoading(false);
    }, 600);
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchLogs({}), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
      <Head>
        <title>Audit Logs - Accensa Merchant</title>
      </Head>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Team Activity Logs</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Monitor actions performed by team members within your organization. These logs are
          tamper-evident and can be exported for compliance auditing.
        </p>
      </div>

      <AuditTable logs={logs} isLoading={isLoading} onFilterChange={fetchLogs} />
    </div>
  );
}
