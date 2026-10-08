import React, { useEffect, useMemo, useState } from 'react';
import { JiraIssue } from '../types';
import { mergeIssueSources, groupIssuesByField, QuickGroupField, splitClients } from '../services/dataProcessor';
import { parseLocalDate, formatDate } from '../utils/dateUtils';

const GROUP_BY_LABELS: Record<QuickGroupField, string> = {
  client: 'Client',
  status: 'Status',
  issueType: 'Type',
  assignee: 'Assignee',
  none: 'None',
};

type FilterKey = 'fe' | 'unassigned';
const FILTER_LABELS: Record<FilterKey, string> = {
  fe: 'FE (Component)',
  unassigned: 'Unassigned',
};

const isFEComponent = (issue: JiraIssue): boolean =>
  issue.components.some(c => c.toLowerCase().includes('fe'));

interface QuickAnalysisTrackerProps {
  sprintIssues: JiraIssue[];
  myIssues: JiraIssue[];
  sprintLoading: boolean;
  myLoading: boolean;
  onRefreshSprint: () => void;
  onRefreshMe: () => void;
}

const BLOCKED_RE = /block|hold|wait|impediment/i;

const isBlockedOrWaiting = (issue: JiraIssue): boolean =>
  issue.statusCategory !== 'Done' && BLOCKED_RE.test(issue.status);

interface Section {
  id: string;
  icon: string;
  title: string;
  hint: string;
  issues: JiraIssue[];
  // When set, issues within a client group are further split into these labeled buckets (e.g. by status)
  subGroupBy?: (issue: JiraIssue) => string;
}

