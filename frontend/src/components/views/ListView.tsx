import React, { useState } from 'react';
import { JiraIssue, Column, SortConfig } from '../../types';
import { jiraApi } from '../../services/api';
import { parseLocalDate } from '../../utils/dateUtils';

interface ListViewProps {
  groupedIssues: Map<string, JiraIssue[]>;
  visibleColumns: Column[];
  sortConfig: SortConfig;
  onSort: (column: keyof JiraIssue) => void;
  onToggleFilterValue: (column: string, value: string) => void;
  feTeamMembers: string[];
  onToggleFETeam: (assignee: string) => void;
}

const ListView: React.FC<ListViewProps> = ({
  groupedIssues,
  visibleColumns,
  sortConfig,
  onSort,
  onToggleFilterValue,
  feTeamMembers,
  onToggleFETeam,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set([...groupedIssues.keys()].slice(0, 1))
  );

  const toggleGroupExpansion = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey);
    } else {
      newExpanded.add(groupKey);
    }
    setExpandedGroups(newExpanded);
  };

  // Helper function to get row background color
  const getRowBackgroundColor = (issue: JiraIssue): string => {
    // Don't highlight Done issues
    if (issue.statusCategory === 'Done') {
      return '';
    }
    
    // Don't highlight Ready for QA or In QA - show as normal
    if (issue.status === 'Ready for QA' || issue.status === 'In QA') {
      return '';
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const threeDays = new Date(today);
    threeDays.setDate(threeDays.getDate() + 3);
    
    const dueDate = parseLocalDate(issue.dueDate);
    const releaseDate = issue.releaseDate !== 'NA' ? parseLocalDate(issue.releaseDate) : null;
    
    // Red background for urgent (due/release <= today + 1)
    if ((dueDate && dueDate <= tomorrow) || (releaseDate && releaseDate <= tomorrow)) {
      return 'bg-red-100';
    }
    
    // Orange background for attention (due/release <= today + 3)
    if ((dueDate && dueDate <= threeDays) || (releaseDate && releaseDate <= threeDays)) {
      return 'bg-orange-100';
    }
    
    return '';
  };

  const formatCellValue = (value: any, columnType: string): string => {
    if (value == null) return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (columnType === 'date' && value) {
      const date = parseLocalDate(value);
      if (!date) return '—';
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
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

  const getStatusColor = (statusCategory: string): string => {
    const statusMap: { [key: string]: string } = {
      todo: 'bg-gray-100 text-gray-800',
      inprogress: 'bg-blue-100 text-blue-800',
      done: 'bg-green-100 text-green-800',
      'in-progress': 'bg-blue-100 text-blue-800',
    };
    return statusMap[statusCategory.toLowerCase()] || 'bg-gray-100 text-gray-800';
  };

  const [importantStates, setImportantStates] = React.useState<Record<string, boolean>>({});

  const renderCell = (issue: JiraIssue, column: Column) => {
    const value = issue[column.key];

    // Special handling for important star
    if (column.key === 'important') {
      const isImportant = importantStates[issue.key] ?? Boolean(issue.important);
      
      return (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const newValue = !isImportant;
            setImportantStates(prev => ({ ...prev, [issue.key]: newValue }));
            issue.important = newValue;
            await jiraApi.setIssueImportant(issue.key, newValue);
          }}
          className="text-2xl cursor-pointer hover:scale-110 transition-transform"
          title={isImportant ? "Remove from important" : "Mark as important"}
        >
          {isImportant ? '⭐' : '☆'}
        </button>
      );
    }

    // Special handling for issue key - make it a link to Jira
    if (column.key === 'key') {
      return (
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 font-semibold hover:underline text-sm"
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
          className="w-full text-left hover:bg-purple-50 rounded p-1 transition-colors"
          title={isFETeam ? "Click to remove from FE Team" : "Click to add to FE Team"}
        >
          <div className="flex flex-col gap-1">
            <span className="text-sm text-gray-700">{formatCellValue(value, column.type)}</span>
            {isFETeam && (
              <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-xs font-medium inline-block w-fit">
                👥 FE Team
              </span>
            )}
          </div>
        </button>
      );
    }

    // Special handling for client - display as simple gray badges
    if (column.key === 'client' && value) {
      const clients = String(value).split(',').map(c => c.trim());
      return (
        <div className="flex flex-wrap gap-1">
          {clients.map((client, i) => (
            <span
              key={i}
              className="bg-gray-100 px-2 py-1 rounded text-xs font-medium"
            >
              {client}
            </span>
          ))}
        </div>
      );
    }

    // Special handling for time tracking columns - display in hours
    if (column.key === 'timeSpent' || column.key === 'originalEstimate') {
      return <span className="text-sm text-gray-700">{formatTimeValue(Number(value) || 0)}</span>;
    }

    switch (column.type) {
      case 'status':
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(issue.statusCategory)}`}>
            {formatCellValue(value, column.type)}
          </span>
        );

      case 'date':
        return <span className="text-sm text-gray-700">{formatCellValue(value, column.type)}</span>;

      case 'url':
        return (
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline text-sm"
          >
            {formatCellValue(value, column.type)}
          </a>
        );

      case 'array':
        // Default array rendering
        return (
          <div className="flex flex-wrap gap-1">
            {Array.isArray(value) &&
              value.map((v, i) => (
                <span key={i} className="bg-gray-200 text-gray-800 px-2 py-1 rounded text-xs">
                  {v}
                </span>
              ))}
          </div>
        );

      default:
        return <span className="text-sm text-gray-700">{formatCellValue(value, column.type)}</span>;
    }
  };

  return (
    <div className="bg-white">
      {Array.from(groupedIssues.entries()).map(([groupKey, issues]) => (
        <div key={groupKey} className="border-b border-gray-200">
          {/* Group Header */}
          <div
            onClick={() => toggleGroupExpansion(groupKey)}
            className="bg-gray-50 px-6 py-1.5 cursor-pointer hover:bg-gray-100 transition-colors flex items-center gap-3 sticky top-0 z-10"
          >
            <span className="text-gray-400 text-sm">
              {expandedGroups.has(groupKey) ? '▼' : '▶'}
            </span>
            <span className="font-semibold text-gray-700 text-sm">
              {groupKey} ({issues.length})
            </span>
          </div>

          {/* Group Items */}
          {expandedGroups.has(groupKey) && (
            <div>
              {/* Table Header */}
              <div className="flex bg-gray-800 border-b-2 border-gray-900 sticky top-0 z-20 shadow-md" style={{ minWidth: 'max-content' }}>
                {visibleColumns.map((column) => (
                  <div
                    key={column.key}
                    className="px-4 py-1.5 text-left text-sm font-bold text-white border-r border-gray-700 last:border-r-0"
                    style={{ width: column.width || '150px', minWidth: column.width || '150px', maxWidth: column.width || '150px', flexShrink: 0 }}
                  >
                    <div className="flex items-center gap-2">
                      {column.sortable && (
                        <button
                          onClick={() => onSort(column.key)}
                          className="text-gray-300 hover:text-white font-bold"
                          title={`Sort by ${column.label}`}
                        >
                          {sortConfig.column === column.key ? (
                            sortConfig.direction === 'asc' ? '↑' : '↓'
                          ) : (
                            '⇅'
                          )}
                        </button>
                      )}
                      <span>{column.label}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Table Rows */}
              {issues.map((issue, index) => {
                const rowBgColor = getRowBackgroundColor(issue);
                const baseBg = rowBgColor || (index % 2 === 0 ? 'bg-white' : 'bg-gray-50');
                return (
                  <div
                    key={issue.id}
                    className={`flex border-b border-gray-100 hover:opacity-90 transition-colors ${baseBg}`}
                    style={{ minWidth: 'max-content' }}
                  >
                    {visibleColumns.map((column) => (
                      <div
                        key={`${issue.id}-${column.key}`}
                        className="px-4 py-3 border-r border-gray-100 last:border-r-0 text-sm"
                        style={{ 
                          width: column.width || '150px',
                          minWidth: column.width || '150px',
                          maxWidth: column.width || '150px',
                          flexShrink: 0,
                          ...(column.key === 'summary' ? { 
                            whiteSpace: 'normal', 
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word'
                          } : {})
                        }}
                      >
                        {column.filterable ? (
                          <button
                            onClick={() =>
                              onToggleFilterValue(column.key, String(issue[column.key] || ''))
                            }
                            className="w-full text-left hover:underline hover:text-blue-600"
                            title={`Filter by ${String(issue[column.key])}`}
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
          )}
        </div>
      ))}
    </div>
  );
};

export default ListView;
