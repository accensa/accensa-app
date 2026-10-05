import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Keypad from '../../../components/pos/Keypad';
import { useOnline } from '@/components/network-status';

interface OfflineTransaction {
  amount: string;
  date: string;
}

export default function POS() {
  const [amount, setAmount] = useState('0');
  const [offlineQueue, setOfflineQueue] = useState<OfflineTransaction[]>([]);
  // useSyncExternalStore-backed, so the server render and hydration agree
  // (both assume online) and the real value is read on the client.
  const isOnline = useOnline();

  useEffect(() => {
    const handleOnline = () => {
      // Process offline queue when back online
      if (offlineQueue.length > 0) {
        console.log('Processing offline transactions', offlineQueue);
        setOfflineQueue([]);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [offlineQueue]);

  const handleInput = (val: string) => {
    setAmount((prev) => (prev === '0' ? val : prev + val));
  };

  const handleClear = () => {
    setAmount('0');
  };

  const handleSubmit = () => {
    const tx = { amount, date: new Date().toISOString() };
    if (!isOnline) {
      setOfflineQueue((prev) => [...prev, tx]);
      alert('You are offline. Transaction queued.');
    } else {
      alert(`Processing payment for $${(parseInt(amount) / 100).toFixed(2)}`);
    }
    setAmount('0');
  };

  const displayAmount = (parseInt(amount) / 100).toFixed(2);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <Head>
        <title>Accensa POS</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"
        />
      </Head>

      <div className="w-full max-w-sm bg-white shadow-lg rounded-xl p-6 flex flex-col items-center">
        {!isOnline && (
          <div className="mb-4 bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full text-sm font-medium">
            Offline Mode ({offlineQueue.length} queued)
          </div>
        )}

        <div className="text-gray-500 mb-2">Total Amount</div>
        <div className="text-5xl font-mono font-bold mb-8 tracking-tighter">${displayAmount}</div>

        <Keypad onInput={handleInput} onClear={handleClear} onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
