'use client';

import React, { useEffect, useState } from 'react';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

interface Payment {
  tx_hash: string;
  amount: number;
  payer: string;
  timestamp: string;
}

export default function Dashboard() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);

  // Fetch from the live Go indexer API
  useEffect(() => {
    const fetchPayments = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:8080';
        const res = await fetch(`${apiUrl}/api/payments`);
        if (res.ok) {
          const data: Payment[] = await res.json();
          setPayments(data);
          setTotal(data.reduce((acc: number, p: Payment) => acc + p.amount, 0));
        }
      } catch (error) {
        console.error("Failed to fetch payments", error);
      }
    };
    
    fetchPayments();
    // Poll every 5 seconds
    const interval = setInterval(fetchPayments, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className={`min-h-screen bg-[#0a0a0a] text-white p-8 md:p-24 ${inter.className}`}>
      {/* Background gradients */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-teal-600/20 blur-[120px]" />
      </div>

      <div className="max-w-6xl mx-auto space-y-12">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
              Accensa Dashboard
            </h1>
            <p className="text-gray-400 mt-2">M1 Milestone: Path A (Chain-Only Truth)</p>
          </div>
          
          {/* Total Metric Card */}
          <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-6 flex flex-col min-w-[240px] shadow-2xl transition-transform hover:scale-[1.02]">
            <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">Total Volume Settled</span>
            <span className="text-4xl font-light mt-2 flex items-baseline gap-2">
              <span className="text-emerald-400">$</span>
              {total.toFixed(2)}
              <span className="text-lg text-gray-500">USDC</span>
            </span>
          </div>
        </header>

        {/* Payments Table */}
        <section className="bg-white/5 border border-white/10 backdrop-blur-lg rounded-3xl overflow-hidden shadow-2xl">
          <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center">
            <h2 className="text-xl font-semibold">Recent Chain Settlements</h2>
            <div className="flex gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs text-emerald-400 font-medium">Live Polling Active</span>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 text-gray-400 text-sm border-b border-white/10">
                  <th className="px-8 py-4 font-medium">Transaction Hash</th>
                  <th className="px-8 py-4 font-medium">Amount</th>
                  <th className="px-8 py-4 font-medium">Payer (From)</th>
                  <th className="px-8 py-4 font-medium">Time</th>
                  <th className="px-8 py-4 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {payments.map((payment: Payment) => (
                  <tr key={payment.tx_hash} className="hover:bg-white/[0.03] transition-colors group">
                    <td className="px-8 py-5 font-mono text-emerald-300 group-hover:text-emerald-400 transition-colors truncate max-w-[200px]" title={payment.tx_hash}>
                      {payment.tx_hash.substring(0, 8)}...{payment.tx_hash.substring(payment.tx_hash.length - 6)}
                    </td>
                    <td className="px-8 py-5">
                      <span className="font-semibold text-lg">{Number(payment.amount).toFixed(2)}</span>
                      <span className="text-gray-500 ml-1 text-sm">USDC</span>
                    </td>
                    <td className="px-8 py-5 font-mono text-gray-400 text-sm truncate max-w-[150px]" title={payment.payer}>
                      {payment.payer.substring(0, 4)}...{payment.payer.substring(payment.payer.length - 4)}
                    </td>
                    <td className="px-8 py-5 text-gray-400 text-sm">
                      {new Date(payment.timestamp).toLocaleString()}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Settled
                      </span>
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-8 py-12 text-center text-gray-500">
                      No payments recorded yet. Polling indexer...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
