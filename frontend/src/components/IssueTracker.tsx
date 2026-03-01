import React, { useState, useEffect } from 'react';
import { JiraIssue, Column, SortConfig, GroupConfig } from '../types';
import { filterIssues, sortIssues, groupIssues } from '../services/dataProcessor';
import { useIssueFiltering } from '../hooks/useIssueFiltering';
import { jiraApi } from '../services/api';
import ListView from './views/ListView';
import CalendarView from './views/CalendarView';
import GanttView from './views/GanttView';
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
  { key: 'components', label: 'Components', sortable: false, filterable: true, type: 'array', width: 200 },
  { key: 'sprint', label: 'Sprint', sortable: true, filterable: true, type: 'text', width: 200 },
  { key: 'created', label: 'Created', sortable: true, filterable: false, type: 'date', width: 120 },
  { key: 'statusCategory', label: 'Status Category', sortable: true, filterable: true, type: 'text', width: 140 },
  { key: 'fixVersions', label: 'Fix Version', sortable: true, filterable: true, type: 'array', width: 300 },
  { key: 'parentSummary', label: 'Parent Summary', sortable: true, filterable: false, type: 'text', width: 250 },
  { key: 'timeSpent', label: 'Σ Time Spent', sortable: true, filterable: false, type: 'text', width: 120 },
  { key: 'originalEstimate', label: 'Σ Original Estimate', sortable: true, filterable: false, type: 'text', width: 150 },
];

// Columns allowed in Group By
const GROUPABLE_COLUMN_KEYS = ['issueType', 'status', 'assignee', 'dueDate', 'releaseDate', 'client', 'fixVersions'] as const;
const GROUPABLE_COLUMNS = DEFAULT_COLUMNS.filter(col => GROUPABLE_COLUMN_KEYS.includes(col.key as any));

// FE Team members list
const FE_TEAM_MEMBERS = [
  'Sarah Johnson',
  'Mike Chen',
  'Alex Rodriguez',
  'Emma Wilson',
  'David Kim',
  'Lisa Anderson'
];

interface IssueTrackerProps {
  issues: JiraIssue[];
  loading: boolean;
  onRefresh: () => void;
}

