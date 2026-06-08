import React, { useState, useEffect, useMemo, memo } from 'react';
import ShimmerLoading from './ShimmerLoading';
import { JiraIssue, Column, SortConfig, GroupConfig } from '../types';
import { filterIssues, sortIssues, groupIssues } from '../services/dataProcessor';
import { parseLocalDate } from '../utils/dateUtils';
import { useIssueFiltering } from '../hooks/useIssueFiltering';
import { jiraApi } from '../services/api';
import ListView from './views/ListView';
import CalendarView from './views/CalendarView';
import GanttView from './views/GanttView';

// Simple hook that returns a value that only updates after `delay` ms of no changes
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const DEFAULT_COLUMNS: Column[] = [
  { key: 'important',      label: '⭐',                sortable: true,  filterable: false, type: 'boolean', width: 60 },
  { key: 'issueType',      label: 'Type',              sortable: true,  filterable: true,  type: 'text',    width: 100 },
  { key: 'key',            label: 'Issue Key',         sortable: true,  filterable: true,  type: 'text',    width: 120 },
  { key: 'summary',        label: 'Summary',           sortable: true,  filterable: false, type: 'text',    width: 400 },
  { key: 'status',         label: 'Status',            sortable: true,  filterable: true,  type: 'status',  width: 140 },
  { key: 'assignee',       label: 'Assignee',          sortable: true,  filterable: true,  type: 'assignee', width: 150 },
  { key: 'dueDate',        label: 'Due Date',          sortable: true,  filterable: true,  type: 'date',    width: 120 },
  { key: 'releaseDate',    label: 'Release Date',      sortable: true,  filterable: false, type: 'date',    width: 130 },
  { key: 'plannedUatDate', label: 'UAT Date',          sortable: true,  filterable: true,  type: 'date',    width: 120 },
  { key: 'client',         label: 'Client',            sortable: true,  filterable: true,  type: 'text',    width: 120 },
  { key: 'components',     label: 'Components',        sortable: false, filterable: true,  type: 'array',   width: 200 },
  { key: 'sprint',         label: 'Sprint',            sortable: true,  filterable: true,  type: 'text',    width: 200 },
  { key: 'source',         label: 'Source',            sortable: true,  filterable: false, type: 'text',    width: 100 },
  { key: 'created',        label: 'Created',           sortable: true,  filterable: false, type: 'date',    width: 120 },
  { key: 'statusCategory', label: 'Status Category',   sortable: true,  filterable: true,  type: 'text',    width: 140 },
  { key: 'fixVersions',    label: 'Fix Version',       sortable: true,  filterable: true,  type: 'array',   width: 300 },
  { key: 'parentSummary',  label: 'Parent Summary',    sortable: true,  filterable: false, type: 'text',    width: 250 },
  { key: 'timeSpent',      label: 'Σ Time Spent',      sortable: true,  filterable: false, type: 'text',    width: 120 },
  { key: 'originalEstimate', label: 'Σ Original Est.', sortable: true,  filterable: false, type: 'text',    width: 150 },
];

const GROUPABLE_COLUMN_KEYS = ['issueType','status','assignee','dueDate','releaseDate','plannedUatDate','client','fixVersions','source'] as const;
const GROUPABLE_COLUMNS = DEFAULT_COLUMNS.filter(col => GROUPABLE_COLUMN_KEYS.includes(col.key as any));

type SourceFilter = 'all' | 'sprint' | 'me';

interface JiraTasksTrackerProps {
  sprintIssues: JiraIssue[];
  myIssues: JiraIssue[];
  sprintLoading: boolean;
  myLoading: boolean;
  onRefreshSprint: () => void;
  onRefreshMe: () => void;
}

