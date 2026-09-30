import React, { useState, useEffect } from 'react';
import { useTransactionFilters } from '../../hooks/useTransactionFilters';

export const SearchFilterBar: React.FC = () => {
  const { filters, updateFilters, clearFilters } = useTransactionFilters();
  const [searchInput, setSearchInput] = useState(filters.search);
  // External filter changes (e.g. Clear All) must reset the input. Per the
  // React docs this is done by adjusting state during render — the component
  // re-renders immediately without committing — rather than mirroring the
  // prop into state from an effect, which cascades renders and is rejected
  // by react-hooks/set-state-in-effect.
  const [lastExternalSearch, setLastExternalSearch] = useState(filters.search);
  if (filters.search !== lastExternalSearch) {
    setLastExternalSearch(filters.search);
    setSearchInput(filters.search);
  }

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== filters.search) {
        updateFilters({ search: searchInput });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchInput, filters.search, updateFilters]);

  return (
    <div className="search-filter-bar flex gap-4 p-4 items-center bg-white shadow-sm rounded-md">
      <input
        type="text"
        placeholder="Search by ID, Key, Ref, or Amount..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="border p-2 rounded flex-1"
      />

      <select
        value={filters.status}
        onChange={(e) => updateFilters({ status: e.target.value })}
        className="border p-2 rounded"
      >
        <option value="">All Statuses</option>
        <option value="Authorized">Authorized</option>
        <option value="Settled">Settled</option>
        <option value="Disputed">Disputed</option>
        <option value="Refunded">Refunded</option>
      </select>

      <select
        value={filters.asset}
        onChange={(e) => updateFilters({ asset: e.target.value })}
        className="border p-2 rounded"
      >
        <option value="">All Assets</option>
        <option value="XLM">XLM</option>
        <option value="USDC">USDC</option>
      </select>

      <input
        type="date"
        value={filters.dateRange}
        onChange={(e) => updateFilters({ dateRange: e.target.value })}
        className="border p-2 rounded"
      />

      <button onClick={clearFilters} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
        Clear All
      </button>
    </div>
  );
};
