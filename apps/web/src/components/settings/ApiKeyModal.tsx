'use client';

import { useState } from 'react';

export interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (name: string, permissions: string[]) => void;
}

export function ApiKeyModal({ isOpen, onClose, onGenerate }: ApiKeyModalProps) {
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<string[]>(['read']);

  if (!isOpen) return null;

  const togglePermission = (perm: string) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onGenerate(name.trim(), permissions);
      setName('');
      setPermissions(['read']);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Generate API Key</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Key Name</label>
            <input
              type="text"
              required
              className="w-full border rounded p-2"
              placeholder="e.g. Production Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Scoped Permissions</label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={permissions.includes('read')}
                  onChange={() => togglePermission('read')}
                  className="mr-2"
                />
                Read (View transactions and balances)
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={permissions.includes('write')}
                  onChange={() => togglePermission('write')}
                  className="mr-2"
                />
                Write (Create escrows and invoices)
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={permissions.includes('admin')}
                  onChange={() => togglePermission('admin')}
                  className="mr-2"
                />
                Admin (Manage settings and keys)
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              className="px-4 py-2 border rounded hover:bg-gray-100"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={!name.trim() || permissions.length === 0}
            >
              Generate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
