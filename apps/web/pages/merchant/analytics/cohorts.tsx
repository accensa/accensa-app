import React from 'react';
import Head from 'next/head';
import CohortHeatmap from '../../../components/analytics/CohortHeatmap';

// Mock data representing pre-aggregated cohort data
const mockCohortData = [
  { cohort: 'Jan 2026', size: 1200, retention: [100, 45, 32, 28, 25, 22] },
  { cohort: 'Feb 2026', size: 1450, retention: [100, 48, 35, 30, 26] },
  { cohort: 'Mar 2026', size: 1600, retention: [100, 52, 38, 32] },
  { cohort: 'Apr 2026', size: 1800, retention: [100, 55, 42] },
  { cohort: 'May 2026', size: 2100, retention: [100, 58] },
  { cohort: 'Jun 2026', size: 2400, retention: [100] },
];

export default function CohortAnalytics() {
  const aov = 142.5;
  const ltv = 854.2;
  const refundFreq = 2.4;

  const exportCSV = () => {
    const header = [
      'Cohort',
      'Size',
      ...Array.from({ length: 6 }).map((_, i) => `Month ${i}`),
    ].join(',');
    const rows = mockCohortData.map((d) => [d.cohort, d.size, ...d.retention].join(',')).join('\n');

    const csvContent = `data:text/csv;charset=utf-8,${header}\n${rows}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'cohort_retention.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <Head>
        <title>Customer Cohorts - Analytics</title>
      </Head>

      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cohort Analysis</h1>
            <p className="text-gray-500 mt-1">Track customer retention over time</p>
          </div>
          <button
            onClick={exportCSV}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded shadow-sm hover:bg-gray-50 font-medium"
          >
            Export CSV
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wide">Average Order Value</div>
            <div className="text-3xl font-semibold mt-2">${aov.toFixed(2)}</div>
          </div>
          <div className="bg-white p-6 rounded shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wide">Net LTV</div>
            <div className="text-3xl font-semibold mt-2">${ltv.toFixed(2)}</div>
          </div>
          <div className="bg-white p-6 rounded shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wide">Refund Frequency</div>
            <div className="text-3xl font-semibold mt-2">{refundFreq.toFixed(1)}%</div>
          </div>
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-4">Retention Heatmap</h2>
          <CohortHeatmap data={mockCohortData} />
        </section>
      </div>
    </div>
  );
}
