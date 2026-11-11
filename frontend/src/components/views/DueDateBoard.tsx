import React, { useMemo, useState } from 'react';
import { JiraIssue } from '../../types';
import { parseLocalDate } from '../../utils/dateUtils';
import { splitClients } from '../../services/dataProcessor';
import { bucketOf, BUCKET_PILL } from '../../utils/statusBuckets';
import { buildBoard, chipTone, ChipTone, DEFAULT_TONES } from '../../utils/dueBoard';

type DateType = 'dueDate' | 'releaseDate' | 'plannedUatDate';
const DATE_LABEL: Record<DateType, string> = { dueDate: 'Due date', releaseDate: 'Release date', plannedUatDate: 'UAT date' };

// Chip colors: the same buckets as the status pills in the list (Aligned orange, Blocked gray, Done green), and red when late
const CHIP: Record<ChipTone, string> = {
  overdue: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  done: BUCKET_PILL.done,
  blocked: BUCKET_PILL.blocked,
  aligned: BUCKET_PILL.aligned,
};
const LEGEND: { tone: ChipTone; label: string; hint: string }[] = [
  { tone: 'aligned', label: 'Aligned', hint: 'In progress and not blocked (To Do, Backlog, In Development, Code Review, ...)' },
  { tone: 'blocked', label: 'Blocked', hint: 'Status Blocked or Waiting (for Client, for Clarification)' },
  { tone: 'done', label: 'Done', hint: 'Ready for QA and everything after it' },
  { tone: 'overdue', label: 'Overdue', hint: 'The date is before today and the ticket is not done' },
];

const short = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dateOfIssue = (i: JiraIssue, type: DateType): Date | null => {
  const raw = type === 'releaseDate' ? (i.releaseDate !== 'NA' ? i.releaseDate : null) : i[type];
  return parseLocalDate(raw);
};

/**
 * Due-date board: the tickets of the current filters in four columns by the chosen date (due, release or UAT):
 * Overdue, This week, Next week and Later. The legend above is a set of filters on the date chip (Done is off when the board opens).
 * Click a card to see its details underneath.
 */
