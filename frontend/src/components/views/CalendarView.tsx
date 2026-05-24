import React, { useState } from 'react';
import { JiraIssue } from '../../types';
import { parseLocalDate } from '../../utils/dateUtils';

interface CalendarViewProps {
  issues: JiraIssue[];
  dateType?: 'dueDate' | 'releaseDate' | 'plannedUatDate';
}

const CalendarView: React.FC<CalendarViewProps> = ({ issues, dateType = 'dueDate' }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalIssues, setModalIssues] = useState<JiraIssue[]>([]);

  const toggleDateExpansion = (dateKey: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(dateKey)) {
      newExpanded.delete(dateKey);
    } else {
      newExpanded.add(dateKey);
    }
    setExpandedDates(newExpanded);
  };

  const openModal = (dateKey: string, issues: JiraIssue[]) => {
    setModalDate(dateKey);
    setModalIssues(issues);
  };

  const closeModal = () => {
    setModalDate(null);
    setModalIssues([]);
  };

  // Helper function to get issue background color based on urgency
  const getIssueBackgroundColor = (issue: JiraIssue): string => {
    // Don't highlight Done issues
    if (issue.statusCategory === 'Done') {
      return 'bg-gray-50';
    }
    
    // Don't highlight Ready for QA or In QA - show as normal
    if (issue.status === 'Ready for QA' || issue.status === 'In QA') {
      return 'bg-gray-50';
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
    
    return 'bg-gray-50';
  };

  // Get current month info
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  // Create calendar grid
  const calendarDays: (Date | null)[] = [];
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startDayOfWeek; i++) {
    calendarDays.push(null);
  }
  
  // Add days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(new Date(year, month, day));
  }

  // Group issues by date
  const issuesByDate = new Map<string, JiraIssue[]>();
  issues.forEach((issue) => {
    const dateValue = issue[dateType];
    let date: Date | null = null;
    
    // If the issue has a valid date, use it
    if (dateValue && dateValue !== 'NA') {
      date = parseLocalDate(dateValue);
    }
    
    // If no valid date, assign to 1st of current month
    if (!date) {
      date = new Date(year, month, 1);
    }
    
    if (date) {
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (!issuesByDate.has(dateKey)) {
        issuesByDate.set(dateKey, []);
      }
      issuesByDate.get(dateKey)!.push(issue);
    }
  });

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

  const getDateKey = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b">
        <h2 className="text-lg font-bold text-gray-800">
          {dateType === 'dueDate' ? 'Due Date' : dateType === 'plannedUatDate' ? 'UAT Date' : 'Release Date'}: {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="text-center font-semibold text-gray-600 text-sm py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2 flex-1 overflow-auto">
        {calendarDays.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="bg-gray-50 rounded-lg" />;
          }

          const dateKey = getDateKey(date);
          const dayIssues = issuesByDate.get(dateKey) || [];
          const isCurrentDay = isToday(date);
          const isExpanded = expandedDates.has(dateKey);
          const displayLimit = isExpanded ? dayIssues.length : 2;

          return (
            <div
              key={dateKey}
              className={`border rounded-lg p-2 min-h-[120px] ${
                isCurrentDay
                  ? 'bg-blue-50 border-blue-400 border-2'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div
                className={`text-sm font-semibold mb-1 cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1 ${
                  isCurrentDay ? 'text-blue-700' : 'text-gray-600'
                }`}
                onClick={() => dayIssues.length > 0 && openModal(dateKey, dayIssues)}
              >
                {date.getDate()}
                {dayIssues.length > 0 && (
                  <span className="ml-1 text-xs bg-gray-200 px-1.5 py-0.5 rounded-full">
                    {dayIssues.length}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayIssues.slice(0, displayLimit).map((issue) => {
                  return (
                    <a
                      key={issue.id}
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block text-[10px] leading-tight p-1 rounded border ${getIssueBackgroundColor(issue)} border-gray-300 hover:shadow-md transition-shadow`}
                      title={`${issue.key}: ${issue.summary}\nStatus: ${issue.status}\nType: ${issue.issueType}\nClient: ${issue.client || 'None'}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="font-semibold truncate">{issue.key}</div>
                      <div className="truncate text-gray-600 line-clamp-2">{issue.summary}</div>
                    </a>
                  );
                })}
                {dayIssues.length > displayLimit && (
                  <button
                    onClick={() => toggleDateExpansion(dateKey)}
                    className="w-full text-[10px] text-blue-600 hover:text-blue-800 font-medium text-center py-1"
                  >
                    +{dayIssues.length - displayLimit} more
                  </button>
                )}
                {dayIssues.length > 2 && isExpanded && (
                  <button
                    onClick={() => toggleDateExpansion(dateKey)}
                    className="w-full text-[10px] text-gray-600 hover:text-gray-800 font-medium text-center py-1"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t flex gap-4 justify-center text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded"></div>
          <span>To Do</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded"></div>
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
          <span>Done</span>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-2 text-center text-sm text-gray-600">
        {issues.length} issues displayed (items without dates shown on 1st)
      </div>

      {/* Modal for showing all issues on a date */}
      {modalDate && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b">
              <h2 className="text-xl font-bold text-gray-800">
                Issues on {modalDate} ({modalIssues.length})
              </h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="overflow-y-auto flex-1 p-6">
              <div className="space-y-3">
                {modalIssues.map((issue) => {
                  return (
                    <a
                      key={issue.id}
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block p-3 rounded-lg border ${getIssueBackgroundColor(issue)} border-gray-300 hover:shadow-lg transition-all`}
                    >
                      {/* Line 1: Ticket, Status, Type, Assignee, Due Date, Release Date */}
                      <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
                        <span className="font-bold text-blue-600">{issue.key}</span>
                        <span className="bg-blue-100 px-2 py-0.5 rounded">{issue.status}</span>
                        <span className="bg-gray-200 px-2 py-0.5 rounded">{issue.issueType}</span>
                        {issue.assignee && (
                          <span className="text-gray-700">👤 {issue.assignee}</span>
                        )}
                        {issue.dueDate && parseLocalDate(issue.dueDate) && (
                          <span className="text-orange-600">📅 {parseLocalDate(issue.dueDate)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                        {issue.releaseDate && issue.releaseDate !== 'NA' && parseLocalDate(issue.releaseDate) && (
                          <span className="text-green-600">🚀 {parseLocalDate(issue.releaseDate)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                        {issue.plannedUatDate && parseLocalDate(issue.plannedUatDate) && (
                          <span className="text-purple-600">🧪 {parseLocalDate(issue.plannedUatDate)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                      {/* Line 2: Summary */}
                      <div className="text-sm text-gray-800">{issue.summary}</div>
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t bg-gray-50 text-center text-sm text-gray-600">
              Click on any issue to open in Jira
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
