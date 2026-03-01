import React, { useState, useEffect } from 'react';
import { JiraIssue, Column, SortConfig, GroupConfig } from '../types';
import { filterIssues, sortIssues, groupIssues } from '../services/dataProcessor';
import { useIssueFiltering } from '../hooks/useIssueFiltering';
import ListView from './views/ListView';
import ShimmerLoading from './ShimmerLoading';

const DEFAULT_COLUMNS: Column[] = [
  { key: 'important', label: '⭐', sortable: true, filterable: false, type: 'boolean', width: 60 },
  { key: 'issueType', label: 'Type', sortable: true, filterable: true, type: 'text', width: 100 },
  { key: 'key', label: 'Issue Key', sortable: true, filterable: true, type: 'text', width: 120 },
  { key: 'summary', label: 'Summary', sortable: true, filterable: false, type: 'text', width: 400 },
  { key: 'status', label: 'Status', sortable: true, filterable: true, type: 'status', width: 140 },
  { key: 'assignee', label: 'Assignee', sortable: true, filterable: true, type: 'assignee', width: 150 },
  { key: 'dueDate', label: 'Due Date', sortable: true, filterable: true, type: 'date', width: 120 },
  { key: 'releaseDate', label: 'Release Date', sortable: true, filterable: false, type: 'date', width: 130 },
  { key: 'client', label: 'Client', sortable: true, filterable: true, type: 'text', width: 120 },
  { key: 'created', label: 'Created', sortable: true, filterable: false, type: 'date', width: 120 },
  { key: 'statusCategory', label: 'Status Category', sortable: true, filterable: true, type: 'text', width: 140 },
  { key: 'fixVersions', label: 'Fix Version', sortable: true, filterable: true, type: 'array', width: 300 },
  { key: 'parentSummary', label: 'Parent Summary', sortable: true, filterable: false, type: 'text', width: 250 },
];

// Columns allowed in Group By
const GROUPABLE_COLUMN_KEYS = ['issueType', 'status', 'assignee', 'dueDate', 'releaseDate', 'client', 'fixVersions'] as const;
const GROUPABLE_COLUMNS = DEFAULT_COLUMNS.filter(col => GROUPABLE_COLUMN_KEYS.includes(col.key as any));

interface MyIssuesTrackerProps {
  issues: JiraIssue[];
  loading: boolean;
  onRefresh: () => void;
}

