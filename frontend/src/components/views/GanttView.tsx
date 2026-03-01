import React, { useState } from 'react';
import { JiraIssue } from '../../types';

interface GanttViewProps {
  issues: JiraIssue[];
  dateType?: 'dueDate' | 'releaseDate';
}

const GanttView: React.FC<GanttViewProps> = ({ issues, dateType = 'releaseDate' }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  // Filter issues that have sprint start date (for alignment)
  const issuesWithDates = issues.filter((issue) => {
    return issue.sprintStartDate;
  });

  // Helper function to get issue background color based on urgency
  const getIssueBackgroundColor = (issue: JiraIssue): string => {
    // Don't highlight Done issues
    if (issue.statusCategory === 'Done') {
      return 'bg-gray-300';
    }
    
    // Don't highlight Ready for QA or In QA - show as normal
    if (issue.status === 'Ready for QA' || issue.status === 'In QA') {
      return 'bg-gray-400';
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const threeDays = new Date(today);
    threeDays.setDate(threeDays.getDate() + 3);
    
    const dueDate = issue.dueDate ? new Date(issue.dueDate) : null;
    const releaseDate = issue.releaseDate && issue.releaseDate !== 'NA' ? new Date(issue.releaseDate) : null;
    
    // Red background for urgent (due/release <= today + 1)
    if ((dueDate && dueDate <= tomorrow) || (releaseDate && releaseDate <= tomorrow)) {
      return 'bg-red-400';
    }
    
    // Orange background for attention (due/release <= today + 3)
    if ((dueDate && dueDate <= threeDays) || (releaseDate && releaseDate <= threeDays)) {
      return 'bg-orange-400';
    }
    
    // Default gray for all other tasks
    return 'bg-gray-400';
  };

  // Get the date range for Gantt chart
  const getDateRange = () => {
    if (issuesWithDates.length === 0) {
      // Default to current month
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      return { minDate: startOfMonth, maxDate: endOfMonth };
    }

    let minDate = new Date();
    let maxDate = new Date();

    issuesWithDates.forEach((issue) => {
      const startDate = new Date(issue.sprintStartDate!);
      const endDateValue = issue[dateType];
      const endDate = endDateValue && endDateValue !== 'NA' ? new Date(endDateValue) : startDate;

      if (startDate < minDate) minDate = startDate;
      if (endDate > maxDate) maxDate = endDate;
    });

    // Don't add padding before sprint start (keep Monday as start)
    // Only add padding to the end for better visualization
    maxDate.setDate(maxDate.getDate() + 2);

    return { minDate, maxDate };
  };

  const { minDate, maxDate } = getDateRange();
  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

  // Generate date labels for the header
  const generateDateLabels = () => {
    const labels: Date[] = [];
    const currentLabel = new Date(minDate);
    
    while (currentLabel <= maxDate) {
      labels.push(new Date(currentLabel));
      currentLabel.setDate(currentLabel.getDate() + 1);
    }
    
    return labels;
  };

  const dateLabels = generateDateLabels();

  // Calculate bar position and width for an issue
  const calculateBarPosition = (issue: JiraIssue) => {
    const startDate = new Date(issue.sprintStartDate!);
    const endDateValue = issue[dateType];
    // If no end date or end date is 'NA', use start date as end date (1 day bar)
    const endDate = endDateValue && endDateValue !== 'NA' ? new Date(endDateValue) : startDate;

    const startOffset = Math.floor((startDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
    // Always show at least 1 day width, even if start and end are the same
    const duration = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      left: `${(startOffset / totalDays) * 100}%`,
      width: `${(duration / totalDays) * 100}%`,
    };
  };

  const toggleIssueExpansion = (issueKey: string) => {
    const newExpanded = new Set(expandedIssues);
    if (newExpanded.has(issueKey)) {
      newExpanded.delete(issueKey);
    } else {
      newExpanded.add(issueKey);
    }
    setExpandedIssues(newExpanded);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const isToday = (date: Date): boolean => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  return (
    <div className="h-full flex flex-col bg-white p-4">
      {/* Gantt Header */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b">
        <h2 className="text-lg font-bold text-gray-800">
          Gantt Chart - {dateType === 'dueDate' ? 'Due Date' : 'Release Date'}: {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => navigateMonth('prev')}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
          >
            ← Previous
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
          >
            Today
          </button>
          <button
            onClick={() => navigateMonth('next')}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Gantt Chart */}
      <div className="flex-1 overflow-auto">
        {issuesWithDates.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            No issues with sprint dates found.
          </div>
        ) : (
          <div className="min-w-full">
            {/* Date Header */}
            <div className="sticky top-0 bg-white z-10 border-b-2 border-gray-300">
              <div className="flex">
                {/* Left section for issue keys */}
                <div className="w-48 flex-shrink-0 border-r-2 border-gray-300 bg-gray-50 p-2 font-semibold text-gray-700">
                  Issue
                </div>
                {/* Date labels */}
                <div className="flex-1 flex">
                  {dateLabels.map((date, index) => {
                    const isCurrentDay = isToday(date);
                    return (
                      <div
                        key={index}
                        className={`flex-1 text-center text-xs p-2 border-r border-gray-200 ${
                          isCurrentDay ? 'bg-blue-100 font-bold' : ''
                        }`}
                        style={{ minWidth: '40px' }}
                      >
                        <div>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                        <div className="text-gray-500">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Gantt Rows */}
            <div>
              {issuesWithDates.map((issue) => {
                const barPosition = calculateBarPosition(issue);
                const isExpanded = expandedIssues.has(issue.key);

                return (
                  <div key={issue.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <div className="flex">
                      {/* Issue Key */}
                      <div className="w-48 flex-shrink-0 border-r border-gray-200 p-2">
                        <div className="flex flex-col gap-1">
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-blue-600 hover:text-blue-800 truncate"
                            title={issue.summary}
                          >
                            {issue.key}
                          </a>
                          {isExpanded && (
                            <div className="text-xs text-gray-600">
                              <div className="truncate" title={issue.summary}>{issue.summary}</div>
                              <div className="mt-1">
                                <span className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">{issue.status}</span>
                              </div>
                              {issue.assignee && (
                                <div className="mt-1 text-gray-700">👤 {issue.assignee}</div>
                              )}
                            </div>
                          )}
                          <button
                            onClick={() => toggleIssueExpansion(issue.key)}
                            className="text-xs text-gray-500 hover:text-gray-700 text-left"
                          >
                            {isExpanded ? '▼ Less' : '▶ More'}
                          </button>
                        </div>
                      </div>

                      {/* Gantt Bar */}
                      <div className="flex-1 relative p-2" style={{ minHeight: '60px' }}>
                        {/* Vertical today line */}
                        {(() => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          if (today >= minDate && today <= maxDate) {
                            const todayOffset = Math.floor((today.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
                            const todayPosition = `${(todayOffset / totalDays) * 100}%`;
                            return (
                              <div
                                className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10"
                                style={{ left: todayPosition }}
                              />
                            );
                          }
                          return null;
                        })()}

                        {/* Task bar */}
                        <div
                          className={`absolute ${getIssueBackgroundColor(issue)} rounded px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity overflow-hidden`}
                          style={{
                            left: barPosition.left,
                            width: barPosition.width,
                            top: '8px',
                            height: isExpanded ? 'auto' : '40px',
                            minHeight: '40px',
                          }}
                          onClick={() => toggleIssueExpansion(issue.key)}
                          title={`${issue.key}: ${issue.summary}\nSprint Start: ${new Date(issue.sprintStartDate!).toLocaleDateString()}\n${dateType === 'dueDate' ? 'Due' : 'Release'}: ${issue[dateType] && issue[dateType] !== 'NA' ? new Date(issue[dateType]!).toLocaleDateString() : 'Not set'}\n\nDescription: ${issue.description || 'No description'}`}
                        >
                          <div className="text-xs font-semibold text-white truncate">
                            {issue.key}
                          </div>
                          <div className="text-[10px] text-white truncate opacity-90">
                            {issue.summary}
                          </div>
                          {isExpanded && issue.description && (
                            <div className="text-[10px] text-white mt-1 opacity-80 line-clamp-3">
                              {issue.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t flex gap-4 justify-center text-sm flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-400 rounded"></div>
          <span>Normal</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-400 rounded"></div>
          <span>Attention (≤ 3 days)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-400 rounded"></div>
          <span>Urgent (≤ 1 day)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-blue-500"></div>
          <span>Today</span>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-2 text-center text-sm text-gray-600">
        {issuesWithDates.length} issues from sprint start to {dateType === 'dueDate' ? 'due date' : 'release date'}
      </div>
    </div>
  );
};

export default GanttView;
