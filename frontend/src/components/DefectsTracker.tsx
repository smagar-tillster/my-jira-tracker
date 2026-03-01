import React, { useState, useEffect } from 'react';
import { JiraIssue, Column, SortConfig, GroupConfig } from '../types';
import { filterIssues, sortIssues, groupIssues } from '../services/dataProcessor';
import { useIssueFiltering } from '../hooks/useIssueFiltering';
import ListView from './views/ListView';
import ShimmerLoading from './ShimmerLoading';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';

const DEFAULT_COLUMNS: Column[] = [
  { key: 'issueType', label: 'Type', sortable: true, filterable: true, type: 'text', width: 100 },
  { key: 'key', label: 'Issue Key', sortable: true, filterable: true, type: 'text', width: 120 },
  { key: 'summary', label: 'Summary', sortable: true, filterable: false, type: 'text', width: 400 },
  { key: 'status', label: 'Status', sortable: true, filterable: true, type: 'status', width: 140 },
  { key: 'assignee', label: 'Assignee', sortable: true, filterable: true, type: 'assignee', width: 150 },
  { key: 'client', label: 'Client', sortable: true, filterable: true, type: 'text', width: 120 },
  { key: 'sprint', label: 'Sprint', sortable: true, filterable: true, type: 'text', width: 200 },
  { key: 'created', label: 'Created', sortable: true, filterable: false, type: 'date', width: 120 },
  { key: 'releaseDate', label: 'Release Date', sortable: true, filterable: false, type: 'date', width: 130 },
  { key: 'timeSpent', label: 'Σ Time Spent', sortable: true, filterable: false, type: 'text', width: 120 },
  { key: 'defectCausedBy', label: 'Defect Caused By', sortable: true, filterable: true, type: 'text', width: 150 },
  { key: 'qaNotes', label: 'QA Notes', sortable: true, filterable: false, type: 'text', width: 200 },
  { key: 'statusCategory', label: 'Status Category', sortable: true, filterable: true, type: 'text', width: 140 },
  { key: 'statusCategoryChangeDate', label: 'Status Changed', sortable: true, filterable: false, type: 'date', width: 140 },
];

// Columns allowed in Group By
const GROUPABLE_COLUMN_KEYS = ['issueType', 'assignee', 'sprint', 'client'] as const;
const GROUPABLE_COLUMNS = DEFAULT_COLUMNS.filter(col => GROUPABLE_COLUMN_KEYS.includes(col.key as any));

interface DefectsTrackerProps {
  issues: JiraIssue[];
  loading: boolean;
  onRefresh: () => void;
}

