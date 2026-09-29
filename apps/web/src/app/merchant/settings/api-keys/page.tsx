'use client';

import { useState } from 'react';
import { ApiKeyModal } from '@/components/settings/ApiKeyModal';

export default function ApiKeysPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [keys, setKeys] = useState<
    { id: string; name: string; permissions: string[]; createdAt: string; lastUsed?: string }[]
  >([
    {
      id: 'key_1',
      name: 'Development Backend',
      permissions: ['read', 'write'],
      createdAt: new Date().toISOString(),
    },
  ]);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);

  const handleGenerate = (name: string, permissions: string[]) => {
    // In a real application, this would call the backend to generate the key.
    const secret = 'sk_test_' + Math.random().toString(36).substring(2, 15);
    setNewKeySecret(secret);
    setKeys([
      ...keys,
      {
        id: 'key_' + Math.random().toString(36).substring(2, 9),
        name,
        permissions,
        createdAt: new Date().toISOString(),
      },
    ]);
    setIsModalOpen(false);
  };

  const revokeKey = (id: string) => {
    // In a real application, this would call the backend to revoke the key.
    if (confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      setKeys(keys.filter((k) => k.id !== id));
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-gray-600 mt-1">Manage your secret keys for server-side API access.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Create API Key
        </button>
      </div>

      {newKeySecret && (
        <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="text-green-800 font-bold mb-2">Save your new API Key</h3>
          <p className="text-green-700 mb-4">
            Please copy this key and save it somewhere secure. For security reasons, we cannot show
            it to you again.
          </p>
          <div className="flex items-center space-x-2">
            <code className="bg-white px-4 py-2 border rounded flex-1 select-all">
              {newKeySecret}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(newKeySecret);
                alert('Copied to clipboard!');
              }}
              className="px-4 py-2 bg-white border rounded hover:bg-gray-50"
            >
              Copy
            </button>
          </div>
          <button
            className="mt-4 text-sm text-green-700 underline"
            onClick={() => setNewKeySecret(null)}
          >
            I have saved this key safely
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Permissions
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Used
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {keys.map((key) => (
              <tr key={key.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium text-gray-900">{key.name}</div>
                  <div className="text-sm text-gray-500">{key.id}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {key.permissions.map((p) => (
                      <span key={p} className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(key.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => revokeKey(key.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No API keys found. Generate one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ApiKeyModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
