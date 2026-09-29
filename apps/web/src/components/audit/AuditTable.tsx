import React, { useState } from 'react';

export interface AuditLog {
  id: string;
  actor: string; // Email or wallet
  ipAddress: string;
  timestamp: string;
  actionType: string;
  details: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    description?: string;
  };
}

interface AuditTableProps {
  logs: AuditLog[];
  isLoading: boolean;
  onFilterChange: (filters: { actionType?: string; actor?: string }) => void;
}

export const AuditTable: React.FC<AuditTableProps> = ({ logs, isLoading, onFilterChange }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');

  const handleApplyFilters = () => {
    onFilterChange({ actionType: filterAction, actor: filterActor });
  };

  const handleExport = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      'Timestamp,Actor,Action,IP Address\n' +
      logs.map((e) => `${e.timestamp},${e.actor},${e.actionType},${e.ipAddress}`).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'audit_logs_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 space-y-4 sm:space-y-0">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Audit Trail</h2>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded-md text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-800"
        >
          Export CSV
        </button>
      </div>

      <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 mb-6">
        <input
          type="text"
          placeholder="Filter by actor (email)"
          value={filterActor}
          onChange={(e) => setFilterActor(e.target.value)}
          className="border border-gray-300 rounded-md p-2 text-sm w-full sm:w-64"
        />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="border border-gray-300 rounded-md p-2 text-sm w-full sm:w-64"
        >
          <option value="">All Actions</option>
          <option value="Changed Treasury Address">Changed Treasury Address</option>
          <option value="Revoked API Key">Revoked API Key</option>
          <option value="Issued Refund">Issued Refund</option>
          <option value="Invited Team Member">Invited Team Member</option>
        </select>
        <button
          onClick={handleApplyFilters}
          className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md text-sm font-medium"
        >
          Apply Filters
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10">
          <p className="text-gray-500">Loading logs...</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IP Address
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {log.actor}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {log.actionType}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {log.ipAddress}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {expandedId === log.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-gray-50 dark:bg-gray-900">
                        <div className="text-sm text-gray-700 dark:text-gray-300">
                          {log.details.description && (
                            <p className="mb-2">{log.details.description}</p>
                          )}
                          {log.details.before && log.details.after && (
                            <div className="grid grid-cols-2 gap-4 mt-2">
                              <div>
                                <h4 className="font-semibold mb-1 text-red-600">Before:</h4>
                                <pre className="bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto text-xs">
                                  {JSON.stringify(log.details.before, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <h4 className="font-semibold mb-1 text-green-600">After:</h4>
                                <pre className="bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto text-xs">
                                  {JSON.stringify(log.details.after, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No audit logs found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
