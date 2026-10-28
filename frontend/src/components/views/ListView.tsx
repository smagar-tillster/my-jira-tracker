import React, { useState, useMemo } from 'react';
import { JiraIssue, Column, SortConfig } from '../../types';
import { jiraApi } from '../../services/api';
import { parseLocalDate } from '../../utils/dateUtils';
import { bucketOf, countBuckets, BUCKET_PILL, BUCKET_HINT } from '../../utils/statusBuckets';

interface ListViewProps {
  groupedIssues: Map<string, JiraIssue[]>;
  visibleColumns: Column[];
  sortConfig: SortConfig;
  onSort: (column: keyof JiraIssue) => void;
  onToggleFilterValue: (column: string, value: string) => void;
  feTeamMembers: string[];
  onToggleFETeam: (assignee: string) => void;
  // Defaults to expanding the first group (matches the main List page). Pass false to start
  // every group collapsed instead (e.g. client sub-groups nested under a Region).
  defaultExpandFirst?: boolean;
  // Show the Blocked / Aligned counts on each group line. Off for the plain "All Issues" list and when grouping by status.
  showGroupCounts?: boolean;
}

// Summary can shrink to this share of its width on a narrow screen; the other columns keep their width and the table scrolls sideways.
const SUMMARY_MIN_RATIO = 0.82;

