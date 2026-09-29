import React from 'react';

interface CohortData {
  cohort: string;
  size: number;
  retention: number[];
}

interface CohortHeatmapProps {
  data: CohortData[];
}

export default function CohortHeatmap({ data }: CohortHeatmapProps) {
  // Helper to get background color intensity based on retention percentage
  const getBackgroundColor = (percentage: number) => {
    if (percentage === 100) return 'bg-blue-600 text-white';
    if (percentage >= 80) return 'bg-blue-500 text-white';
    if (percentage >= 60) return 'bg-blue-400 text-gray-900';
    if (percentage >= 40) return 'bg-blue-300 text-gray-900';
    if (percentage >= 20) return 'bg-blue-200 text-gray-900';
    if (percentage > 0) return 'bg-blue-100 text-gray-900';
    return 'bg-gray-50 text-gray-400';
  };

  const maxMonths = Math.max(...data.map((d) => d.retention.length));

  return (
    <div className="overflow-x-auto border rounded bg-white shadow-sm">
      <table className="min-w-full text-sm text-left">
        <thead className="bg-gray-100 border-b">
          <tr>
            <th className="px-4 py-2 font-semibold">Cohort</th>
            <th className="px-4 py-2 font-semibold">Users</th>
            {Array.from({ length: maxMonths }).map((_, i) => (
              <th key={i} className="px-4 py-2 font-semibold text-center">
                Month {i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="px-4 py-2 font-medium">{row.cohort}</td>
              <td className="px-4 py-2 text-gray-600">{row.size}</td>
              {row.retention.map((pct, j) => (
                <td
                  key={j}
                  className={`px-4 py-2 text-center font-medium ${getBackgroundColor(pct)}`}
                  title={`${pct}% retention (${Math.round((pct / 100) * row.size)} users)`}
                >
                  {pct.toFixed(0)}%
                </td>
              ))}
              {Array.from({ length: maxMonths - row.retention.length }).map((_, j) => (
                <td key={`empty-${j}`} className="px-4 py-2 bg-gray-50"></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