const MyIssuesTracker: React.FC<MyIssuesTrackerProps> = ({ issues, loading, onRefresh }) => {
  const [visibleColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'dueDate', direction: 'desc' });
  const [groupConfig, setGroupConfig] = useState<GroupConfig>({ column: null, direction: 'asc' });
  const [fullScreenMode, setFullScreenMode] = useState(false);
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const [showNoDueDate, setShowNoDueDate] = useState(false);
  const [showNoSubtasks, setShowNoSubtasks] = useState(false);
  const [typeSearch, setTypeSearch] = useState('');
  const [releaseSearch, setReleaseSearch] = useState('');
  const [groupBySearch, setGroupBySearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [pendingFilters, setPendingFilters] = useState<{ [key: string]: string[] }>({});
  
  const { searchTerm, setSearchTerm, filters, addFilter, removeFilter, toggleFilterValue, clearAllFilters } =
    useIssueFiltering(issues);

  // Initialize statusCategory filter with all categories except "Done" on first load
  useEffect(() => {
    if (issues.length > 0 && !filters.statusCategory) {
      const allCategories = Array.from(new Set(issues.map(i => i.statusCategory)));
      const categoriesExceptDone = allCategories.filter(cat => cat !== 'Done');
      if (categoriesExceptDone.length > 0) {
        addFilter('statusCategory', categoriesExceptDone);
      }
    }
  }, [issues.length]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        // Apply pending filters before closing dropdown (only if not empty)
        if (openDropdown && pendingFilters[openDropdown]) {
          const filterKey = getFilterKey(openDropdown);
          const values = pendingFilters[openDropdown];
          // Only apply filter if there are selected values
          if (values.length > 0) {
            addFilter(filterKey, values);
          } else {
            // If empty, remove the filter instead of adding empty array
            removeFilter(filterKey);
          }
        }
        setOpenDropdown(null);
        setPendingFilters({});
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown, pendingFilters, addFilter, removeFilter]);

  // Map dropdown identifier to actual filter key
  const getFilterKey = (dropdown: string): string => {
    const mapping: { [key: string]: string } = {
      'type': 'issueType',
      'release': 'releaseDate',
      'client': 'client',
      'fixVersion': 'fixVersions'
    };
    return mapping[dropdown] || dropdown;
  };

  // Initialize pending filters when dropdown opens
  const handleDropdownOpen = (dropdown: string) => {
    if (openDropdown && openDropdown !== dropdown) {
      // Apply pending filters from previous dropdown (only if not empty)
      if (pendingFilters[openDropdown]) {
        const filterKey = getFilterKey(openDropdown);
        const values = pendingFilters[openDropdown];
        if (values.length > 0) {
          addFilter(filterKey, values);
        } else {
          // If empty, remove the filter instead of adding empty array
          removeFilter(filterKey);
        }
      }
    }
    setOpenDropdown(openDropdown === dropdown ? null : dropdown);
    // Initialize pending state with current filter values
    const filterKey = getFilterKey(dropdown);
    const currentFilter = filters[filterKey];
    setPendingFilters({
      [dropdown]: Array.isArray(currentFilter) ? [...currentFilter] : (currentFilter ? [currentFilter] : [])
    });
  };

  // Toggle value in pending filters
  const togglePendingFilter = (dropdown: string, value: string) => {
    setPendingFilters(prev => {
      const current = prev[dropdown] || [];
      const newValues = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [dropdown]: newValues };
    });
  };

  // Check if value is selected in pending or current filters
  const isFilterSelected = (dropdown: string, value: string): boolean => {
    if (pendingFilters[dropdown]) {
      return pendingFilters[dropdown].includes(value);
    }
    const filterKey = getFilterKey(dropdown);
    const currentFilter = filters[filterKey];
    return Array.isArray(currentFilter) && currentFilter.includes(value);
  };

  const handleGroup = (column: keyof JiraIssue | null) => {
    setGroupConfig((prev) => ({
      column,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleSort = (column: keyof JiraIssue) => {
    setSortConfig((prev) => ({
      column,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  // Helper function: Check if an issue is urgent
  const isUrgent = (issue: JiraIssue): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dueDate = issue.dueDate ? new Date(issue.dueDate) : null;
    const releaseDate = issue.releaseDate && issue.releaseDate !== 'NA' ? new Date(issue.releaseDate) : null;
    
    return Boolean((dueDate && dueDate <= tomorrow) || (releaseDate && releaseDate <= tomorrow));
  };

  // Helper function: Check if an issue needs attention
  const needsAttention = (issue: JiraIssue): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threeDays = new Date(today);
    threeDays.setDate(threeDays.getDate() + 3);
    
    const dueDate = issue.dueDate ? new Date(issue.dueDate) : null;
    const releaseDate = issue.releaseDate && issue.releaseDate !== 'NA' ? new Date(issue.releaseDate) : null;
    
    return Boolean((dueDate && dueDate <= threeDays) || (releaseDate && releaseDate <= threeDays));
  };

  // Filter issues by search term and active filters
  let filteredIssues = filterIssues(issues, filters, searchTerm);

  // Apply toggle filters
  if (showImportantOnly) {
    filteredIssues = filteredIssues.filter((issue) => issue.important);
  }

  if (showUrgentOnly) {
    filteredIssues = filteredIssues.filter(isUrgent);
  }

  if (showAttentionOnly) {
    filteredIssues = filteredIssues.filter(needsAttention);
  }

  if (showNoDueDate) {
    filteredIssues = filteredIssues.filter((issue) => !issue.dueDate);
  }

  if (showNoSubtasks) {
    filteredIssues = filteredIssues.filter((issue) => issue.issueType !== 'Sub-task');
  }

  // Sort issues
  const sortedIssues = sortIssues(filteredIssues, sortConfig);

  // Group issues
  const groupedIssues = groupIssues(sortedIssues, groupConfig.column);

  // Count occurrences for dropdown display
  const countOccurrences = (column: string, value: string): number => {
    return filteredIssues.filter((issue) => {
      const issueValue = issue[column as keyof JiraIssue];
      if (Array.isArray(issueValue)) {
        return issueValue.includes(value);
      }
      return String(issueValue) === value;
    }).length;
  };

  // Get status counts by category
  const getStatusCounts = () => {
    const counts: { [key: string]: number } = {};
    issues.forEach(issue => {
      counts[issue.statusCategory] = (counts[issue.statusCategory] || 0) + 1;
    });
    return counts;
  };

  // Generate unique color for each client
  const getClientColor = (client: string | null): string => {
    if (!client) return 'bg-white';
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < client.length; i++) {
      hash = client.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Generate pastel color
    const hue = Math.abs(hash % 360);
    return `bg-[hsl(${hue},70%,95%)]`;
  };

  if (loading) {
    return <ShimmerLoading />;
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header and Controls */}
      {!fullScreenMode && (
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="space-y-4">
          {/* Search Bar */}
          <div className="flex gap-3 items-center">
            <input
              type="text"
              placeholder="Search by key, summary, assignee, type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Controls Row 1 - View Mode and Button Filters */}
          <div className="flex gap-3 items-center flex-wrap">
              {/* Show Imp */}
              <button
                onClick={() => setShowImportantOnly(!showImportantOnly)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showImportantOnly
                    ? 'bg-yellow-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                ⭐ Show Imp
              </button>

              {/* Urgent Filter */}
              <button
                onClick={() => setShowUrgentOnly(!showUrgentOnly)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showUrgentOnly
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                🔥 Urgent
              </button>

              {/* Attention Filter */}
              <button
                onClick={() => setShowAttentionOnly(!showAttentionOnly)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showAttentionOnly
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                ⚠️ Attention
              </button>

              {/* No Due Date Filter */}
              <button
                onClick={() => setShowNoDueDate(!showNoDueDate)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showNoDueDate
                    ? 'bg-gray-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📅 No Due Date
              </button>

              {/* Active Filters */}
              {Object.keys(filters).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(filters).map(([column, value]) => (
                    <div
                      key={column}
                      className="flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
                    >
                      <span>
                        {DEFAULT_COLUMNS.find((c) => c.key === column)?.label}: {Array.isArray(value) ? value.join(', ') : value}
                      </span>
                      <button
                        onClick={() => removeFilter(column)}
                        className="hover:text-blue-600 text-lg leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Controls Row 2 - Status Categories and Dropdown Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Status Categories */}
            {Object.entries(getStatusCounts()).map(([category, count]) => {
              const isActive = Array.isArray(filters.statusCategory) && filters.statusCategory.includes(category);
              let bgColor = 'bg-gray-200';
              let activeColor = 'bg-gray-600';
              if (category === 'To Do') {
                bgColor = 'bg-blue-100';
                activeColor = 'bg-blue-600';
              } else if (category === 'In Progress') {
                bgColor = 'bg-yellow-100';
                activeColor = 'bg-yellow-600';
              } else if (category === 'Done') {
                bgColor = 'bg-green-100';
                activeColor = 'bg-green-600';
              }
              return (
                <button
                  key={category}
                  onClick={() => toggleFilterValue('statusCategory', category)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? `${activeColor} text-white` : `${bgColor} text-gray-700 hover:opacity-80`
                  }`}
                >
                  {category}: {count}
                </button>
              );
            })}

            <div className="h-6 w-px bg-gray-300"></div>

            {/* Group By */}
            <div className="relative z-30 filter-dropdown">
              <button
                onClick={() => setOpenDropdown(openDropdown === 'groupby' ? null : 'groupby')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Group By... {groupConfig.column ? `(${DEFAULT_COLUMNS.find(c => c.key === groupConfig.column)?.label})` : ''}
              </button>
              {openDropdown === 'groupby' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Type to search..."
                    value={groupBySearch}
                    onChange={(e) => setGroupBySearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div
                    className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => { handleGroup(null); setGroupBySearch(''); setOpenDropdown(null); }}
                  >
                    None
                  </div>
                  {GROUPABLE_COLUMNS
                    .filter(col => col.label.toLowerCase().includes(groupBySearch.toLowerCase()))
                    .map((col) => (
                      <div
                        key={col.key}
                        className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                        onClick={() => { handleGroup(col.key); setGroupBySearch(''); setOpenDropdown(null); }}
                      >
                        {col.label}
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Filter by Type */}
            <div className="relative z-30 filter-dropdown">
              <button
                onClick={() => handleDropdownOpen('type')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Type... {Array.isArray(filters.type) && filters.type.length > 0 && `(${filters.type.length})`}
              </button>
              {openDropdown === 'type' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Type to search..."
                    value={typeSearch}
                    onChange={(e) => setTypeSearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {Array.from(new Set(issues.map((i) => i.issueType)))
                    .filter(type => type.toLowerCase().includes(typeSearch.toLowerCase()))
                    .sort((a, b) => countOccurrences('issueType', b) - countOccurrences('issueType', a))
                    .map((type) => {
                      const isSelected = isFilterSelected('type', type);
                      const count = countOccurrences('issueType', type);
                      return (
                        <label
                          key={type}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('type', type)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{type}</span>
                          </div>
                          <span className="text-xs text-gray-500">({count})</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Filter by Release */}
            <div className="relative z-30 filter-dropdown">
              <button
                onClick={() => handleDropdownOpen('release')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Release... {Array.isArray(filters.releaseDate) && filters.releaseDate.length > 0 && `(${filters.releaseDate.length})`}
              </button>
              {openDropdown === 'release' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Type to search..."
                    value={releaseSearch}
                    onChange={(e) => setReleaseSearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {Array.from(new Set(issues.map((i) => i.releaseDate)))
                    .filter(date => date && date.toLowerCase().includes(releaseSearch.toLowerCase()))
                    .sort((a, b) => countOccurrences('releaseDate', b) - countOccurrences('releaseDate', a))
                    .map((date) => {
                      const isSelected = isFilterSelected('release', date);
                      const count = countOccurrences('releaseDate', date);
                      return (
                        <label
                          key={date}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('release', date)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{date}</span>
                          </div>
                          <span className="text-xs text-gray-500">({count})</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Client */}
            <div className="relative z-30 filter-dropdown">
              <button
                onClick={() => handleDropdownOpen('client')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Client... {Array.isArray(filters.client) && filters.client.length > 0 && `(${filters.client.length})`}
              </button>
              {openDropdown === 'client' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Type to search..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {Array.from(new Set(issues.map((i) => i.client)))
                    .filter((client): client is string => client !== null && client.toLowerCase().includes(clientSearch.toLowerCase()))
                    .sort((a, b) => countOccurrences('client', b) - countOccurrences('client', a))
                    .map((client) => {
                      const isSelected = isFilterSelected('client', client);
                      const count = countOccurrences('client', client);
                      return (
                        <label
                          key={client}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('client', client)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{client}</span>
                          </div>
                          <span className="text-xs text-gray-500">({count})</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Filter by Fix Version */}
            <div className="relative z-30 filter-dropdown">
              <button
                onClick={() => handleDropdownOpen('fixVersion')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Fix Version... {Array.isArray(filters.fixVersion) && filters.fixVersion.length > 0 && `(${filters.fixVersion.length})`}
              </button>
              {openDropdown === 'fixVersion' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  {Array.from(new Set(issues.flatMap((i) => i.fixVersions || [])))
                    .sort()
                    .map((version) => {
                      const isSelected = isFilterSelected('fixVersion', version);
                      const count = issues.filter(i => i.fixVersions?.includes(version)).length;
                      return (
                        <label
                          key={version}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('fixVersion', version)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{version}</span>
                          </div>
                          <span className="text-xs text-gray-500">({count})</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* No Subtasks Filter */}
            <button
              onClick={() => setShowNoSubtasks(!showNoSubtasks)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                showNoSubtasks
                  ? 'bg-yellow-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              🚫 No Subtasks
            </button>

            {/* Clear All Filters Button */}
            <button
              onClick={clearAllFilters}
              className="px-3 py-2 bg-gray-500 text-white rounded-lg text-sm hover:bg-gray-600 transition-colors"
            >
              Clear All Filters
            </button>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
            >
              🔄 Refresh
            </button>

            {/* Full Screen Button */}
            <button
              onClick={() => setFullScreenMode(true)}
              className="px-3 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
              title="Full Screen Mode"
            >
              ⛶ Full Screen
            </button>

            {/* Stats */}
            <div className="ml-auto text-sm text-gray-600">
              Showing {sortedIssues.length} of {issues.length} issues
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Full Screen Mode Toggle */}
      <div className={`${fullScreenMode ? 'absolute top-2 right-2 z-30' : 'hidden'}`}>
        <button
          onClick={() => setFullScreenMode(!fullScreenMode)}
          className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs hover:bg-gray-700 transition-colors shadow-lg"
          title={fullScreenMode ? "Exit Full Screen" : "Enter Full Screen"}
        >
          {fullScreenMode ? '✕ Exit Full Screen' : '⛶ Full Screen'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <ListView
          groupedIssues={groupedIssues}
          visibleColumns={visibleColumns}
          sortConfig={sortConfig}
          onSort={handleSort}
          onToggleFilterValue={toggleFilterValue}
          feTeamMembers={[]}
          onToggleFETeam={() => {}}
        />
      </div>
    </div>
  );
};

export default MyIssuesTracker;