const IssueTracker: React.FC<IssueTrackerProps> = ({ issues, loading, onRefresh }) => {
  const [visibleColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'dueDate', direction: 'desc' });
  const [groupConfig, setGroupConfig] = useState<GroupConfig>({ column: null, direction: 'asc' });
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'gantt'>('list');
  const [calendarDateType, setCalendarDateType] = useState<'dueDate' | 'releaseDate'>('releaseDate');
  const [fullScreenMode, setFullScreenMode] = useState(false);
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const [showNoDueDate, setShowNoDueDate] = useState(false);
  const [showFETeamOnly, setShowFETeamOnly] = useState(false);
  const [typeSearch, setTypeSearch] = useState('');
  const [sprintSearch, setSprintSearch] = useState('');
  const [releaseSearch, setReleaseSearch] = useState('');
  const [groupBySearch, setGroupBySearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [componentSearch, setComponentSearch] = useState('');
  
  // Load FE Team members from backend
  const [feTeamMembers, setFETeamMembers] = useState<string[]>([]);
  const [feTeamLoading, setFETeamLoading] = useState(true);

  // Load FE Team members from backend on mount
  useEffect(() => {
    const loadFETeam = async () => {
      try {
        const flags = await jiraApi.getAllFETeamFlags();
        const members = Object.keys(flags).filter(assignee => flags[assignee] === true);
        setFETeamMembers(members);
      } catch (error) {
        console.error('Failed to load FE team members:', error);
        // Fallback to default
        setFETeamMembers(FE_TEAM_MEMBERS);
      } finally {
        setFETeamLoading(false);
      }
    };
    loadFETeam();
  }, []);

  // Toggle FE Team membership for an assignee
  const toggleFETeamMember = async (assignee: string) => {
    const isMember = feTeamMembers.includes(assignee);
    const newIsMember = !isMember;
    
    // Optimistically update UI
    setFETeamMembers(prev => {
      if (isMember) {
        return prev.filter(name => name !== assignee);
      } else {
        return [...prev, assignee];
      }
    });

    // Save to backend
    try {
      await jiraApi.setFETeamMember(assignee, newIsMember);
    } catch (error) {
      console.error('Failed to save FE team membership:', error);
      // Revert on error
      setFETeamMembers(prev => {
        if (newIsMember) {
          return prev.filter(name => name !== assignee);
        } else {
          return [...prev, assignee];
        }
      });
    }
  };
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
  }, [issues.length]); // Only run when issues first load

  // Helper function to check if issue is urgent (red)
  const isUrgent = (issue: JiraIssue): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dueDate = issue.dueDate ? new Date(issue.dueDate) : null;
    const releaseDate = issue.releaseDate && issue.releaseDate !== 'NA' ? new Date(issue.releaseDate) : null;
    
    return Boolean((dueDate && dueDate <= tomorrow) || (releaseDate && releaseDate <= tomorrow));
  };

  // Helper function to check if issue needs attention (orange)
  const needsAttention = (issue: JiraIssue): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threeDays = new Date(today);
    threeDays.setDate(threeDays.getDate() + 3);
    
    const dueDate = issue.dueDate ? new Date(issue.dueDate) : null;
    const releaseDate = issue.releaseDate && issue.releaseDate !== 'NA' ? new Date(issue.releaseDate) : null;
    
    return Boolean((dueDate && dueDate <= threeDays) || (releaseDate && releaseDate <= threeDays));
  };

  // Get status category counts
  const getStatusCounts = () => {
    const counts: Record<string, number> = {};
    issues.forEach(issue => {
      const category = issue.statusCategory || 'unknown';
      counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
  };

  // Close dropdowns when clicking outside and apply pending filters
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        // Apply pending filters before closing (only if not empty)
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
      'status': 'status',
      'sprint': 'sprint',
      'release': 'releaseDate',
      'client': 'client',
      'component': 'components'
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

  // Get unique clients by splitting comma-separated values
  const getUniqueClients = () => {
    const clientSet = new Set<string>();
    issues.forEach(issue => {
      if (issue.client) {
        issue.client.split(',').forEach(client => {
          const trimmed = client.trim();
          if (trimmed) clientSet.add(trimmed);
        });
      }
    });
    return Array.from(clientSet).sort();
  };

  // Assign colors to all existing clients
  const getClientColor = (client: string): string => {
    const colors = [
      'bg-red-100',
      'bg-blue-100',
      'bg-green-100',
      'bg-yellow-100',
      'bg-purple-100',
      'bg-pink-100',
      'bg-indigo-100',
      'bg-orange-100',
      'bg-teal-100',
      'bg-cyan-100',
      'bg-rose-100',
      'bg-lime-100',
      'bg-emerald-100',
      'bg-sky-100',
      'bg-violet-100',
    ];
    
    const allClients = getUniqueClients();
    const index = allClients.indexOf(client);
    
    // If client found, return its assigned color, otherwise gray
    return index >= 0 ? colors[index % colors.length] : 'bg-gray-100';
  };

  // Filter by important flag
  let filteredByFlags = showImportantOnly 
    ? issues.filter(issue => issue.important)
    : issues;

  // Filter by urgent
  if (showUrgentOnly) {
    filteredByFlags = filteredByFlags.filter(issue => isUrgent(issue));
  }

  // Filter by attention
  if (showAttentionOnly) {
    filteredByFlags = filteredByFlags.filter(issue => needsAttention(issue) && !isUrgent(issue));
  }

  // Filter by no due date
  if (showNoDueDate) {
    filteredByFlags = filteredByFlags.filter(issue => !issue.dueDate);
  }

  // Filter by FE Team
  if (showFETeamOnly) {
    filteredByFlags = filteredByFlags.filter(issue => 
      feTeamMembers.includes(issue.assignee)
    );
  }

  // Filter and sort issues
  const filteredIssues = filterIssues(filteredByFlags, filters, searchTerm);
  const sortedIssues = sortIssues(filteredIssues, sortConfig);
  const groupedIssues = groupIssues(sortedIssues, groupConfig.column);

  // Count occurrences of a field value in filtered issues
  const countOccurrences = (field: keyof JiraIssue, value: string): number => {
    return filteredIssues.filter((issue) => {
      const issueValue = issue[field];
      if (Array.isArray(issueValue)) {
        return issueValue.includes(value);
      }
      return String(issueValue) === value;
    }).length;
  };

  // Calculate time tracking sums
  const totalTimeSpent = filteredIssues.reduce((sum, issue) => sum + (issue.timeSpent || 0), 0);
  const totalOriginalEstimate = filteredIssues.reduce((sum, issue) => sum + (issue.originalEstimate || 0), 0);

  // Convert seconds to hours for display
  const totalTimeSpentHours = totalTimeSpent > 0 ? Math.round(totalTimeSpent / 3600 * 100) / 100 : 0;
  const totalOriginalEstimateHours = totalOriginalEstimate > 0 ? Math.round(totalOriginalEstimate / 3600 * 100) / 100 : 0;

  const handleSort = (column: keyof JiraIssue) => {
    setSortConfig((prev) => ({
      column,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleGroup = (column: keyof JiraIssue | null) => {
    setGroupConfig({ column, direction: 'asc' });
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
            {/* Time Tracking on Top Right */}
            <div className="flex gap-4 text-sm font-medium">
              <div className="bg-blue-50 px-3 py-2 rounded-lg whitespace-nowrap">
                <span className="text-gray-600">Σ Time Spent: </span>
                <span className="text-blue-700 font-bold">{totalTimeSpentHours.toFixed(2)}h</span>
              </div>
              <div className="bg-green-50 px-3 py-2 rounded-lg whitespace-nowrap">
                <span className="text-gray-600">Σ Estimate: </span>
                <span className="text-green-700 font-bold">{totalOriginalEstimateHours.toFixed(2)}h</span>
              </div>
            </div>
          </div>

          {/* Controls Row 1 - View Mode and Button Filters */}
          <div className="flex gap-3 items-center flex-wrap">
              {/* View Mode Switcher */}
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📋 List
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'calendar'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📅 Calendar
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'gantt'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                📊 Gantt
              </button>

              {/* Calendar/Gantt Date Type Selector */}
              {(viewMode === 'calendar' || viewMode === 'gantt') && (
                <>
                  <button
                    onClick={() => setCalendarDateType('dueDate')}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      calendarDateType === 'dueDate'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                    }`}
                  >
                    Due Date
                  </button>
                  <button
                    onClick={() => setCalendarDateType('releaseDate')}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      calendarDateType === 'releaseDate'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                    }`}
                  >
                    Release Date
                  </button>
                </>
              )}

              <div className="h-6 w-px bg-gray-300"></div>

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
                    : 'bg-red-100 text-red-800 hover:bg-red-200'
                }`}
              >
                🚨 Urgent
              </button>

              {/* Attention Filter */}
              <button
                onClick={() => setShowAttentionOnly(!showAttentionOnly)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showAttentionOnly
                    ? 'bg-orange-600 text-white'
                    : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
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

              {/* FE Team Filter */}
              <button
                onClick={() => setShowFETeamOnly(!showFETeamOnly)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showFETeamOnly
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                }`}
              >
                👥 FE Team
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
          <div className="flex flex-wrap gap-3 items-center relative z-30">
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

            {/* Filter by Status */}
            <div className="relative z-20 filter-dropdown">
              <button
                onClick={() => handleDropdownOpen('status')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Status... {Array.isArray(filters.status) && filters.status.length > 0 && `(${filters.status.length})`}
              </button>
              {openDropdown === 'status' && (
                <div className="absolute z-30 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  {Array.from(new Set(issues.map((i) => i.status)))
                    .sort((a, b) => countOccurrences('status', b) - countOccurrences('status', a))
                    .map((status) => {
                      const isSelected = isFilterSelected('status', status);
                      const count = countOccurrences('status', status);
                      return (
                        <label
                          key={status}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('status', status)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{status}</span>
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
                    .filter(rel => rel && rel !== 'NA' && rel.toLowerCase().includes(releaseSearch.toLowerCase()))
                    .sort((a, b) => countOccurrences('releaseDate', b) - countOccurrences('releaseDate', a))
                    .map((releaseDate) => {
                      const isSelected = isFilterSelected('release', releaseDate);
                      const count = countOccurrences('releaseDate', releaseDate);
                      return (
                        <label
                          key={releaseDate}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('release', releaseDate)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{releaseDate}</span>
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
                  {getUniqueClients()
                    .filter(client => client.toLowerCase().includes(clientSearch.toLowerCase()))
                    .sort((a, b) => {
                      // Count how many issues have this client
                      const countA = issues.filter(i => i.client?.includes(a)).length;
                      const countB = issues.filter(i => i.client?.includes(b)).length;
                      return countB - countA;
                    })
                    .map((client) => {
                      const isSelected = isFilterSelected('client', client);
                      const count = issues.filter(i => i.client?.includes(client)).length;
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
                          <span className="text-xs text-gray-500 font-semibold">({count})</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Filter by Component */}
            <div className="relative z-30 filter-dropdown">
              <button
                onClick={() => handleDropdownOpen('component')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 w-full text-left"
              >
                Component... {Array.isArray(filters.component) && filters.component.length > 0 && `(${filters.component.length})`}
              </button>
              {openDropdown === 'component' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Type to search..."
                    value={componentSearch}
                    onChange={(e) => setComponentSearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {Array.from(new Set(issues.flatMap(i => i.components)))
                    .filter(component => component.toLowerCase().includes(componentSearch.toLowerCase()))
                    .sort((a, b) => {
                      const countA = issues.filter(i => i.components.includes(a)).length;
                      const countB = issues.filter(i => i.components.includes(b)).length;
                      return countB - countA;
                    })
                    .map((component) => {
                      const isSelected = isFilterSelected('component', component);
                      const count = issues.filter(i => i.components.includes(component)).length;
                      return (
                        <label
                          key={component}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePendingFilter('component', component)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">{component}</span>
                          </div>
                          <span className="text-xs text-gray-500">({count})</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Clear Filters */}
            {(Object.keys(filters).length > 0 || searchTerm) && (
              <button
                onClick={clearAllFilters}
                className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors"
              >
                Clear Filters
              </button>
            )}

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
        {viewMode === 'list' ? (
          <ListView
            groupedIssues={groupedIssues}
            visibleColumns={visibleColumns}
            sortConfig={sortConfig}
            onSort={handleSort}
            onToggleFilterValue={toggleFilterValue}
            feTeamMembers={feTeamMembers}
            onToggleFETeam={toggleFETeamMember}
          />
        ) : viewMode === 'calendar' ? (
          <CalendarView issues={sortedIssues} dateType={calendarDateType} />
        ) : (
          <GanttView issues={sortedIssues} dateType={calendarDateType} />
        )}
      </div>
    </div>
  );
};

export default IssueTracker;
