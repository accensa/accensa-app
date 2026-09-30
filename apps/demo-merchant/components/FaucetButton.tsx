import React, { useState } from 'react';
import { fundTestnetAccount } from '../lib/stellar/faucet';

export function FaucetButton({
  publicKey,
  onFunded,
}: {
  publicKey: string;
  onFunded?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleFund = async () => {
    if (!publicKey) {
      setError('No wallet connected');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await fundTestnetAccount(publicKey);
      setSuccess('Funded 10,000 XLM!');
      onFunded?.();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to fund');
      setTimeout(() => setError(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleFund}
        disabled={loading || !publicKey}
        className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Funding...' : 'Claim 10,000 Testnet XLM'}
      </button>
      {error && <span className="text-red-500 text-sm">{error}</span>}
      {success && <span className="text-green-500 text-sm">{success}</span>}
    </div>
  );
}