const DefectsTracker: React.FC<DefectsTrackerProps> = ({ issues, loading, onRefresh }) => {
  const [visibleColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'statusCategoryChangeDate', direction: 'desc' });
  const [groupConfig, setGroupConfig] = useState<GroupConfig>({ column: null, direction: 'asc' });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [pendingFilters, setPendingFilters] = useState<{ [key: string]: string[] }>({});
  const [typeSearch, setTypeSearch] = useState('');
  const [sprintSearch, setSprintSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [groupBySearch, setGroupBySearch] = useState('');
  const [hideEmptyDefectCause, setHideEmptyDefectCause] = useState(false);
  
  const { searchTerm, setSearchTerm, filters, addFilter, removeFilter, toggleFilterValue, clearAllFilters } =
    useIssueFiltering(issues);

  // Close dropdowns when clicking outside and apply pending filters
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        // Apply pending filters before closing (only if not empty)
        if (openDropdown && pendingFilters[openDropdown]) {
          const filterKey = getFilterKey(openDropdown);
          const values = pendingFilters[openDropdown];
          if (values.length > 0) {
            addFilter(filterKey, values);
          } else {
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
      'sprint': 'sprint',
      'client': 'client',
      'assignee': 'assignee'
    };
    return mapping[dropdown] || dropdown;
  };

  // Initialize pending filters when dropdown opens
  const handleDropdownOpen = (dropdown: string) => {
    if (openDropdown && openDropdown !== dropdown) {
      if (pendingFilters[openDropdown]) {
        const filterKey = getFilterKey(openDropdown);
        const values = pendingFilters[openDropdown];
        if (values.length > 0) {
          addFilter(filterKey, values);
        } else {
          removeFilter(filterKey);
        }
      }
    }
    setOpenDropdown(openDropdown === dropdown ? null : dropdown);
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

  // Helper function to calculate 8-week date range
  const getEightWeekDateRange = () => {
    const anchorDate = new Date('2025-12-15T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - anchorDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const currentPeriodIndex = Math.floor(diffDays / 14);
    
    // Calculate the start date (beginning of the oldest biweekly period)
    const oldestPeriodIndex = currentPeriodIndex - 3;
    const startDate = new Date(anchorDate);
    startDate.setDate(anchorDate.getDate() + (oldestPeriodIndex * 14));
    
    return { startDate, today, anchorDate, currentPeriodIndex };
  };

  // Filter and sort issues - restrict to last 8 weeks
  let filteredIssues = filterIssues(issues, filters, searchTerm);
  
  // Apply 8-week date filter
  const { startDate, today } = getEightWeekDateRange();
  filteredIssues = filteredIssues.filter(issue => {
    if (issue.statusCategoryChangeDate) {
      const issueDate = new Date(issue.statusCategoryChangeDate);
      issueDate.setHours(0, 0, 0, 0);
      return issueDate >= startDate && issueDate <= today;
    }
    return false;
  });
  
  if (hideEmptyDefectCause) {
    filteredIssues = filteredIssues.filter(issue => !issue.defectCausedBy || issue.defectCausedBy === 'Other');
  }
  const sortedIssues = sortIssues(filteredIssues, sortConfig);
  const groupedIssues = groupIssues(sortedIssues, groupConfig.column);

  // Count occurrences of a field value in filtered issues
  const countOccurrences = (field: keyof JiraIssue, value: string): number => {
    return filteredIssues.filter((issue) => String(issue[field]) === value).length;
  };

  const handleSort = (column: keyof JiraIssue) => {
    setSortConfig((prev) => ({
      column,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  // Filter issues to only include those from the last 8 weeks
  const getIssuesInLast8Weeks = () => {
    const { startDate, today } = getEightWeekDateRange();
    
    return filteredIssues.filter(issue => {
      if (issue.statusCategoryChangeDate) {
        const issueDate = new Date(issue.statusCategoryChangeDate);
        issueDate.setHours(0, 0, 0, 0);
        return issueDate >= startDate && issueDate <= today;
      }
      return false;
    });
  };

  // Group issues by biweekly Monday for trend chart
  const getTrendData = () => {
    const { anchorDate, currentPeriodIndex } = getEightWeekDateRange();
    
    // Generate the last 4 biweekly Monday buckets (8 weeks of data)
    const biweeklyBuckets: { [key: string]: { defects: number; tasks: number } } = {};
    
    // Create buckets for last 4 biweekly periods
    for (let i = 3; i >= 0; i--) {
      const periodIndex = currentPeriodIndex - i;
      const biweeklyMonday = new Date(anchorDate);
      biweeklyMonday.setDate(anchorDate.getDate() + (periodIndex * 14));
      
      const year = biweeklyMonday.getFullYear();
      const month = String(biweeklyMonday.getMonth() + 1).padStart(2, '0');
      const day = String(biweeklyMonday.getDate()).padStart(2, '0');
      const weekKey = `${year}-${month}-${day}`;
      
      biweeklyBuckets[weekKey] = { defects: 0, tasks: 0 };
    }
    
    // Now assign issues to buckets
    filteredIssues.forEach(issue => {
      if (issue.statusCategoryChangeDate) {
        const date = new Date(issue.statusCategoryChangeDate);
        date.setHours(0, 0, 0, 0);
        
        // Calculate which biweekly Monday this date belongs to
        const diffTime = date.getTime() - anchorDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const periodIndex = Math.floor(diffDays / 14);
        
        const biweeklyMonday = new Date(anchorDate);
        biweeklyMonday.setDate(anchorDate.getDate() + (periodIndex * 14));
        
        const year = biweeklyMonday.getFullYear();
        const month = String(biweeklyMonday.getMonth() + 1).padStart(2, '0');
        const day = String(biweeklyMonday.getDate()).padStart(2, '0');
        const weekKey = `${year}-${month}-${day}`;
        
        // Only count if it's in one of our 3 buckets
        if (biweeklyBuckets[weekKey] !== undefined) {
          if (issue.issueType === 'Bug' || issue.issueType === 'Defect') {
            biweeklyBuckets[weekKey].defects++;
          } else {
            biweeklyBuckets[weekKey].tasks++;
          }
        }
      }
    });
    
    // Sort by date and format
    return Object.keys(biweeklyBuckets)
      .sort()
      .map(key => {
        const parts = key.split('-');
        const month = parts[1];
        const day = parts[2];
        
        const defects = biweeklyBuckets[key].defects;
        const tasks = biweeklyBuckets[key].tasks;
        const total = defects + tasks;
        const defectPercent = total > 0 ? Math.round((defects / total) * 100) : 0;
        
        return {
          week: `W/${month}/${day}`,
          Defects: defects,
          Tasks: tasks,
          defectPercent,
          defectLabel: `${defects} (${defectPercent}%)`,
        };
      });
  };

  // Get defect caused by data for bar chart - count issues from last 8 weeks with defectCausedBy field
  const getDefectCausedByData = () => {
    const causedBy: { [key: string]: number } = {};
    
    // Get issues from last 8 weeks
    const issuesInLast8Weeks = getIssuesInLast8Weeks();
    const { startDate, today } = getEightWeekDateRange();
    
    console.log('Analyzing issues for defect causes (last 8 weeks). Total filtered issues:', issuesInLast8Weeks.length);
    console.log('Date range:', startDate.toISOString().split('T')[0], 'to', today.toISOString().split('T')[0]);
    
    // Count only Bug/Defect issues that have defectCausedBy field populated
    let issuesWithCause = 0;
    issuesInLast8Weeks.forEach(issue => {
      // Only include Bug or Defect issue types
      if ((issue.issueType === 'Bug' || issue.issueType === 'Defect') && issue.defectCausedBy) {
        issuesWithCause++;
        const reason = issue.defectCausedBy;
        causedBy[reason] = (causedBy[reason] || 0) + 1;
      }
    });
    
    console.log('Defect issues with defectCausedBy:', issuesWithCause);
    console.log('Defect causes found:', Object.keys(causedBy));
    
    // Sort by count and get top 10
    const result = Object.entries(causedBy)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    console.log('Defect Caused By Chart Data:', result);
    return result;
  };

  // Calculate defects and tasks counts for last 8 weeks only
  const issuesInLast8Weeks = getIssuesInLast8Weeks();
  const defectsCount = issuesInLast8Weeks.filter(issue => 
    issue.issueType === 'Bug' || issue.issueType === 'Defect'
  ).length;
  const tasksCount = issuesInLast8Weeks.length - defectsCount;

  const trendData = getTrendData();
  const causedByData = getDefectCausedByData();

  const handleGroup = (column: keyof JiraIssue | null) => {
    setGroupConfig({ column, direction: 'asc' });
  };

  if (loading) {
    return <ShimmerLoading />;
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-auto">
      {/* Header and Controls */}
      <div className="bg-white border-b border-gray-200 p-4">
          <div className="space-y-4">
            {/* Search Bar and Buttons */}
            <div className="flex gap-3 items-center">
              <input
                type="text"
                placeholder="Search defects by key, summary, assignee..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              
              {/* Stats Display */}
              <div className="flex gap-2 text-sm font-medium">
                <div className="bg-red-50 px-3 py-2 rounded-lg whitespace-nowrap">
                  <span className="text-gray-600">Defects: </span>
                  <span className="text-red-700 font-bold">{defectsCount}</span>
                </div>
                <div className="bg-blue-50 px-3 py-2 rounded-lg whitespace-nowrap">
                  <span className="text-gray-600">Tasks: </span>
                  <span className="text-blue-700 font-bold">{tasksCount}</span>
                </div>
              </div>

              {/* Refresh Button */}
              <button
                onClick={onRefresh}
                className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
              >
                🔄 Refresh
              </button>
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap gap-3 items-center relative z-30">
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
                  Type... {Array.isArray(filters.issueType) && filters.issueType.length > 0 && `(${filters.issueType.length})`}
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

              {/* Filter by Assignee */}
              <div className="relative z-30 filter-dropdown">
                <button
                  onClick={() => handleDropdownOpen('assignee')}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
                >
                  Assignee... {Array.isArray(filters.assignee) && filters.assignee.length > 0 && `(${filters.assignee.length})`}
                </button>
                {openDropdown === 'assignee' && (
                  <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                    {Array.from(new Set(issues.map((i) => i.assignee)))
                      .sort((a, b) => countOccurrences('assignee', b) - countOccurrences('assignee', a))
                      .map((assignee) => {
                        const isSelected = isFilterSelected('assignee', assignee);
                        const count = countOccurrences('assignee', assignee);
                        return (
                          <label
                            key={assignee}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePendingFilter('assignee', assignee)}
                                className="w-4 h-4"
                              />
                              <span className="text-sm">{assignee}</span>
                            </div>
                            <span className="text-xs text-gray-500">({count})</span>
                          </label>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Filter by Sprint */}
              <div className="relative z-30 filter-dropdown">
                <button
                  onClick={() => handleDropdownOpen('sprint')}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
                >
                  Sprint... {Array.isArray(filters.sprint) && filters.sprint.length > 0 && `(${filters.sprint.length})`}
                </button>
                {openDropdown === 'sprint' && (
                  <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                    <input
                      type="text"
                      placeholder="Type to search..."
                      value={sprintSearch}
                      onChange={(e) => setSprintSearch(e.target.value)}
                      className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {Array.from(new Set(issues.map((i) => i.sprint)))
                      .filter((sprint): sprint is string => sprint !== null && sprint.toLowerCase().includes(sprintSearch.toLowerCase()))
                      .sort((a, b) => countOccurrences('sprint', b) - countOccurrences('sprint', a))
                      .map((sprint) => {
                        const isSelected = isFilterSelected('sprint', sprint);
                        const count = countOccurrences('sprint', sprint);
                        return (
                          <label
                            key={sprint}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePendingFilter('sprint', sprint)}
                                className="w-4 h-4"
                              />
                              <span className="text-sm">{sprint}</span>
                            </div>
                            <span className="text-xs text-gray-500">({count})</span>
                          </label>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Filter by Client */}
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
                    {Array.from(new Set(issues.map((i) => i.client).filter(Boolean)))
                      .filter(client => client && client.toLowerCase().includes(clientSearch.toLowerCase()))
                      .sort((a, b) => countOccurrences('client', b!) - countOccurrences('client', a!))
                      .map((client) => {
                        const isSelected = isFilterSelected('client', client!);
                        const count = countOccurrences('client', client!);
                        return (
                          <label
                            key={client}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePendingFilter('client', client!)}
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

              {/* No Defect Cause Filter */}
              <button
                onClick={() => setHideEmptyDefectCause(!hideEmptyDefectCause)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  hideEmptyDefectCause
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                }`}
              >
                {hideEmptyDefectCause ? '✓ No Defect Cause' : 'No Defect Cause'}
              </button>

              {/* Clear Filters */}
              {(Object.keys(filters).length > 0 || searchTerm || hideEmptyDefectCause) && (
                <button
                  onClick={() => {
                    clearAllFilters();
                    setHideEmptyDefectCause(false);
                  }}
                  className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors"
                >
                  Clear Filters
                </button>
              )}

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

              {/* Stats */}
              <div className="ml-auto text-sm text-gray-600">
                Showing {sortedIssues.length} of {issues.length} issues
              </div>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="bg-white border-b border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-4">
            {/* Trend Chart */}
            <div className="bg-gray-50 p-3 rounded-lg">
              <h3 className="text-lg font-semibold mb-2 text-gray-700">
                Defects vs Tasks Trend (Biweekly - Last 8 Weeks) - Defects: {defectsCount}, Tasks: {tasksCount}
              </h3>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={trendData} margin={{ top: 25, right: 40, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={0} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                    <Line type="monotone" dataKey="Defects" stroke="#ef4444" strokeWidth={2.5}>
                      <LabelList 
                        dataKey="defectLabel" 
                        position="top" 
                        style={{ fontSize: 12, fill: '#ef4444', fontWeight: 'bold' }} 
                        offset={8}
                      />
                    </Line>
                    <Line type="monotone" dataKey="Tasks" stroke="#3b82f6" strokeWidth={2.5}>
                      <LabelList 
                        dataKey="Tasks" 
                        position="bottom" 
                        style={{ fontSize: 12, fill: '#3b82f6', fontWeight: 'bold' }} 
                        offset={8}
                      />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[320px] flex items-center justify-center text-gray-500">
                  No trend data available
                </div>
              )}
            </div>

            {/* Defect Caused By Chart */}
            <div className="bg-gray-50 p-3 rounded-lg">
              <h3 className="text-lg font-semibold mb-2 text-gray-700">
                Top 10 Defect Causes - Last 8 Weeks {causedByData.length > 0 && `(${causedByData.reduce((sum, d) => sum + d.count, 0)} total)`}
              </h3>
              {causedByData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={causedByData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis 
                      type="category" 
                      dataKey="reason" 
                      tick={{ fontSize: 11 }} 
                      width={140}
                    />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="#f59e0b">
                      <LabelList 
                        dataKey="count" 
                        position="right" 
                        style={{ fontSize: 16, fill: '#000', fontWeight: 'bold' }} 
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-500">
                  No defect cause data available - Check if "Defect Caused By" field is populated
                </div>
              )}
            </div>
          </div>
        </div>

        {/* List View */}
        <div className="flex-1">
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

export default DefectsTracker;