const JiraTasksTracker: React.FC<JiraTasksTrackerProps> = ({
  sprintIssues,
  myIssues,
  sprintLoading,
  myLoading,
  onRefreshSprint,
  onRefreshMe,
}) => {
  // ── Source merge & deduplication ──────────────────────────────────────────
  const mergedIssues = useMemo<JiraIssue[]>(() => {
    const map = new Map<string, JiraIssue>();
    for (const issue of sprintIssues) {
      map.set(issue.key, { ...issue, source: 'sprint' });
    }
    for (const issue of myIssues) {
      if (map.has(issue.key)) {
        // Present in both — keep sprint fields, mark as 'me' to show both
        map.set(issue.key, { ...map.get(issue.key)!, source: 'me' });
      } else {
        map.set(issue.key, { ...issue, source: 'me' });
      }
    }
    return Array.from(map.values());
  }, [sprintIssues, myIssues]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [visibleColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [sortConfig, setSortConfig]   = useState<SortConfig>({ column: 'dueDate', direction: 'desc' });
  const [groupConfig, setGroupConfig] = useState<GroupConfig>({ column: null, direction: 'asc' });
  const [viewMode, setViewMode]       = useState<'list' | 'calendar' | 'gantt'>('list');
  const [calendarDateType, setCalendarDateType] = useState<'dueDate' | 'releaseDate' | 'plannedUatDate'>('releaseDate');
  const [fullScreenMode, setFullScreenMode]     = useState(false);
  const [sourceFilter, setSourceFilter]         = useState<SourceFilter>('all');

  // Quick-filter toggles
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const [showUrgentOnly, setShowUrgentOnly]       = useState(false);
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const [showNoDueDate, setShowNoDueDate]         = useState(false);
  const [showFETeamOnly, setShowFETeamOnly]       = useState(false);

  // Dropdown search states
  const [typeSearch, setTypeSearch]           = useState('');
  const [sprintSearch, setSprintSearch]       = useState('');
  const [releaseSearch, setReleaseSearch]     = useState('');
  const [groupBySearch, setGroupBySearch]     = useState('');
  const [clientSearch, setClientSearch]       = useState('');
  const [componentSearch, setComponentSearch] = useState('');
  const [assigneeSearch, setAssigneeSearch]   = useState('');

  // Dropdown open state
  const [openDropdown, setOpenDropdown]       = useState<string | null>(null);
  const [pendingFilters, setPendingFilters]   = useState<{ [key: string]: string[] }>({});

  // FE Team
  const [feTeamMembers, setFETeamMembers]     = useState<string[]>([]);

  useEffect(() => {
    jiraApi.getAllFETeamFlags()
      .then(flags => setFETeamMembers(Object.keys(flags).filter(a => flags[a])))
      .catch(() => {});
  }, []);

  const toggleFETeamMember = async (assignee: string) => {
    const isMember = feTeamMembers.includes(assignee);
    setFETeamMembers(prev => isMember ? prev.filter(n => n !== assignee) : [...prev, assignee]);
    try {
      await jiraApi.setFETeamMember(assignee, !isMember);
    } catch {
      setFETeamMembers(prev => isMember ? [...prev, assignee] : prev.filter(n => n !== assignee));
    }
  };

  // ── Filtering hook ────────────────────────────────────────────────────────
  const { searchTerm, setSearchTerm, filters, addFilter, removeFilter, toggleFilterValue, clearAllFilters } =
    useIssueFiltering(mergedIssues);

  // Debounce search — input updates instantly, expensive filter/sort fires 200ms after typing stops
  const debouncedSearch = useDebounce(searchTerm, 200);

  // Synchronous effective status-category filter.
  // When the user has never touched it, auto-hide 'Done'.
  // Once any pill is clicked, filters.statusCategory is set and we use it verbatim.
  const effectiveSCFilter = useMemo(() => {
    if (filters.statusCategory !== undefined) {
      return Array.isArray(filters.statusCategory)
        ? (filters.statusCategory as string[])
        : [filters.statusCategory as string];
    }
    if (mergedIssues.length === 0) return [] as string[];
    const cats = Array.from(new Set(mergedIssues.map(i => i.statusCategory)));
    return cats.filter(c => c !== 'Done');
  }, [filters.statusCategory, mergedIssues]);

  const toggleStatusCat = (cat: string) => {
    const next = effectiveSCFilter.includes(cat)
      ? effectiveSCFilter.filter(c => c !== cat)
      : [...effectiveSCFilter, cat];
    next.length > 0 ? addFilter('statusCategory', next) : removeFilter('statusCategory');
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.filter-dropdown')) {
        if (openDropdown && pendingFilters[openDropdown]) {
          const filterKey = getFilterKey(openDropdown);
          const values = pendingFilters[openDropdown];
          values.length > 0 ? addFilter(filterKey, values) : removeFilter(filterKey);
        }
        setOpenDropdown(null);
        setPendingFilters({});
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown, pendingFilters, addFilter, removeFilter]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getFilterKey = (dropdown: string): string =>
    ({ type: 'issueType', status: 'status', assignee: 'assignee', sprint: 'sprint', release: 'releaseDate', client: 'client', component: 'components' } as Record<string, string>)[dropdown] || dropdown;

  const handleDropdownOpen = (dropdown: string) => {
    if (openDropdown && openDropdown !== dropdown && pendingFilters[openDropdown]) {
      const filterKey = getFilterKey(openDropdown);
      const values = pendingFilters[openDropdown];
      values.length > 0 ? addFilter(filterKey, values) : removeFilter(filterKey);
    }
    setOpenDropdown(openDropdown === dropdown ? null : dropdown);
    const filterKey = getFilterKey(dropdown);
    const curr = filters[filterKey];
    setPendingFilters({ [dropdown]: Array.isArray(curr) ? [...curr] : curr ? [curr as string] : [] });
  };

  const togglePendingFilter = (dropdown: string, value: string) =>
    setPendingFilters(prev => {
      const curr = prev[dropdown] || [];
      return { ...prev, [dropdown]: curr.includes(value) ? curr.filter(v => v !== value) : [...curr, value] };
    });

  const isFilterSelected = (dropdown: string, value: string): boolean => {
    if (pendingFilters[dropdown]) return pendingFilters[dropdown].includes(value);
    const curr = filters[getFilterKey(dropdown)];
    return Array.isArray(curr) && curr.includes(value);
  };

  const isUrgent = (issue: JiraIssue): boolean => {
    const tomorrow = new Date(); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate() + 1);
    const due = issue.dueDate ? new Date(issue.dueDate) : null;
    const rel = issue.releaseDate && issue.releaseDate !== 'NA' ? parseLocalDate(issue.releaseDate) : null;
    return Boolean((due && due <= tomorrow) || (rel && rel <= tomorrow));
  };

  const needsAttention = (issue: JiraIssue): boolean => {
    const threeDays = new Date(); threeDays.setHours(0,0,0,0); threeDays.setDate(threeDays.getDate() + 3);
    const due = issue.dueDate ? new Date(issue.dueDate) : null;
    const rel = issue.releaseDate && issue.releaseDate !== 'NA' ? parseLocalDate(issue.releaseDate) : null;
    return Boolean((due && due <= threeDays) || (rel && rel <= threeDays));
  };

  // ── Memoized lookups (avoid recompute on every keystroke) ─────────────────
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    mergedIssues.forEach(i => { counts[i.statusCategory] = (counts[i.statusCategory] || 0) + 1; });
    return counts;
  }, [mergedIssues]);

  const uniqueClients = useMemo(() => {
    const s = new Set<string>();
    mergedIssues.forEach(i => { if (i.client) i.client.split(',').forEach(c => { const t = c.trim(); if (t) s.add(t); }); });
    return Array.from(s).sort();
  }, [mergedIssues]);

  const dropdownOptions = useMemo(() => ({
    type:      Array.from(new Set(mergedIssues.map(i => i.issueType))).sort(),
    status:    Array.from(new Set(mergedIssues.map(i => i.status))).sort(),
    assignee:  Array.from(new Set(mergedIssues.map(i => i.assignee))).filter(Boolean).sort(),
    sprint:    Array.from(new Set(mergedIssues.map(i => i.sprint).filter((s): s is string => s !== null))).sort(),
    release:   Array.from(new Set(mergedIssues.map(i => i.releaseDate).filter(r => r && r !== 'NA'))).sort(),
    client:    uniqueClients,
    component: Array.from(new Set(mergedIssues.flatMap(i => i.components))).sort(),
  }), [mergedIssues, uniqueClients]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const { filteredIssues, sortedIssues, groupedIssues } = useMemo(() => {
    // 1. Source filter
    let r = sourceFilter === 'sprint'
      ? mergedIssues.filter(i => sprintIssues.some(s => s.key === i.key))
      : sourceFilter === 'me'
      ? mergedIssues.filter(i => myIssues.some(m => m.key === i.key))
      : mergedIssues;

    // 2. Quick-filter toggles
    if (showImportantOnly) r = r.filter(i => i.important);
    if (showUrgentOnly)    r = r.filter(i => isUrgent(i));
    if (showAttentionOnly) r = r.filter(i => needsAttention(i) && !isUrgent(i));
    if (showNoDueDate)     r = r.filter(i => !i.dueDate);
    if (showFETeamOnly)    r = r.filter(i => feTeamMembers.includes(i.assignee));

    // 3. Apply effective status filter + search — all synchronous, data is pre-loaded
    const f = filterIssues(
      r,
      { ...filters, statusCategory: effectiveSCFilter.length > 0 ? effectiveSCFilter : null },
      debouncedSearch
    );
    const s = sortIssues(f, sortConfig);
    const g = groupIssues(s, groupConfig.column);
    return { filteredIssues: f, sortedIssues: s, groupedIssues: g };
  }, [mergedIssues, sprintIssues, myIssues, sourceFilter, showImportantOnly, showUrgentOnly, showAttentionOnly, showNoDueDate, showFETeamOnly, feTeamMembers, filters, effectiveSCFilter, debouncedSearch, sortConfig, groupConfig]);

  // Pre-compute occurrence counts for dropdown options so countFn is O(1)
  const occurrenceCounts = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    const bump = (field: string, val: string) => { if (!m[field]) m[field] = {}; m[field][val] = (m[field][val] || 0) + 1; };
    filteredIssues.forEach(i => {
      bump('issueType', i.issueType);
      bump('status', i.status);
      if (i.assignee) bump('assignee', i.assignee);
      if (i.sprint) bump('sprint', i.sprint);
      if (i.releaseDate && i.releaseDate !== 'NA') bump('releaseDate', i.releaseDate);
      if (i.client) i.client.split(',').forEach(c => { const t = c.trim(); if (t) bump('client', t); });
      i.components.forEach(c => bump('components', c));
    });
    return m;
  }, [filteredIssues]);
  const countOcc = (field: string, val: string) => occurrenceCounts[field]?.[val] || 0;

  const totalTimeSpentH      = Math.round(filteredIssues.reduce((s, i) => s + (i.timeSpent || 0), 0) / 3600 * 100) / 100;
  const totalOriginalEstH    = Math.round(filteredIssues.reduce((s, i) => s + (i.originalEstimate || 0), 0) / 3600 * 100) / 100;

  const handleSort  = (column: keyof JiraIssue) =>
    setSortConfig(prev => ({ column, direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc' }));
  const handleGroup = (column: keyof JiraIssue | null) => setGroupConfig({ column, direction: 'asc' });

  const isRefreshing = sprintLoading || myLoading;

  return (
    <div className="h-full flex flex-col bg-gray-50 relative">
      {/* Shimmer overlay — keeps DOM alive so no destroy/rebuild on refresh */}
      {isRefreshing && (
        <div className="absolute inset-0 z-20 bg-gray-50">
          <ShimmerLoading />
        </div>
      )}
      {!fullScreenMode && (
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="space-y-3">

            {/* Row 1 – Search + time tracking */}
            <div className="flex gap-3 items-center">
              <input
                type="text"
                placeholder="Search by key, summary, assignee, type..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2 text-sm font-medium">
                <div className="bg-blue-50 px-3 py-2 rounded-lg whitespace-nowrap">
                  <span className="text-gray-600">Σ Spent: </span>
                  <span className="text-blue-700 font-bold">{totalTimeSpentH.toFixed(2)}h</span>
                </div>
                <div className="bg-green-50 px-3 py-2 rounded-lg whitespace-nowrap">
                  <span className="text-gray-600">Σ Est: </span>
                  <span className="text-green-700 font-bold">{totalOriginalEstH.toFixed(2)}h</span>
                </div>
              </div>
            </div>

            {/* Row 2 – Source pill + view mode + quick filters */}
            <div className="flex gap-2 items-center flex-wrap">
              {/* Source filter pills */}
              <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
                {(['all', 'sprint', 'me'] as SourceFilter[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSourceFilter(s)}
                    className={`px-3 py-1.5 transition-colors ${
                      sourceFilter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {s === 'all' ? `All (${mergedIssues.length})` : s === 'sprint' ? `Sprint (${sprintIssues.length})` : `Me (${myIssues.length})`}
                  </button>
                ))}
              </div>

              <div className="h-6 w-px bg-gray-300" />

              {/* View mode */}
              {(['list','calendar','gantt'] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === mode ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                  {mode === 'list' ? '📋 List' : mode === 'calendar' ? '📅 Calendar' : '📊 Gantt'}
                </button>
              ))}

              {(viewMode === 'calendar' || viewMode === 'gantt') && (
                <>
                  {(['dueDate','releaseDate','plannedUatDate'] as const).map(dt => (
                    <button key={dt} onClick={() => setCalendarDateType(dt)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${calendarDateType === dt ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-800 hover:bg-purple-200'}`}>
                      {dt === 'dueDate' ? 'Due Date' : dt === 'releaseDate' ? 'Release Date' : 'UAT Date'}
                    </button>
                  ))}
                </>
              )}

              <div className="h-6 w-px bg-gray-300" />

              {/* Quick filters */}
              <button onClick={() => setShowImportantOnly(!showImportantOnly)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showImportantOnly ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                ⭐ Important
              </button>
              <button onClick={() => setShowUrgentOnly(!showUrgentOnly)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showUrgentOnly ? 'bg-red-600 text-white' : 'bg-red-100 text-red-800 hover:bg-red-200'}`}>
                🚨 Urgent
              </button>
              <button onClick={() => setShowAttentionOnly(!showAttentionOnly)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showAttentionOnly ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>
                ⚠️ Attention
              </button>
              <button onClick={() => setShowNoDueDate(!showNoDueDate)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showNoDueDate ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                📅 No Due Date
              </button>
              <button onClick={() => setShowFETeamOnly(!showFETeamOnly)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showFETeamOnly ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-800 hover:bg-purple-200'}`}>
                👥 FE Team
              </button>

              {/* Active filter chips */}
              {Object.keys(filters).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(filters).map(([col, val]) => (
                    <div key={col} className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs">
                      <span>{DEFAULT_COLUMNS.find(c => c.key === col)?.label}: {Array.isArray(val) ? val.join(', ') : val}</span>
                      <button onClick={() => removeFilter(col)} className="hover:text-blue-600 ml-0.5">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Row 3 – Status counts + dropdown filters */}
            <div className="flex flex-wrap gap-2 items-center relative z-30">
              {Object.entries(statusCounts).map(([cat, count]) => {
                const isActive = effectiveSCFilter.includes(cat);
                const colors: Record<string, [string, string]> = {
                  'To Do':       ['bg-blue-100', 'bg-blue-600'],
                  'In Progress': ['bg-yellow-100', 'bg-yellow-600'],
                  'Done':        ['bg-green-100', 'bg-green-600'],
                };
                const [bg, active] = colors[cat] || ['bg-gray-200', 'bg-gray-600'];
                return (
                  <button key={cat} onClick={() => toggleStatusCat(cat)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? `${active} text-white` : `${bg} text-gray-700 hover:opacity-80`}`}>
                    {cat}: {count}
                  </button>
                );
              })}

              <div className="h-6 w-px bg-gray-300" />

              {/* Group By */}
              <div className="relative z-30 filter-dropdown">
                <button onClick={() => setOpenDropdown(openDropdown === 'groupby' ? null : 'groupby')}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 text-left">
                  Group By{groupConfig.column ? ` (${DEFAULT_COLUMNS.find(c => c.key === groupConfig.column)?.label})` : '...'}
                </button>
                {openDropdown === 'groupby' && (
                  <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                    <input type="text" placeholder="Search..." value={groupBySearch} onChange={e => setGroupBySearch(e.target.value)}
                      className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm" onClick={e => e.stopPropagation()} />
                    <div className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => { handleGroup(null); setGroupBySearch(''); setOpenDropdown(null); }}>None</div>
                    {GROUPABLE_COLUMNS.filter(c => c.label.toLowerCase().includes(groupBySearch.toLowerCase())).map(col => (
                      <div key={col.key} className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                        onClick={() => { handleGroup(col.key); setGroupBySearch(''); setOpenDropdown(null); }}>{col.label}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Type filter */}
              <DropdownFilter label="Type" dropKey="type" search={typeSearch} setSearch={setTypeSearch}
                options={dropdownOptions.type}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('issueType', v)} />

              {/* Status filter */}
              <DropdownFilter label="Status" dropKey="status" search="" setSearch={() => {}}
                options={dropdownOptions.status}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('status', v)} />

              {/* Assignee filter */}
              <DropdownFilter label="Assignee" dropKey="assignee" search={assigneeSearch} setSearch={setAssigneeSearch}
                options={dropdownOptions.assignee}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('assignee', v)} />

              {/* Sprint filter */}
              <DropdownFilter label="Sprint" dropKey="sprint" search={sprintSearch} setSearch={setSprintSearch}
                options={dropdownOptions.sprint}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('sprint', v)} />

              {/* Release filter */}
              <DropdownFilter label="Release" dropKey="release" search={releaseSearch} setSearch={setReleaseSearch}
                options={dropdownOptions.release}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('releaseDate', v)} />

              {/* Client filter */}
              <DropdownFilter label="Client" dropKey="client" search={clientSearch} setSearch={setClientSearch}
                options={dropdownOptions.client}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('client', v)} />

              {/* Component filter */}
              <DropdownFilter label="Component" dropKey="component" search={componentSearch} setSearch={setComponentSearch}
                options={dropdownOptions.component}
                openDropdown={openDropdown} onOpen={handleDropdownOpen}
                isSelected={isFilterSelected} onToggle={togglePendingFilter} countFn={v => countOcc('components', v)} />

              {(Object.keys(filters).length > 0 || searchTerm) && (
                <button onClick={clearAllFilters} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600">Clear Filters</button>
              )}

              <div className="flex gap-2 ml-auto items-center">
                <button onClick={() => { onRefreshSprint(); onRefreshMe(); }}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">🔄 Refresh</button>
                <button onClick={() => setFullScreenMode(true)}
                  className="px-3 py-1.5 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-800">⛶ Full Screen</button>
                <span className="text-sm text-gray-600 whitespace-nowrap">
                  {sortedIssues.length} / {mergedIssues.length} issues
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {fullScreenMode && (
        <div className="absolute top-2 right-2 z-30">
          <button onClick={() => setFullScreenMode(false)}
            className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs hover:bg-gray-700 shadow-lg">
            ✕ Exit Full Screen
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {viewMode === 'list' ? (
          <ListView groupedIssues={groupedIssues} visibleColumns={visibleColumns}
            sortConfig={sortConfig} onSort={handleSort} onToggleFilterValue={toggleFilterValue}
            feTeamMembers={feTeamMembers} onToggleFETeam={toggleFETeamMember} />
        ) : viewMode === 'calendar' ? (
          <CalendarView issues={sortedIssues} dateType={calendarDateType} />
        ) : (
          <GanttView issues={sortedIssues} dateType={calendarDateType} />
        )}
      </div>
    </div>
  );
};

// ── Reusable dropdown filter ────────────────────────────────────────────────
interface DropdownFilterProps {
  label: string;
  dropKey: string;
  search: string;
  setSearch: (v: string) => void;
  options: string[];
  openDropdown: string | null;
  onOpen: (key: string) => void;
  isSelected: (dropdown: string, value: string) => boolean;
  onToggle: (dropdown: string, value: string) => void;
  countFn: (value: string) => number;
}

const DropdownFilter: React.FC<DropdownFilterProps> = ({
  label, dropKey, search, setSearch, options, openDropdown, onOpen, isSelected, onToggle, countFn,
}) => {
  const activeCount = options.filter(o => isSelected(dropKey, o)).length;
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => countFn(b) - countFn(a));

  return (
    <div className="relative z-30 filter-dropdown">
      <button onClick={() => onOpen(dropKey)}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 text-left">
        {label}{activeCount > 0 ? ` (${activeCount})` : '...'}
      </button>
      {openDropdown === dropKey && (
        <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
          {setSearch !== (() => {}) && (
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm" onClick={e => e.stopPropagation()} />
          )}
          {filtered.map(opt => (
            <label key={opt} className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={isSelected(dropKey, opt)} onChange={() => onToggle(dropKey, opt)} className="w-4 h-4" />
                <span className="text-sm">{opt}</span>
              </div>
              <span className="text-xs text-gray-500">({countFn(opt)})</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(JiraTasksTracker);
