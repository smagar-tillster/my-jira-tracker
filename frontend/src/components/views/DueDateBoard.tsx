import React, { useMemo, useState } from 'react';
import { JiraIssue } from '../../types';
import { parseLocalDate } from '../../utils/dateUtils';
import { splitClients } from '../../services/dataProcessor';
import { bucketOf, BUCKET_PILL } from '../../utils/statusBuckets';
import { buildBoard, chipTone, ChipTone } from '../../utils/dueBoard';

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
 * Overdue, This week, Next week and Later. Click a card to see its details underneath.
 */
const DueDateBoard: React.FC<{ issues: JiraIssue[]; dateType?: DateType }> = ({ issues, dateType = 'dueDate' }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);
  const board = useMemo(
    () => buildBoard(issues, today, i => dateOfIssue(i, dateType), i => bucketOf(i) === 'done', i => i.key),
    [issues, dateType, today],
  );
  const chosen = selected ? issues.find(i => i.key === selected) || null : null;
  // the selected ticket can have no date of the kind chosen after switching (Due, Release, UAT), so its date is optional here
  const chosenDate = chosen ? dateOfIssue(chosen, dateType) : null;
  const total = board.columns.reduce((n, c) => n + c.items.length, 0);
  const label = DATE_LABEL[dateType];

  return (
    <div className="bg-gray-100 min-h-full p-4 flex flex-col gap-3">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
        <span className="font-medium text-gray-700">Date chip:</span>
        {LEGEND.map(l => (
          <span key={l.tone} title={l.hint} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded ${CHIP[l.tone]}`} />{l.label}
          </span>
        ))}
        <span className="ml-auto text-gray-500">By {label.toLowerCase()} · {total} ticket{total === 1 ? '' : 's'}</span>
      </div>

      {/* Columns */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-4 gap-4 min-w-[960px]">
          {board.columns.map(col => (
            <section key={col.id} className="min-w-0">
              <div className="flex items-center justify-between px-1 pb-2">
                <h3 className={`text-sm font-semibold ${col.id === 'overdue' && col.items.length ? 'text-red-700' : 'text-gray-700'}`}>{col.label}</h3>
                <span className="text-sm text-gray-500">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.length === 0 && <div className="text-xs text-gray-400 px-1 py-3">Nothing here</div>}
                {col.items.map(issue => {
                  const date = dateOfIssue(issue, dateType)!;
                  const tone = chipTone(date, today, bucketOf(issue));
                  const clients = splitClients(issue.client).join(', ') || 'No client';
                  const isSel = selected === issue.key;
                  return (
                    <button
                      key={issue.id}
                      onClick={() => setSelected(isSel ? null : issue.key)}
                      aria-pressed={isSel}
                      title={`${issue.key}  ${issue.summary}\n${issue.status}`}
                      className={`w-full text-left bg-white rounded-lg shadow-sm px-3 py-2.5 border transition-colors hover:border-blue-300 ${isSel ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200'}`}
                    >
                      <div className="text-[14px] leading-5 text-gray-800 line-clamp-2">
                        <span className="font-semibold">{issue.key}</span> {issue.summary}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{clients} · {issue.assignee || 'Unassigned'}</span>
                        <span className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${CHIP[tone]}`}>{short(date)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Left out, said plainly */}
      {(board.noDate > 0 || board.doneBeforeToday > 0) && (
        <p className="text-xs text-gray-500">
          Not shown: {[
            board.noDate > 0 ? `${board.noDate} with no ${label.toLowerCase()}` : '',
            board.doneBeforeToday > 0 ? `${board.doneBeforeToday} done before today` : '',
          ].filter(Boolean).join(', ')}.
        </p>
      )}

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
