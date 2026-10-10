'use client';

import { useEffect, useState } from 'react';
import { ApiKeyModal } from '@/components/settings/ApiKeyModal';

export default function ApiKeysPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [keys, setKeys] = useState<
    {
      id: string;
      name: string;
      permissions: string[];
      key_prefix: string;
      created_at: string;
      revoked_at: string | null;
    }[]
  >([]);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadKeys() {
    const response = await fetch('/api/merchant/api-keys', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load API keys');
    const result = (await response.json()) as { keys: typeof keys };
    setKeys(result.keys);
  }

  useEffect(() => {
    let active = true;
    fetch('/api/merchant/api-keys', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load API keys');
        return (await response.json()) as { keys: typeof keys };
      })
      .then((result) => {
        if (active) setKeys(result.keys);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load API keys');
      });
    return () => {
      active = false;
    };
  }, []);

  const handleGenerate = async (name: string, permissions: string[]) => {
    try {
      const response = await fetch('/api/merchant/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, permissions }),
      });
      const result = (await response.json()) as { id?: string; secret?: string; error?: string };
      if (!response.ok || !result.secret)
        throw new Error(result.error ?? 'Unable to create API key');
      setNewKeySecret(result.secret);
      setIsModalOpen(false);
      await loadKeys();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create API key');
    }
  };

  const revokeKey = async (id: string) => {
    if (confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      const response = await fetch('/api/merchant/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revokeId: id }),
      });
      if (response.ok) await loadKeys();
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-gray-600 mt-1">Manage your secret keys for server-side API access.</p>
        </div>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {error}
          </p>
        )}
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
                Status
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
                  <div className="text-sm text-gray-500">{key.key_prefix}…</div>
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
                  {new Date(key.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {key.revoked_at ? 'Revoked' : 'Active'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => revokeKey(key.id)}
                    disabled={Boolean(key.revoked_at)}
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