const QuickAnalysisTracker: React.FC<QuickAnalysisTrackerProps> = ({
  sprintIssues, myIssues, sprintLoading, myLoading, onRefreshSprint, onRefreshMe,
}) => {
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(['fe', 'unassigned']));
  const [filterOpen, setFilterOpen] = useState(false);
  const [groupByField, setGroupByField] = useState<QuickGroupField>('client');
  const [groupByOpen, setGroupByOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['overdue', 'atrisk', 'multirelease', 'unassigned', 'blocked'])
  );
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());

  // Close dropdowns on outside click
  useEffect(() => {
    if (!groupByOpen && !filterOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.qa-groupby-dropdown')) setGroupByOpen(false);
      if (!target.closest('.qa-filter-dropdown')) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupByOpen, filterOpen]);

  const toggleFilter = (key: FilterKey) =>
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const mergedIssues = useMemo(() => mergeIssueSources(sprintIssues, myIssues), [sprintIssues, myIssues]);

  // Scope: matches ANY selected filter (FE = component contains "FE", Unassigned = no assignee).
  // No filters selected = everything. Done tickets are excluded everywhere — this dashboard is
  // about active/open concerns only.
  const scopedIssues = useMemo(() => {
    const base = mergedIssues.filter(i => i.statusCategory !== 'Done');
    if (activeFilters.size === 0) return base;
    return base.filter(i =>
      (activeFilters.has('fe') && isFEComponent(i)) ||
      (activeFilters.has('unassigned') && !i.assignee)
    );
  }, [mergedIssues, activeFilters]);

  const sections = useMemo<Section[]>(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in3Days = new Date(today); in3Days.setDate(today.getDate() + 3);

    const releaseOf = (i: JiraIssue) => (i.releaseDate && i.releaseDate !== 'NA' ? parseLocalDate(i.releaseDate) : null);

    const overdue = scopedIssues.filter(i => {
      const rel = releaseOf(i);
      return rel !== null && rel <= today;
    });

    const atRisk = scopedIssues.filter(i => {
      const rel = releaseOf(i);
      if (rel === null || rel <= today || rel > in3Days) return false;
      return i.statusCategory === 'To Do' || isBlockedOrWaiting(i);
    });

    // Clients with multiple distinct release dates within the same sprint
    const clientSprintReleases = new Map<string, Set<string>>();
    const clientSprintIssues = new Map<string, JiraIssue[]>();
    scopedIssues.forEach(i => {
      const rel = i.releaseDate && i.releaseDate !== 'NA' ? i.releaseDate : null;
      if (!rel || !i.sprint) return;
      const clients = splitClients(i.client);
      (clients.length > 0 ? clients : ['No Client']).forEach(client => {
        const key = `${client}::${i.sprint}`;
        if (!clientSprintReleases.has(key)) clientSprintReleases.set(key, new Set());
        clientSprintReleases.get(key)!.add(rel);
        if (!clientSprintIssues.has(key)) clientSprintIssues.set(key, []);
        clientSprintIssues.get(key)!.push(i);
      });
    });
    const multiReleaseKeys = new Set(
      [...clientSprintReleases.entries()].filter(([, dates]) => dates.size > 1).map(([key]) => key)
    );
    const multiRelease = [...multiReleaseKeys].flatMap(key => clientSprintIssues.get(key) || []);
    // Dedup (an issue could theoretically appear once per matching client/sprint combo already)
    const multiReleaseUnique = Array.from(new Map(multiRelease.map(i => [i.key, i])).values());

    const unassigned = scopedIssues.filter(i => !i.assignee);

    const blocked = scopedIssues.filter(isBlockedOrWaiting);

    return [
      {
        id: 'overdue',
        icon: '🔴',
        title: 'Releasing Today or Overdue — Not Done',
        hint: 'Release date is today or in the past, and the ticket is not yet Done.',
        issues: overdue,
        subGroupBy: (i: JiraIssue) => i.status,
      },
      {
        id: 'atrisk',
        icon: '⚠️',
        title: 'Releasing in Next 3 Days — Not On Track',
        hint: 'Release date is within 3 days, but the ticket is still To Do or blocked/waiting.',
        issues: atRisk,
      },
      {
        id: 'multirelease',
        icon: '🧭',
        title: 'Clients With Multiple Releases in Same Sprint',
        hint: 'Same client, same sprint, but more than one distinct release date — worth aligning.',
        issues: multiReleaseUnique,
      },
      {
        id: 'unassigned',
        icon: '❓',
        title: 'Unassigned',
        hint: 'No assignee set.',
        issues: unassigned,
      },
      {
        id: 'blocked',
        icon: '🚧',
        title: 'General Sprint Concerns — Blocked / Waiting',
        hint: 'Status indicates the ticket is blocked, on hold, or waiting on something.',
        issues: blocked,
      },
    ];
  }, [scopedIssues]);

  const toggleSection = (id: string) =>
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleClient = (key: string) =>
    setExpandedClients(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const isRefreshing = sprintLoading || myLoading;

  return (
    <div className="h-full flex flex-col bg-gray-50 relative overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center gap-3 flex-wrap">
        <span className="text-lg font-semibold text-gray-800">🔍 Quick Analysis</span>

        {/* Filter dropdown — multi-select, removable */}
        <div className="relative qa-filter-dropdown">
          <button onClick={() => setFilterOpen(o => !o)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-100 text-purple-800 hover:bg-purple-200">
            <span>👥 Filter: {activeFilters.size > 0 ? [...activeFilters].map(f => FILTER_LABELS[f]).join(' + ') : 'All (unrestricted)'}</span>
            {activeFilters.size > 0 && (
              <span onClick={(e) => { e.stopPropagation(); setActiveFilters(new Set()); }}
                title="Remove filters" className="hover:text-purple-600 ml-1">✕</span>
            )}
          </button>
          {filterOpen && (
            <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg py-1 min-w-[180px]">
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map(key => (
                <label key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-100">
                  <input type="checkbox" checked={activeFilters.has(key)} onChange={() => toggleFilter(key)} className="w-4 h-4" />
                  <span className={activeFilters.has(key) ? 'font-semibold text-purple-700' : 'text-gray-700'}>{FILTER_LABELS[key]}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Group By dropdown */}
        <div className="relative qa-groupby-dropdown">
          <button onClick={() => setGroupByOpen(o => !o)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200">
            <span>Group By: {GROUP_BY_LABELS[groupByField]}</span>
            {groupByField !== 'none' && (
              <span onClick={(e) => { e.stopPropagation(); setGroupByField('none'); }}
                title="Remove grouping" className="hover:text-indigo-600 ml-1">✕</span>
            )}
          </button>
          {groupByOpen && (
            <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg py-1 min-w-[140px]">
              {(Object.keys(GROUP_BY_LABELS) as QuickGroupField[]).map(field => (
                <div key={field}
                  onClick={() => { setGroupByField(field); setGroupByOpen(false); }}
                  className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-100 ${groupByField === field ? 'font-semibold text-indigo-700' : 'text-gray-700'}`}>
                  {GROUP_BY_LABELS[field]}
                </div>
              ))}
            </div>
          )}
        </div>

        <span className="text-sm text-gray-500">{scopedIssues.length} issues in scope</span>
        <button
          onClick={() => { onRefreshSprint(); onRefreshMe(); }}
          className="ml-auto px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
        >
          🔄 Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 relative">
        {isRefreshing && (
          <div className="absolute inset-0 z-20 bg-gray-50/70 flex items-start justify-center pt-10">
            <span className="text-sm text-gray-500">Refreshing…</span>
          </div>
        )}

        {sections.map(section => {
          const grouped = groupIssuesByField(section.issues, groupByField);
          const sectionExpanded = expandedSections.has(section.id);
          return (
            <div key={section.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
              >
                <span className="text-gray-400">{sectionExpanded ? '▼' : '▶'}</span>
                <span className="text-xl">{section.icon}</span>
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">{section.title}</div>
                  <div className="text-xs text-gray-500">{section.hint}</div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-sm font-bold ${
                  section.issues.length === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {section.issues.length}
                </span>
              </button>

              {sectionExpanded && (
                section.issues.length === 0 ? (
                  <div className="px-6 pb-4 text-sm text-gray-400">Nothing here — all clear ✅</div>
                ) : (
                  <div className="border-t border-gray-100">
                    {[...grouped.entries()].map(([client, issues]) => {
                      const clientKey = `${section.id}::${client}`;
                      const clientExpanded = expandedClients.has(clientKey);
                      return (
                        <div key={clientKey} className="border-b border-gray-100 last:border-b-0">
                          <button
                            onClick={() => toggleClient(clientKey)}
                            className="w-full flex items-center gap-2 px-6 py-2 bg-gray-50 hover:bg-gray-100 text-left"
                          >
                            <span className="text-gray-400 text-xs">{clientExpanded ? '▼' : '▶'}</span>
                            <span className="font-medium text-gray-700 text-sm">{client}</span>
                            <span className="text-xs text-gray-500">({issues.length})</span>
                          </button>
                          {clientExpanded && (
                            <IssueRows issues={issues} subGroupBy={groupByField === 'status' ? undefined : section.subGroupBy} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const statusColor = (statusCategory: string): string => {
  const map: Record<string, string> = {
    'To Do': 'bg-gray-100 text-gray-800',
    'In Progress': 'bg-blue-100 text-blue-800',
    'Done': 'bg-green-100 text-green-800',
  };
  return map[statusCategory] || 'bg-gray-100 text-gray-800';
};

const IssueRow: React.FC<{ issue: JiraIssue }> = ({ issue }) => (
  <div className="flex items-center gap-3 px-8 py-1.5 text-sm border-b border-gray-50 last:border-b-0 hover:bg-gray-50">
    <a href={issue.url} target="_blank" rel="noopener noreferrer"
      className="text-blue-600 hover:underline font-medium w-24 shrink-0">{issue.key}</a>
    <span className="flex-1 truncate text-gray-700" title={issue.summary}>{issue.summary}</span>
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusColor(issue.statusCategory)}`}>
      {issue.status}
    </span>
    <span className="text-gray-500 text-xs w-28 shrink-0 truncate">{issue.assignee || 'Unassigned'}</span>
    <span className="text-gray-500 text-xs w-32 shrink-0 truncate" title={issue.components.join(', ')}>
      {issue.components.length > 0 ? issue.components.join(', ') : '—'}
    </span>
    <span className="text-gray-500 text-xs w-24 shrink-0">
      {issue.releaseDate && issue.releaseDate !== 'NA' ? formatDate(issue.releaseDate) : '—'}
    </span>
  </div>
);

const IssueRows: React.FC<{ issues: JiraIssue[]; subGroupBy?: (issue: JiraIssue) => string }> = ({ issues, subGroupBy }) => {
  if (!subGroupBy) {
    return <div>{issues.map(i => <IssueRow key={i.key} issue={i} />)}</div>;
  }
  const groups = new Map<string, JiraIssue[]>();
  issues.forEach(i => {
    const key = subGroupBy(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });
  return (
    <div>
      {[...groups.entries()].map(([label, groupIssues]) => (
        <div key={label}>
          <div className="px-8 py-1 text-xs font-semibold text-gray-500 bg-white">{label} ({groupIssues.length})</div>
          {groupIssues.map(i => <IssueRow key={i.key} issue={i} />)}
        </div>
      ))}
    </div>
  );
};

export default QuickAnalysisTracker;