const ListView: React.FC<ListViewProps> = ({
  groupedIssues,
  visibleColumns,
  sortConfig,
  onSort,
  onToggleFilterValue,
  feTeamMembers,
  onToggleFETeam,
  defaultExpandFirst = true,
  showGroupCounts = false,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(defaultExpandFirst ? [...groupedIssues.keys()].slice(0, 1) : [])
  );

  // Pre-compute background color for ALL visible issues in one pass.
  // parseLocalDate is called once per issue instead of once per row per render.
  const rowBgColors = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const threeDays = new Date(today); threeDays.setDate(today.getDate() + 3);
    const map = new Map<string, string>();
    for (const issues of groupedIssues.values()) {
      for (const issue of issues) {
        if (bucketOf(issue) === 'done') {
          map.set(issue.key, '');
          continue;
        }
        const due = parseLocalDate(issue.dueDate);
        const rel = issue.releaseDate !== 'NA' ? parseLocalDate(issue.releaseDate) : null;
        if ((due && due <= tomorrow) || (rel && rel <= tomorrow)) { map.set(issue.key, 'bg-red-100'); continue; }
        if ((due && due <= threeDays) || (rel && rel <= threeDays)) { map.set(issue.key, 'bg-orange-100'); continue; }
        map.set(issue.key, '');
      }
    }
    return map;
  }, [groupedIssues]);

  const toggleGroupExpansion = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey);
    } else {
      newExpanded.add(groupKey);
    }
    setExpandedGroups(newExpanded);
  };

  const formatCellValue = (value: any, columnType: string): string => {
    if (value == null) return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (columnType === 'date' && value) {
      const date = parseLocalDate(value);
      if (!date) return '—';
      // Compact: the year is only shown when it is not the current one
      return date.toLocaleDateString('en-US', {
        ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
        month: 'short',
        day: 'numeric',
      });
    }
    return String(value);
  };

  // Convert seconds to hours for time tracking columns
  const formatTimeValue = (seconds: number): string => {
    if (!seconds || seconds === 0) return '0h';
    const hours = Math.round(seconds / 3600 * 100) / 100;
    return `${hours}h`;
  };

  const [importantStates, setImportantStates] = React.useState<Record<string, boolean>>({});
  const [myDayStates, setMyDayStates] = React.useState<Record<string, boolean>>({});

  const renderCell = (issue: JiraIssue, column: Column) => {
    const value = issue[column.key];

    // Special handling for important star
    if (column.key === 'important') {
      const isImportant = importantStates[issue.key] ?? Boolean(issue.important);
      const isMyDay = myDayStates[issue.key] ?? Boolean(issue.myDay);

      return (
        <div className="flex gap-2 items-center justify-center">
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const newValue = !isImportant;
              setImportantStates(prev => ({ ...prev, [issue.key]: newValue }));
              issue.important = newValue;
              await jiraApi.setIssueImportant(issue.key, newValue);
            }}
            className={`w-5 text-center text-[15.1px] leading-none cursor-pointer hover:scale-110 transition-all ${isImportant ? 'opacity-100 grayscale-0' : 'opacity-30 grayscale hover:opacity-60'}`}
            title={isImportant ? "Remove Imp" : "Mark Imp"}
          >⭐</button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const newValue = !isMyDay;
              setMyDayStates(prev => ({ ...prev, [issue.key]: newValue }));
              issue.myDay = newValue;
              await jiraApi.setIssueMyDay(issue.key, newValue);
            }}
            className={`w-5 text-center text-[15.1px] leading-none cursor-pointer hover:scale-110 transition-all ${isMyDay ? 'opacity-100 grayscale-0' : 'opacity-30 grayscale hover:opacity-60'}`}
            title={isMyDay ? "Remove from My Day" : "Add to My Day"}
          >☀️</button>
        </div>
      );
    }

    // Special handling for issue key - make it a link to Jira
    if (column.key === 'key') {
      return (
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 font-medium hover:underline text-[14px]"
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </a>
      );
    }

    // Special handling for assignee - show FE Team tag if applicable
    if (column.key === 'assignee') {
      const isFETeam = feTeamMembers.includes(String(value));
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const assigneeName = String(value);
            const message = isFETeam 
              ? `Remove ${assigneeName} from FE Team?`
              : `Add ${assigneeName} to FE Team?`;
            
            if (window.confirm(message)) {
              onToggleFETeam(assigneeName);
            }
          }}
          className="w-full text-left hover:bg-purple-50 rounded px-1 transition-colors flex items-center gap-1 min-w-0"
          title={`${formatCellValue(value, column.type)}\n${isFETeam ? 'Click to remove from FE Team' : 'Click to add to FE Team'}`}
        >
          <span className="truncate text-[14px] text-gray-700">{formatCellValue(value, column.type)}</span>
          {isFETeam && (
            <span className="shrink-0 bg-purple-100 text-purple-800 px-1.5 rounded-full text-[10.8px] font-medium">👥 FE</span>
          )}
        </button>
      );
    }

    // Special handling for client - display as simple gray badges
    if (column.key === 'client' && value) {
      const clients = String(value).split(',').map(c => c.trim());
      return (
        <div className="flex gap-1 overflow-hidden">
          {clients.map((client, i) => (
            <span
              key={i}
              className="bg-gray-100 px-1.5 rounded text-[13px] font-medium shrink-0"
            >
              {client}
            </span>
          ))}
        </div>
      );
    }

    // Special handling for time tracking columns - display in hours
    if (column.key === 'timeSpent' || column.key === 'originalEstimate') {
      return <span className="text-[15.1px] text-gray-700">{formatTimeValue(Number(value) || 0)}</span>;
    }

    switch (column.type) {
      case 'status':
        return (
          <span className={`px-2 py-0.5 rounded-full text-[13px] leading-5 font-medium whitespace-nowrap ${BUCKET_PILL[bucketOf(issue)]}`}>
            {formatCellValue(value, column.type)}
          </span>
        );

      case 'date':
        return <span className="text-[14px] text-gray-700">{formatCellValue(value, column.type)}</span>;

      case 'url':
        return (
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline text-[15.1px]"
          >
            {formatCellValue(value, column.type)}
          </a>
        );

      case 'array':
        // Default array rendering
        return (
          <div className="flex gap-1 overflow-hidden">
            {Array.isArray(value) &&
              value.map((v, i) => (
                <span key={i} className="bg-gray-200 text-gray-800 px-1.5 rounded text-[13px] shrink-0">
                  {v}
                </span>
              ))}
          </div>
        );

      default:
        return <span className="text-[14px] text-gray-700">{formatCellValue(value, column.type)}</span>;
    }
  };

  // Full text on hover for cells that can be clipped
  const cellTitle = (issue: JiraIssue, column: Column): string | undefined => {
    const v = issue[column.key];
    if (v == null || v === '') return undefined;
    if (column.type === 'date') {
      const d = parseLocalDate(String(v));
      return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : undefined;
    }
    if (column.key === 'key' || column.key === 'important') return undefined;
    const full = Array.isArray(v) ? v.join(', ') : String(v);
    // Assignee has its own click (FE Team), explained on the name itself
    return column.filterable && column.key !== 'assignee' ? `${full}\nClick to filter by this value` : full;
  };

  // Summary takes the spare width; every other column is fixed, so the single header and all rows line up.
  const colStyle = (column: Column): React.CSSProperties => {
    const w = Number(column.width) || 150;
    return column.key === 'summary'
      ? { flex: `1 1 ${w}px`, minWidth: Math.round(w * SUMMARY_MIN_RATIO) }
      : { width: w, minWidth: w, maxWidth: w, flexShrink: 0 };
  };
  const HEADER_H = 38; // px; group lines stick just below the header
  // The table never gets narrower than its columns (Summary can shrink to 82% of its width); wider screens give the extra to Summary.
  const minTotal = visibleColumns.reduce((n, c) => n + (c.key === 'summary' ? Math.round((Number(c.width) || 150) * SUMMARY_MIN_RATIO) : Number(c.width) || 150), 0);

  const countPill = (label: string, n: number, kind: 'blocked' | 'aligned') => (
    <span
      title={BUCKET_HINT[kind]}
      className={`inline-flex justify-between w-[75px] px-2 rounded-full text-[11.5px] ${
        n === 0 ? 'text-gray-400'
          : kind === 'blocked' ? 'bg-white text-gray-800 ring-1 ring-gray-400'
          : 'bg-orange-200 text-orange-900'}`}
    >
      <span>{label}</span><b className="font-semibold">{n}</b>
    </span>
  );

  return (
    <div className="bg-gray-200 pb-2" style={{ minWidth: minTotal }}>
      {/* One header row for the whole list */}
      <div className="flex bg-gray-800 sticky top-0 z-20" style={{ height: HEADER_H, minWidth: minTotal }}>
        {visibleColumns.map((column) => (
          <div
            key={column.key}
            className={`px-2 text-[14.4px] font-semibold text-white border-r border-gray-700 last:border-r-0 flex items-center gap-1.5 ${column.key === 'important' ? 'justify-center' : ''}`}
            style={colStyle(column)}
            title={column.label}
          >
            {column.sortable && (
              <button onClick={() => onSort(column.key)} className="text-gray-300 hover:text-white" title={`Sort by ${column.label}`}>
                {sortConfig.column === column.key ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '⇅'}
              </button>
            )}
            <span className="truncate">{column.label}</span>
          </div>
        ))}
      </div>

      {Array.from(groupedIssues.entries()).map(([groupKey, issues]) => {
        const counts = showGroupCounts ? countBuckets(issues) : null;
        return (
          <div key={groupKey} className="mt-2 rounded-lg overflow-clip bg-white shadow-sm">
            {/* Group line: arrow, group name (total), then the Blocked and Aligned counts */}
            <div
              onClick={() => toggleGroupExpansion(groupKey)}
              className={`bg-gray-100 border-l-4 cursor-pointer hover:bg-gray-200 transition-colors sticky z-10 ${expandedGroups.has(groupKey) ? 'border-indigo-500' : 'border-gray-300'}`}
              style={{ top: HEADER_H }}
            >
              <div className="sticky left-0 flex items-center gap-3 px-3 py-[5px] w-max">
                <span className="text-gray-600 text-[11.5px] w-4">{expandedGroups.has(groupKey) ? '▼' : '▶'}</span>
                <span className="font-semibold text-gray-900 text-[13.4px] truncate" style={{ width: showGroupCounts ? 230 : undefined, maxWidth: 460 }} title={groupKey}>
                  {groupKey} <span className="font-normal text-gray-500">({issues.length})</span>
                </span>
                {counts && (<>{countPill('Blocked', counts.blocked, 'blocked')}{countPill('Aligned', counts.aligned, 'aligned')}</>)}
              </div>
            </div>

            {/* Rows */}
            {expandedGroups.has(groupKey) && issues.map((issue, index) => {
              const baseBg = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              const keyTint = rowBgColors.get(issue.key) || ''; // urgent (red) / attention (orange): only the Issue Key cell is coloured
              return (
                <div
                  key={issue.id}
                  className={`flex items-center border-b border-gray-100 hover:opacity-90 transition-colors ${baseBg}`}
                  style={{ minWidth: minTotal }}
                >
                  {visibleColumns.map((column) => (
                    <div
                      key={`${issue.id}-${column.key}`}
                      className={`px-2 py-[5.5px] border-r border-gray-100 last:border-r-0 text-[14px] leading-[22px] overflow-hidden whitespace-nowrap text-ellipsis ${column.key === 'key' ? keyTint : ''}`}
                      style={colStyle(column)}
                      title={cellTitle(issue, column)}
                    >
                      {column.filterable ? (
                        <button
                          onClick={() => onToggleFilterValue(column.key, String(issue[column.key] || ''))}
                          className="w-full text-left hover:underline hover:text-blue-600 block truncate"
                        >
                          {renderCell(issue, column)}
                        </button>
                      ) : (
                        renderCell(issue, column)
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default ListView;
