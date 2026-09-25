import React, { useState } from 'react';
import { fetchTokenMetadata, TokenMetadata, validateSep41Compliance } from '../../lib/stellar/tokenMetadata';

export const AssetSelectorModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [contractId, setContractId] = useState('');
  const [tokenData, setTokenData] = useState<TokenMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fallbackAsset, setFallbackAsset] = useState('USDC');

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setTokenData(null);

    try {
      const isValid = await validateSep41Compliance(contractId);
      if (!isValid) {
        throw new Error('Asset is not SEP-41 compliant or contract ID is invalid.');
      }
      
      const metadata = await fetchTokenMetadata(contractId);
      setTokenData(metadata);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch token metadata');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToken = () => {
    // Logic to save the token in user settings
    console.log('Added token:', tokenData, 'Fallback:', fallbackAsset);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="text-xl font-bold mb-4">Add Custom Token (SEP-41)</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Contract Address</label>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="C..." 
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="border p-2 flex-1 rounded"
            />
            <button onClick={handleSearch} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        </div>

        {tokenData && (
          <div className="mb-4 p-4 border rounded bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-lg">{tokenData.name} ({tokenData.symbol})</h3>
              {tokenData.isVerified && <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full">Verified</span>}
            </div>
            <p className="text-sm">Decimals: {tokenData.decimals}</p>
            <p className="text-sm">Balance: {tokenData.balance}</p>
            <p className="text-sm">USD Rate: ${tokenData.usdExchangeRate}</p>
          </div>
        )}

        {tokenData && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Fallback Asset (For Currency Conversion)</label>
            <select 
              value={fallbackAsset} 
              onChange={(e) => setFallbackAsset(e.target.value)}
              className="border p-2 w-full rounded"
            >
              <option value="USDC">USDC</option>
              <option value="XLM">XLM</option>
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button 
            onClick={handleAddToken} 
            disabled={!tokenData} 
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
          >
            Add Token
          </button>
        </div>
      </div>
    </div>
  );
};