const DueDateBoard: React.FC<{ issues: JiraIssue[]; dateType?: DateType }> = ({ issues, dateType = 'dueDate' }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [tones, setTones] = useState<Set<ChipTone>>(new Set(DEFAULT_TONES));
  const today = useMemo(() => new Date(), []);
  const board = useMemo(() => buildBoard(issues, today, i => dateOfIssue(i, dateType), i => i.key), [issues, dateType, today]);
  const toneOf = (i: JiraIssue): ChipTone => chipTone(dateOfIssue(i, dateType)!, today, bucketOf(i));
  // how many tickets each chip color has (before the filter), shown on the legend so a switched-off color is not a mystery
  const toneCounts = useMemo(() => {
    const n: Record<ChipTone, number> = { aligned: 0, blocked: 0, done: 0, overdue: 0 };
    for (const c of board.columns) for (const i of c.items) n[chipTone(dateOfIssue(i, dateType)!, today, bucketOf(i))]++;
    return n;
  }, [board, dateType, today]);
  const columns = board.columns.map(c => ({ ...c, items: c.items.filter(i => tones.has(toneOf(i))) }));
  const toggleTone = (t: ChipTone) => setTones(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const chosen = selected ? issues.find(i => i.key === selected) || null : null;
  // the selected ticket can have no date of the kind chosen after switching (Due, Release, UAT), so its date is optional here
  const chosenDate = chosen ? dateOfIssue(chosen, dateType) : null;
  const total = columns.reduce((n, c) => n + c.items.length, 0);
  const label = DATE_LABEL[dateType];

  return (
    <div className="bg-gray-100 min-h-full p-4 flex flex-col gap-3">
      {/* Date chip filters: click a color to show or hide those tickets */}
      <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
        <span className="font-medium text-gray-700 mr-1">Date chip:</span>
        {LEGEND.map(l => {
          const on = tones.has(l.tone);
          return (
            <button
              key={l.tone}
              onClick={() => toggleTone(l.tone)}
              aria-pressed={on}
              title={`${l.hint}\n${on ? 'Click to hide' : 'Click to show'}`}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ring-1 transition-colors ${on ? 'bg-white ring-gray-300 text-gray-800' : 'bg-transparent ring-gray-200 text-gray-400 line-through'}`}
            >
              <span className={`inline-block w-3 h-3 rounded ${on ? CHIP[l.tone] : 'ring-1 ring-gray-300'}`} />
              {l.label} <span className="no-underline text-gray-500">{toneCounts[l.tone]}</span>
            </button>
          );
        })}
        <span className="ml-auto text-gray-500">By {label.toLowerCase()} · {total} ticket{total === 1 ? '' : 's'}</span>
      </div>

      {/* Columns */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-4 gap-4 min-w-[960px]">
          {columns.map(col => (
            <section key={col.id} className="min-w-0">
              <div className="flex items-center justify-between px-1 pb-2">
                <h3 title={col.id === 'overdue' ? 'Dated before today (a done ticket here is green: it is not late)' : undefined} className={`text-sm font-semibold ${col.id === 'overdue' && col.items.length ? 'text-red-700' : 'text-gray-700'}`}>{col.label}</h3>
                <span className="text-sm text-gray-500">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.length === 0 && <div className="text-xs text-gray-400 px-1 py-3">Nothing here</div>}
                {col.items.map(issue => {
                  const date = dateOfIssue(issue, dateType)!;
                  const tone = toneOf(issue);
                  const clients = splitClients(issue.client);
                  const isSel = selected === issue.key;
                  const pick = () => setSelected(isSel ? null : issue.key);
                  return (
                    // a div, not a button: the ticket number inside is a link, and a link cannot sit inside a button
                    <div
                      key={issue.id}
                      role="button"
                      tabIndex={0}
                      onClick={pick}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
                      aria-pressed={isSel}
                      title={`${issue.key}  ${issue.summary}`}
                      className={`w-full text-left bg-white rounded-lg shadow-sm px-3 py-2.5 border transition-colors cursor-pointer hover:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300 ${isSel ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200'}`}
                    >
                      <div className="text-[14px] leading-5 text-gray-800 line-clamp-2">
                        <a href={issue.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          title={`Open ${issue.key} in Jira`} className="font-semibold text-blue-700 hover:underline">{issue.key}</a> {issue.summary}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {clients.length === 0
                          ? <span className="px-2 py-0.5 rounded-full text-xs bg-gray-50 text-gray-400 ring-1 ring-gray-200">No client</span>
                          : clients.map(c => <span key={c} className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 ring-1 ring-gray-200">{c}</span>)}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-500" title={issue.assignee || 'Unassigned'}>{issue.assignee || 'Unassigned'}</span>
                        <span className="min-w-0 max-w-[50%] truncate px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700" title={issue.status}>{issue.status}</span>
                        <span className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${CHIP[tone]}`}>{short(date)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {board.noDate > 0 && <p className="text-xs text-gray-500">Not shown: {board.noDate} with no {label.toLowerCase()}.</p>}

      {/* Details of the selected card */}
      {chosen && (
        <div className="mt-1 bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3">
          <div className="text-[15px] text-gray-900">
            <a href={chosen.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">{chosen.key}</a>{' '}{chosen.summary}
          </div>
          <div className="mt-0.5 text-sm text-gray-600">
            {splitClients(chosen.client).join(', ') || 'No client'} · {chosen.assignee || 'Unassigned'} · {chosen.status} · {label} {chosenDate ? short(chosenDate) : 'not set'}
            {parseLocalDate(chosen.created) ? ` · created ${short(parseLocalDate(chosen.created)!)}` : ''}
          </div>
        </div>
      )}
    </div>
  );
};

export default DueDateBoard;
