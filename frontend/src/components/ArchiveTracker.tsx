import React, { useState, useEffect, useMemo, useRef } from 'react';
import { JiraIssue, SortConfig } from '../types';
import { jiraApi } from '../services/api';
import { sortIssues } from '../services/dataProcessor';
import ShimmerLoading from './ShimmerLoading';

const PAGE_SIZE = 50;

const COLUMNS = [
  { key: 'issueType'   as keyof JiraIssue, label: 'Type',        width: 90  },
  { key: 'key'         as keyof JiraIssue, label: 'Issue Key',   width: 120 },
  { key: 'summary'     as keyof JiraIssue, label: 'Summary',     width: 360 },
  { key: 'status'      as keyof JiraIssue, label: 'Status',      width: 130 },
  { key: 'assignee'    as keyof JiraIssue, label: 'Assignee',    width: 150 },
  { key: 'client'      as keyof JiraIssue, label: 'Client',      width: 120 },
  { key: 'sprint'      as keyof JiraIssue, label: 'Sprint',      width: 180 },
  { key: 'fixVersions' as keyof JiraIssue, label: 'Fix Version', width: 140 },
  { key: 'releaseDate' as keyof JiraIssue, label: 'Release Date', width: 130 },
];

interface FilterState {
  client: string[];
  issueType: string[];
  sprint: string[];
  assignee: string[];
  fixVersions: string[];
}

const EMPTY_FILTER: FilterState = { client: [], issueType: [], sprint: [], assignee: [], fixVersions: [] };

const FILTER_LABELS: Record<keyof FilterState, string> = {
  client: 'Client', issueType: 'Type', sprint: 'Sprint', assignee: 'Assignee', fixVersions: 'Fix Version',
};

interface ArchiveTrackerProps {
  filterId: string;
}

