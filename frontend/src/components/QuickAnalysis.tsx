import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  quickApi, QuickReport, QuickStatus, QuickTicket, QuickNewTicket, QuickFeCandidate, QuickGroup, QuickSize,
} from '../services/api';
import { BUCKET_PILL } from '../utils/statusBuckets';
import { parseLocalDate } from '../utils/dateUtils';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayTime = (iso: string) => {
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return same ? timeOf(iso) : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${timeOf(iso)}`;
};
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const SIZE_PILL: Record<QuickSize, string> = {
  S: 'bg-green-100 text-green-800', M: 'bg-sky-100 text-sky-800', L: 'bg-amber-100 text-amber-800', XL: 'bg-red-100 text-red-800',
};
const SIZE_HINT: Record<QuickSize, string> = { S: 'About a day or less', M: 'Two to three days', L: 'About a week', XL: 'More than a week, or split it first' };
const PRIORITY: Record<QuickGroup['priority'], { label: string; head: string; dot: string }> = {
  high: { label: 'High', head: 'border-red-400 bg-red-50', dot: 'bg-red-500' },
  medium: { label: 'Medium', head: 'border-amber-400 bg-amber-50', dot: 'bg-amber-500' },
  low: { label: 'Low', head: 'border-gray-300 bg-gray-50', dot: 'bg-gray-400' },
};

const TicketLink = ({ t }: { t: Pick<QuickTicket, 'key' | 'url'> }) => (
  <a href={t.url} target="_blank" rel="noopener noreferrer" title={`Open ${t.key} in Jira`} className="font-semibold text-blue-700 hover:underline whitespace-nowrap">{t.key}</a>
);
const StatusPill = ({ t }: { t: Pick<QuickTicket, 'status' | 'bucket'> }) => (
  <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${BUCKET_PILL[t.bucket]}`}>{t.status}</span>
);
const Pills = ({ items }: { items: string[] }) => (
  <>{items.map(c => <span key={c} className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 ring-1 ring-gray-200">{c}</span>)}</>
);

/** The earlier of the due and release dates, labeled, red when before today. */
const DateChip = ({ t }: { t: QuickTicket }) => {
  const due = parseLocalDate(t.dueDate); const rel = parseLocalDate(t.releaseDate);
  const pick = due && rel ? (due <= rel ? { d: due, l: 'Due' } : { d: rel, l: 'Release' }) : due ? { d: due, l: 'Due' } : rel ? { d: rel, l: 'Release' } : null;
  if (!pick) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const late = pick.d < today && t.bucket !== 'done';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${late ? 'bg-red-100 text-red-800 ring-1 ring-red-300' : 'bg-gray-100 text-gray-700'}`}>{pick.l} {shortDate(pick.d)}</span>;
};

const Card: React.FC<{ icon: string; title: string; count?: number | string; hint?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ icon, title, count, hint, right, children }) => (
  <section className="bg-white rounded-lg shadow-sm border border-gray-200">
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
      <h2 className="text-[15px] font-semibold text-gray-800">{icon} {title}</h2>
      {count !== undefined && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{count}</span>}
      {hint && <span className="text-xs text-gray-500 truncate">{hint}</span>}
      <div className="ml-auto flex items-center gap-3">{right}</div>
    </div>
    <div className="p-4">{children}</div>
  </section>
);

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-gray-400 py-2">{children}</p>;

// ---------------------------------------------------------------- 1. new tickets
const NewTicketRow = ({ t, onRead }: { t: QuickNewTicket; onRead: (key: string, read: boolean) => void }) => (
  <li className={`flex gap-3 py-2.5 ${t.read ? 'opacity-60' : ''}`}>
    <button onClick={() => onRead(t.key, !t.read)} aria-pressed={t.read}
      title={t.read ? 'Read. Click to mark unread' : 'Mark as read: it is skipped from the next run on'}
      className={`shrink-0 w-8 h-8 rounded-full ring-1 flex items-center justify-center text-sm ${t.read ? 'bg-green-100 ring-green-300 text-green-700' : 'bg-white ring-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-700'}`}>
      {t.read ? '✓' : '👁'}
    </button>
    <div className="min-w-0 flex-1">
      <div className="text-[14px] leading-5 text-gray-800"><TicketLink t={t} /> {t.summary}</div>
      {t.description && <div className="text-xs text-gray-500 line-clamp-2 mt-0.5">{t.description}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">{t.type}</span>
        <StatusPill t={t} />
        <Pills items={t.clients} />
        {t.fe && <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">FE</span>}
        <span className="text-xs text-gray-500">{t.assignee || 'Unassigned'} · added {dayTime(t.firstSeenAt)}</span>
      </div>
    </div>
  </li>
);

// ---------------------------------------------------------------- 2. FE candidates
const FeCard = ({ c }: { c: QuickFeCandidate }) => (
  <li className="py-3">
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 shrink-0 px-2 py-0.5 rounded text-xs font-medium ${c.origin === 'new' ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-700'}`}>{c.origin === 'new' ? 'New' : 'Mine'}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-5 text-gray-800"><TicketLink t={c} /> {c.summary}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {c.size
            ? <span title={`${SIZE_HINT[c.size]}${c.sizeWhy ? `\n${c.sizeWhy}` : ''}`} className={`px-2 py-0.5 rounded text-xs font-bold ${SIZE_PILL[c.size]}`}>Size {c.size}</span>
            : <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500" title="No size could be written for this ticket">No size</span>}
          <StatusPill t={c} />
          <Pills items={c.clients} />
          <DateChip t={c} />
          {c.areas.map(a => <span key={a} className="px-1.5 py-0.5 rounded text-xs text-gray-600 bg-white ring-1 ring-gray-200">{a}</span>)}
          <span className="text-xs text-gray-500">{c.assignee ? `now with ${c.assignee}` : 'unassigned'}</span>
        </div>
        <p className="text-sm text-gray-700 mt-1.5">{c.analysis}</p>
        {c.sizeWhy && <p className="text-xs text-gray-500 mt-0.5">Size: {c.sizeWhy}</p>}
        {c.suggestion ? (
          <div className="mt-2 inline-block rounded-md bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-sm text-indigo-900">
            <span className="font-semibold">Suggest {c.suggestion.name}.</span> <span className="text-indigo-800">{c.suggestion.why.replace(`${c.suggestion.name}: `, '')}</span>
            {c.suggestion.alternatives.length > 0 && <span className="text-indigo-700"> Also: {c.suggestion.alternatives.map(a => `${a.name} (${a.aligned})`).join(', ')}.</span>}
          </div>
        ) : <p className="text-xs text-gray-400 mt-2">No suggestion: no one else on the FE team to offer it to.</p>}
      </div>
    </div>
  </li>
);

const FeTeam = ({ team }: { team: QuickReport['feTeam'] }) => (
  <table className="w-full text-sm">
    <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-medium">Who</th><th className="py-1 pr-3 font-medium w-20">Aligned</th><th className="py-1 pr-3 font-medium w-20">Blocked</th><th className="py-1 font-medium">Working for</th></tr></thead>
    <tbody>
      {team.map(m => (
        <tr key={m.name} className="border-t border-gray-100 align-top">
          <td className="py-1.5 pr-3 font-medium text-gray-800 whitespace-nowrap">{m.name}</td>
          <td className="py-1.5 pr-3"><span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 text-xs">{m.aligned}</span></td>
          <td className="py-1.5 pr-3 text-gray-600">{m.blocked || '–'}</td>
          <td className="py-1.5"><div className="flex flex-wrap gap-1">{m.clients.length ? m.clients.map(c => <span key={c.name} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800 ring-1 ring-gray-200">{c.name} {c.n}</span>) : <span className="text-gray-400 text-xs">nothing aligned</span>}</div></td>
        </tr>
      ))}
    </tbody>
  </table>
);

// ---------------------------------------------------------------- 3. my tickets
const GroupCard = ({ g }: { g: QuickGroup }) => {
  const p = PRIORITY[g.priority];
  return (
    <div className={`rounded-lg border-l-4 ${p.head} border border-gray-200`}>
      <div className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${p.dot}`} />
          <h3 className="font-semibold text-gray-800 text-[14px]">{g.title}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white text-gray-600 ring-1 ring-gray-200">{p.label} · {g.tickets.length}</span>
        </div>
        {g.why && <p className="text-sm text-gray-600 mt-1">{g.why}</p>}
        {g.action && <p className="text-sm text-gray-900 mt-1"><span className="font-semibold">Next:</span> {g.action}</p>}
      </div>
      <ul className="bg-white rounded-b-lg divide-y divide-gray-100 border-t border-gray-100">
        {g.tickets.map(t => (
          <li key={t.key} className="px-4 py-2 flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-gray-800 min-w-0 flex-1"><TicketLink t={t} /> {t.summary}</span>
            <StatusPill t={t} /><DateChip t={t} />
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------------------------------------------------------------- the page
export interface QuickViewProps {
  report: QuickReport | null; status: QuickStatus | null; error: string | null; loading: boolean;
  showRead: boolean; showTeam: boolean;
  onToggleRead: () => void; onToggleTeam: () => void; onRun: () => void; onSetRead: (key: string, read: boolean) => void;
}

/** What the page looks like for a given report and state. No data loading here, so it can be rendered on its own. */
export const QuickAnalysisView: React.FC<QuickViewProps> = ({ report, status, error, loading, showRead, showTeam, onToggleRead, onToggleTeam, onRun, onSetRead }) => {
  const sched = status?.schedule;
  const unread = report?.newTickets.filter(t => !t.read) ?? [];
  const read = report?.newTickets.filter(t => t.read) ?? [];

  return (
    <div className="h-full overflow-auto bg-gray-100">
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Header: when it last ran, when it runs next, Run now */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold text-gray-800">🔍 Quick Analysis</h1>
          <span className="text-sm text-gray-500">
            {status?.running ? '⏳ Running now…'
              : status?.lastRunAt ? `Last run ${dayTime(status.lastRunAt)}${status.lastDurationMs ? ` (${Math.round(status.lastDurationMs / 1000)}s)` : ''}` : 'Not run yet'}
            {!status?.running && !status?.disabled && status?.nextRunAt && ` · next about ${dayTime(status.nextRunAt)}`}
            {status?.disabled && ' · automatic runs are off'}
          </span>
          {sched && <span className="text-xs text-gray-400" title="Set in backend/delivery/config.json, quickAnalysis">Every {sched.intervalMinutes} min, {hour(sched.startHour)} to {hour(sched.endHour)}{sched.weekdaysOnly ? ', Mon to Fri' : ''}</span>}
          <button onClick={onRun} disabled={!!status?.running}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">
            {status?.running ? '⏳ Running…' : '🔄 Run now'}
          </button>
        </div>

        {(error || status?.lastStatus === 'failed') && (
          <div className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">
            ❌ {error || `The last run failed: ${status?.lastError || 'unknown error'}`}{report ? ' The report below is from the last good run.' : ''}
          </div>
        )}
        {report && report.notes.length > 0 && (
          <ul className="text-xs text-gray-600 bg-white border border-gray-200 rounded px-4 py-2 list-disc pl-8 space-y-0.5">{report.notes.map(n => <li key={n}>{n}</li>)}</ul>
        )}

        {loading && !report && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && !report && !error && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            <div className="text-3xl mb-2">🔍</div>
            No report yet. It builds by itself during working hours, or press <b>Run now</b> to build the first one.
          </div>
        )}

        {report && (
          <>
            {/* 1. New tickets */}
            <Card icon="🆕" title="New tickets in the sprint" count={unread.length} hint="Mark one as read and it is skipped from the next run on"
              right={read.length > 0 && <button onClick={onToggleRead} className="text-xs text-blue-600 hover:underline">{showRead ? 'Hide' : 'Show'} read ({read.length})</button>}>
              {unread.length === 0 && !showRead ? <Empty>Nothing new since you last read. New tickets added to the sprint show up here.</Empty> : (
                <ul className="divide-y divide-gray-100">
                  {unread.map(t => <NewTicketRow key={t.key} t={t} onRead={onSetRead} />)}
                  {showRead && read.map(t => <NewTicketRow key={t.key} t={t} onRead={onSetRead} />)}
                </ul>
              )}
            </Card>

            {/* 2. FE tickets: size and who could take them */}
            <Card icon="🧩" title="FE tickets: size and who could take them" count={report.feCandidates.length}
              hint="New FE tickets, and FE tickets assigned to me"
              right={report.feTeam.length > 0 && <button onClick={onToggleTeam} className="text-xs text-blue-600 hover:underline">{showTeam ? 'Hide' : 'Show'} who has what</button>}>
              {showTeam && <div className="mb-3 p-3 rounded-md bg-gray-50 border border-gray-100"><FeTeam team={report.feTeam} /><p className="text-xs text-gray-500 mt-2">Aligned means in progress and not blocked. Suggestions go by this load and by related work, and each one counts the suggestions above it so one person is not offered everything. They are a starting point, you decide.</p></div>}
              {report.feCandidates.length === 0 ? <Empty>No FE tickets to place right now.</Empty> : (
                <ul className="divide-y divide-gray-100">{report.feCandidates.map(c => <FeCard key={c.key} c={c} />)}</ul>
              )}
            </Card>

            {/* 3. My tickets */}
            <Card icon="🎯" title="My tickets: what to do first" count={report.counts.myOpen}
              hint={report.myTickets.source === 'ai' ? 'Grouped by meaning (AI-assisted); priority is never lower than the dates say' : 'Grouped by client and date'}>
              {report.myTickets.groups.length === 0 ? <Empty>Nothing open on your list.</Empty> : (
                <div className="space-y-3">{report.myTickets.groups.map(g => <GroupCard key={g.title} g={g} />)}</div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

/** Quick Analysis: loads the report, follows a run in progress, and handles Run now and the read marks. */
const QuickAnalysis: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const [report, setReport] = useState<QuickReport | null>(null);
  const [status, setStatus] = useState<QuickStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRead, setShowRead] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await quickApi.report();
      setReport(r.report); setStatus(r.status); seen.current = r.report?.generatedAt ?? null; setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the report'); }
    finally { setLoading(false); }
  }, []);

  const markViewed = useCallback(() => {
    quickApi.viewed().then(s => { setStatus(s); window.dispatchEvent(new Event('quick-changed')); }).catch(() => { /* the bell just keeps its count */ });
  }, []);

  useEffect(() => { load(); }, [load]);
  // opening the page clears the bell
  useEffect(() => { if (active) markViewed(); }, [active, markViewed]);

  // follow the run: quickly while one is going, slowly otherwise; reload the report when a newer one is ready
  const running = status?.running;
  useEffect(() => {
    const tick = async () => {
      try {
        const s = await quickApi.status();
        setStatus(s);
        if (s.generatedAt && s.generatedAt !== seen.current) { await load(); if (active) markViewed(); }
      } catch { /* the backend may be restarting; try again on the next tick */ }
    };
    const t = window.setInterval(tick, running ? 3000 : 60000);
    return () => window.clearInterval(t);
  }, [running, active, load, markViewed]);

  const runNow = async () => {
    try { setStatus(await quickApi.run()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start a run'); }
  };

  const setRead = async (key: string, read: boolean) => {
    setReport(r => r && ({
      ...r,
      newTickets: r.newTickets.map(t => (t.key === key ? { ...t, read } : t)),
      feCandidates: read ? r.feCandidates.filter(c => !(c.origin === 'new' && c.key === key)) : r.feCandidates,
      counts: { ...r.counts, newUnread: r.counts.newUnread + (read ? -1 : 1) },
    }));
    try { await quickApi.markRead(key, read); window.dispatchEvent(new Event('quick-changed')); } catch { /* reloaded below */ }
    load();
  };

  return (
    <QuickAnalysisView report={report} status={status} error={error} loading={loading} showRead={showRead} showTeam={showTeam}
      onToggleRead={() => setShowRead(s => !s)} onToggleTeam={() => setShowTeam(s => !s)} onRun={runNow} onSetRead={setRead} />
  );
};

export default QuickAnalysis;