const ArchiveTracker: React.FC<ArchiveTrackerProps> = () => {
  const [issues, setIssues]         = useState<JiraIssue[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [fetchedAt, setFetchedAt]       = useState<string>('');
  const [search, setSearch]             = useState('');
  const [sortConfig, setSortConfig]     = useState<SortConfig>({ column: 'releaseDate', direction: 'desc' });
  const [filters, setFilters]           = useState<FilterState>(EMPTY_FILTER);
  const [pendingFilters, setPendingFilters] = useState<FilterState>(EMPTY_FILTER);
  const [openDropdown, setOpenDropdown] = useState<keyof FilterState | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState<Partial<Record<keyof FilterState, string>>>({});
  const [page, setPage]                 = useState(1);
  const fetched                         = useRef(false);

  // Fetch once on mount
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    setLoading(true);
    jiraApi.getArchive()
      .then(({ issues: data, fetchedAt: fa }) => {
        setIssues(data);
        setFetchedAt(fa);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load archive'))
      .finally(() => setLoading(false));
  }, []);

  const applyAndClose = (key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: pendingFilters[key] }));
    setOpenDropdown(null);
    setPage(1);
  };

  const handleDropdownOpen = (key: keyof FilterState) => {
    if (openDropdown && openDropdown !== key) {
      // Apply pending from previous dropdown before switching
      setFilters(prev => ({ ...prev, [openDropdown]: pendingFilters[openDropdown] }));
      setPage(1);
    }
    if (openDropdown === key) {
      applyAndClose(key);
    } else {
      setPendingFilters(prev => ({ ...prev, [key]: [...filters[key]] }));
      setDropdownSearch(prev => ({ ...prev, [key]: '' }));
      setOpenDropdown(key);
    }
  };

  const togglePending = (key: keyof FilterState, value: string) => {
    setPendingFilters(prev => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter(v => v !== value) : [...prev[key], value],
    }));
  };

  const isSelected = (key: keyof FilterState, value: string): boolean =>
    openDropdown === key ? pendingFilters[key].includes(value) : filters[key].includes(value);

  // Apply pending + close when clicking outside any filter-dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        if (openDropdown) {
          setFilters(prev => ({ ...prev, [openDropdown]: pendingFilters[openDropdown] }));
          setPage(1);
        }
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown, pendingFilters]);

  // Unique option lists
  const options = useMemo(() => ({
    client:      Array.from(new Set(issues.map(i => i.client || '').filter(Boolean))).sort(),
    issueType:   Array.from(new Set(issues.map(i => i.issueType || '').filter(Boolean))).sort(),
    sprint:      Array.from(new Set(issues.map(i => i.sprint || '').filter(Boolean))).sort(),
    assignee:    Array.from(new Set(issues.map(i => i.assignee || '').filter(Boolean))).sort(),
    fixVersions: Array.from(new Set(issues.flatMap(i => i.fixVersions || []).filter(Boolean))).sort(),
  }), [issues]);

  const clearAll = () => {
    setFilters(EMPTY_FILTER);
    setPendingFilters(EMPTY_FILTER);
    setSearch('');
    setPage(1);
  };

  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + arr.length, 0);

  const filtered = useMemo(() => {
    let r = issues;
    if (filters.client.length)      r = r.filter(i => filters.client.includes(i.client || ''));
    if (filters.issueType.length)   r = r.filter(i => filters.issueType.includes(i.issueType || ''));
    if (filters.sprint.length)      r = r.filter(i => filters.sprint.includes(i.sprint || ''));
    if (filters.assignee.length)    r = r.filter(i => filters.assignee.includes(i.assignee || ''));
    if (filters.fixVersions.length) r = r.filter(i => filters.fixVersions.some(v => (i.fixVersions || []).includes(v)));
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(i => i.searchText?.includes(q) || i.key?.toLowerCase().includes(q));
    }
    return sortIssues(r, sortConfig);
  }, [issues, filters, search, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (col: keyof JiraIssue) => {
    setSortConfig({ column: col, direction: 'desc' });
    setPage(1);
  };

  const sortIcon = (col: keyof JiraIssue) =>
    sortConfig.column === col ? ' ▼' : '';

  if (loading) return <ShimmerLoading />;

  return (
    <div className="h-full flex flex-col bg-gray-50">

      {/* ── Controls bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 space-y-2 shrink-0">

        {/* Row 1: search + meta */}
        <div className="flex gap-3 items-center">
          <input
            type="text"
            placeholder="Search key, summary, assignee…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {fetchedAt && (
            <span className="text-xs text-gray-400 whitespace-nowrap">
              Updated {new Date(fetchedAt).toLocaleDateString()} {new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {error && <span className="text-red-500 text-xs">{error}</span>}
        </div>

        {/* Row 2: filter dropdowns */}
        <div className="flex gap-2 items-center flex-wrap">
          {(Object.keys(FILTER_LABELS) as (keyof FilterState)[]).map(key => {
            const activeCount = filters[key].length;
            const pendingCount = openDropdown === key ? pendingFilters[key].length : activeCount;
            const opts = (options[key] as string[]).filter(v =>
              (dropdownSearch[key] || '').trim() === '' ||
              v.toLowerCase().includes((dropdownSearch[key] || '').toLowerCase())
            );
            return (
              <div key={key} className="relative filter-dropdown">
                <button
                  onClick={() => handleDropdownOpen(key)}
                  className={`px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 transition-colors ${
                    activeCount > 0 ? 'border-blue-400 text-blue-700 font-medium' : 'border-gray-300 text-gray-700'
                  }`}>
                  {FILTER_LABELS[key]}{activeCount > 0 ? ` (${activeCount})` : '...'}
                </button>
                {openDropdown === key && (
                  <div className="absolute z-40 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 min-w-[220px] max-h-[300px] overflow-y-auto">
                    <input
                      type="text"
                      placeholder="Search..."
                      value={dropdownSearch[key] || ''}
                      onChange={e => setDropdownSearch(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                    {opts.length === 0 && (
                      <p className="text-xs text-gray-400 px-2 py-1">No matches</p>
                    )}
                    {opts.map(val => (
                      <label key={val} className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected(key, val)}
                            onChange={() => togglePending(key, val)}
                            className="w-4 h-4"
                          />
                          <span className="text-sm truncate max-w-[160px]">{val}</span>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">({(options[key] as string[]).filter(o => o === val).length})</span>
                      </label>
                    ))}
                    {pendingCount > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-xs text-blue-600">{pendingCount} selected</span>
                        <button
                          onClick={() => setPendingFilters(prev => ({ ...prev, [key]: [] }))}
                          className="text-xs text-red-500 hover:text-red-700">Clear</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Active chips */}
          {Object.entries(filters).flatMap(([k, vals]) =>
            (vals as string[]).map(v => (
              <span key={`${k}:${v}`}
                className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                {v}
                <button
                  onClick={() => {
                    setFilters(prev => ({ ...prev, [k]: (prev[k as keyof FilterState]).filter(x => x !== v) }));
                    setPendingFilters(prev => ({ ...prev, [k]: (prev[k as keyof FilterState]).filter(x => x !== v) }));
                    setPage(1);
                  }}
                  className="hover:text-blue-600 ml-0.5">✕</button>
              </span>
            ))
          )}

          {(activeFilterCount > 0 || search) && (
            <button onClick={clearAll}
              className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100">
              Clear all
            </button>
          )}

          <span className="ml-auto text-xs text-gray-500">
            {filtered.length.toLocaleString()} / {issues.length.toLocaleString()} issues
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 bg-gray-100 z-10">
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{ minWidth: col.width, width: col.width }}
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-200 cursor-pointer select-none hover:bg-gray-200 whitespace-nowrap">
                  {col.label}{sortIcon(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((issue, idx) => (
              <tr key={issue.key}
                className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                <td className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100">{issue.issueType}</td>
                <td className="px-3 py-1.5 border-b border-gray-100">
                  <a href={`${import.meta.env.VITE_JIRA_HOST || 'https://tillster.atlassian.net'}/browse/${issue.key}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs font-mono">
                    {issue.key}
                  </a>
                </td>
                <td className="px-3 py-1.5 border-b border-gray-100 max-w-[380px]">
                  <span className="text-xs line-clamp-2 block" title={issue.summary}>{issue.summary}</span>
                </td>
                <td className="px-3 py-1.5 border-b border-gray-100">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${
                    issue.statusCategory === 'Done'        ? 'bg-green-100 text-green-700' :
                    issue.statusCategory === 'In Progress' ? 'bg-blue-100 text-blue-700'  :
                                                             'bg-gray-100 text-gray-600'
                  }`}>{issue.status}</span>
                </td>
                <td className="px-3 py-1.5 text-xs text-gray-700 border-b border-gray-100 whitespace-nowrap">{issue.assignee || '—'}</td>
                <td className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100">{issue.client || '—'}</td>
                <td className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 max-w-[180px] truncate" title={issue.sprint || ''}>{issue.sprint || '—'}</td>
                <td className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 max-w-[140px] truncate" title={(issue.fixVersions || []).join(', ')}>
                  {(issue.fixVersions || []).join(', ') || '—'}
                </td>
                <td className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 whitespace-nowrap">
                  {issue.releaseDate ? new Date(issue.releaseDate).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-16 text-center text-gray-400">
                  {issues.length === 0 ? 'Archive is loading or empty.' : 'No issues match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
          <button onClick={() => setPage(1)} disabled={page === 1}
            className="px-2 py-1 rounded text-sm disabled:opacity-40 hover:bg-gray-100">«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-2 py-1 rounded text-sm disabled:opacity-40 hover:bg-gray-100">‹ Prev</button>

          {/* Page number pills — show up to 7 around current */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .reduce<(number | '…')[]>((acc, p, i, arr) => {
              if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…');
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === '…'
                ? <span key={`ellipsis-${i}`} className="px-1 text-gray-400">…</span>
                : <button key={p} onClick={() => setPage(p as number)}
                    className={`px-2.5 py-0.5 rounded text-sm ${page === p ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-700'}`}>
                    {p}
                  </button>
            )}

          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-2 py-1 rounded text-sm disabled:opacity-40 hover:bg-gray-100">Next ›</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
            className="px-2 py-1 rounded text-sm disabled:opacity-40 hover:bg-gray-100">»</button>

          <span className="ml-auto text-xs text-gray-400">
            Page {page} of {totalPages} ({filtered.length.toLocaleString()} issues)
          </span>
        </div>
      )}
    </div>
  );
};

export default ArchiveTracker;
