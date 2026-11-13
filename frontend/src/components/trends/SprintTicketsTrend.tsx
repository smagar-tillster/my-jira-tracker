import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trendsApi, SprintTrend, TrendBasis, TrendFilters, TrendGroup, TrendMonths } from '../../services/api';
import { buildSeries, seriesCounts, monthLabel, OTHER_COLOR, SERIES_COLORS, MAX_NAMED } from '../../utils/trendsChart';
import StackedColumns, { ColumnSeries, INK } from './StackedColumns';

const BASES: { id: TrendBasis; label: string; hint: string }[] = [
  { id: 'sprint', label: 'Sprint start', hint: 'Counted in the month its first sprint started: when it entered sprint planning. Each ticket once.' },
  { id: 'created', label: 'Created', hint: 'Counted in the month it was created in Jira.' },
  { id: 'resolved', label: 'Resolved', hint: 'Counted in the month it was resolved. A ticket not resolved yet is not counted.' },
];
const RANGES: { id: TrendMonths; label: string }[] = [{ id: 3, label: '3 months' }, { id: 6, label: '6 months' }];
const GROUPS: { id: TrendGroup; label: string; one: string; many: string; hint: string }[] = [
  { id: 'type', label: 'Type', one: 'type', many: 'types', hint: 'Split each month by ticket type.' },
  { id: 'client', label: 'Client', one: 'client', many: 'clients', hint: 'Split each month by the Client field. A ticket with several clients is counted under each; a ticket with none is "No client".' },
  { id: 'assignee', label: 'Assignee', one: 'assignee', many: 'assignees', hint: 'Split each month by who the ticket is assigned to now.' },
];

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Segmented = <T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string;
}) => (
  <div className="flex items-center gap-2 text-sm text-gray-600">
    <span>{label}</span>
    <div className="inline-flex rounded-lg overflow-clip ring-1 ring-gray-300 bg-white" role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.id)} onClick={() => onChange(o.id)} aria-pressed={value === o.id} title={o.hint}
          className={`px-3 py-1.5 text-sm font-medium ${value === o.id ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{o.label}</button>
      ))}
    </div>
  </div>
);

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 min-w-[150px]">
    <div className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
    <div className="text-xs text-gray-500">{label}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

export interface TrendViewProps {
  data: SprintTrend | null; loading: boolean; error: string | null;
  basis: TrendBasis; group: TrendGroup; months: TrendMonths; filters: TrendFilters; hidden: ReadonlySet<string>; view: 'chart' | 'table';
  onBasis: (b: TrendBasis) => void; onGroup: (g: TrendGroup) => void; onMonths: (m: TrendMonths) => void; onFilters: (f: TrendFilters) => void; onToggleSeries: (id: string) => void; onShowAll: () => void;
  onView: (v: 'chart' | 'table') => void; onRefresh: () => void;
}

/** The Sprint tickets by month page for given data and choices. No loading here, so it can be rendered on its own. */
export const SprintTicketsTrendView: React.FC<TrendViewProps> = ({ data, loading, error, basis, group, months, filters, hidden, view, onBasis, onGroup, onMonths, onFilters, onToggleSeries, onShowAll, onView, onRefresh }) => {
  const status = data?.status;
  const groupInfo = GROUPS.find(g => g.id === group) as (typeof GROUPS)[number];
  const series = useMemo(() => (data ? buildSeries(data.series, groupInfo.many) : []), [data, groupInfo]);
  const monthCount = data?.months.length ?? 0;

  // every series with its counts per month; the legend turns series off, and everything below follows the same slice
  const all: ColumnSeries[] = useMemo(() => (data ? series.map(s => ({ series: s, counts: seriesCounts(s, data.counts, monthCount) })) : []), [data, series, monthCount]);
  const shown = all.filter(d => !hidden.has(d.series.id));
  const sums = all.map(d => d.counts.reduce((a, b) => a + b, 0));
  const monthTotals = (data?.months ?? []).map((_, i) => shown.reduce((n, d) => n + d.counts[i], 0));
  const total = monthTotals.reduce((a, b) => a + b, 0);
  const busiest = monthTotals.length ? monthTotals.indexOf(Math.max(...monthTotals)) : -1;
  const top = shown.length ? shown.reduce((best, d) => (d.counts.reduce((a, b) => a + b, 0) > best.counts.reduce((a, b) => a + b, 0) ? d : best), shown[0]) : null;
  const topSum = top ? top.counts.reduce((a, b) => a + b, 0) : 0;
  const basisInfo = BASES.find(b => b.id === basis) as (typeof BASES)[number];
  const empty = !!data && data.tickets === 0;
  const filtered = !!filters.feTeam || !!filters.type || !!filters.client || !!filters.assignee;

  return (
    <div className="space-y-4">
      {/* Filters: rows above the content they scope */}
      <div className="flex items-center gap-x-6 gap-y-2 flex-wrap">
        <Segmented label="Count by" value={basis} options={BASES} onChange={onBasis} />
        <Segmented label="Group by" value={group} options={GROUPS} onChange={onGroup} />
        <Segmented label="Show" value={months} options={RANGES} onChange={onMonths} />
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          {status?.running ? <span>⏳ Reading Jira…</span> : status?.lastSyncAt ? <span title="The numbers change only when you press Refresh">Read from Jira {ago(status.lastSyncAt)} · {status.tickets.toLocaleString('en-US')} tickets</span> : null}
          <button onClick={onRefresh} disabled={!!status?.running} title="Reads the sprint tickets of the last 200 days from Jira (about a minute). Nothing updates on its own."
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed">↻ Refresh</button>
        </div>
      </div>
      {data && (
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-sm text-gray-600">
          <span>Only</span>
          <button onClick={() => onFilters({ ...filters, feTeam: !filters.feTeam })} aria-pressed={!!filters.feTeam}
            title="Tickets assigned to a member of the FE team (the people flagged on the Tasks page)"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ring-1 ${filters.feTeam ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'}`}>FE team</button>
          {([['type', 'Type', data.options.types], ['client', 'Client', data.options.clients], ['assignee', 'Assignee', data.options.assignees]] as const).map(([k, label, opts]) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <span className="sr-only">{label}</span>
              <select value={filters[k] || ''} onChange={e => onFilters({ ...filters, [k]: e.target.value || undefined })}
                className={`rounded-lg ring-1 px-2 py-1.5 text-sm bg-white max-w-[200px] ${filters[k] ? 'ring-indigo-600 text-indigo-700 font-medium' : 'ring-gray-300 text-gray-700'}`}>
                <option value="">{label}: all</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {filtered && <button onClick={() => onFilters({})} className="text-xs text-blue-600 hover:underline">Clear filters</button>}
        </div>
      )}

      {(error || status?.lastStatus === 'failed') && (
        <div className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {error || `The last read from Jira failed: ${status?.lastError || 'unknown error'}`}{data ? ' The numbers below are from the last good read.' : ''}</div>
      )}

      {!data && loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!data && !loading && !error && status?.firstLoad && <p className="text-sm text-gray-500">Nothing has been read from Jira yet. Press Refresh to read the sprint tickets; it takes about a minute.</p>}

      {data && (
        <>
          {!empty && data.matching === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No ticket matches these filters. <button onClick={() => onFilters({})} className="text-blue-600 hover:underline">Clear filters</button></div>
          ) : empty ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              <div className="text-3xl mb-2">📈</div>
              {status?.running ? 'Reading Jira. This can take a minute or two.' : 'No sprint tickets yet. Press Refresh to read them from Jira.'}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
                <Tile label="Tickets shown" value={total.toLocaleString('en-US')} sub={`of ${data.inRange.toLocaleString('en-US')} in this range`} />
                <Tile label="Average per month" value={monthCount ? n1(total / monthCount) : '0'} sub={plural(monthCount, 'month')} />
                <Tile label="Busiest month" value={busiest >= 0 && monthTotals[busiest] > 0 ? monthLabel(data.months[busiest]).full : '–'} sub={busiest >= 0 && monthTotals[busiest] > 0 ? plural(monthTotals[busiest], 'ticket') : undefined} />
                <Tile label={`Top ${groupInfo.one}`} value={top && topSum > 0 ? top.series.label : '–'} sub={top && topSum > 0 && total ? `${Math.round((topSum / total) * 100)}% of tickets shown` : undefined} />
              </div>

              <section className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
                  <h2 className="text-[15px] font-semibold text-gray-800">Sprint tickets by month, by {groupInfo.one}</h2>
                  <span className="text-xs text-gray-500">{basisInfo.hint}</span>
                  <div className="ml-auto inline-flex rounded-lg overflow-clip ring-1 ring-gray-300 bg-white" role="group" aria-label="View">
                    {(['chart', 'table'] as const).map(v => (
                      <button key={v} onClick={() => onView(v)} aria-pressed={view === v}
                        className={`px-3 py-1 text-sm font-medium ${view === v ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{v === 'chart' ? 'Chart' : 'Table'}</button>
                    ))}
                  </div>
                </div>

                {/* Legend: always present, and it is the type filter */}
                <div className="flex flex-wrap items-center gap-2 px-4 pt-3" role="group" aria-label={groupInfo.many}>
                  {all.map((d, i) => {
                    const off = hidden.has(d.series.id);
                    return (
                      <button key={d.series.id} onClick={() => onToggleSeries(d.series.id)} aria-pressed={!off}
                        title={off ? 'Hidden. Click to show' : d.series.isOther ? `Click to hide: ${d.series.types.join(', ')}` : `Click to hide this ${groupInfo.one}`}
                        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs ring-1 ${off ? 'ring-gray-200 text-gray-400 line-through' : 'ring-gray-300 text-gray-800 bg-white hover:bg-gray-50'}`}>
                        <span aria-hidden className="inline-block rounded-sm" style={{ width: 10, height: 10, background: off ? 'transparent' : d.series.color, boxShadow: off ? `inset 0 0 0 1.5px ${INK.axis}` : undefined }} />
                        {d.series.label}
                        <span className="text-gray-500 no-underline tabular-nums">{sums[i]}</span>
                      </button>
                    );
                  })}
                  {hidden.size > 0 && <button onClick={onShowAll} className="text-xs text-blue-600 hover:underline ml-1">Show all</button>}
                </div>

                <div className="p-4">
                  {shown.length === 0 ? <p className="text-sm text-gray-400 py-10 text-center">Nothing to show: every item is hidden or the filters match no ticket. Click an item above, or clear the filters.</p>
                    : view === 'chart' ? <StackedColumns months={data.months} data={shown} dimmed={loading} />
                    : <TrendTable months={data.months} label={groupInfo.label} types={data.series.filter(t => !hiddenTypes(series, hidden).has(t.name))} counts={data.counts} dimmed={loading} />}
                </div>
              </section>

              <p className="text-xs text-gray-500">
                {plural(data.inRange, 'ticket')} counted by {basisInfo.label.toLowerCase()} in these months.
                {data.before > 0 && ` ${plural(data.before, 'ticket')} older than this range.`}
                {data.future > 0 && ` ${plural(data.future, 'ticket')} in sprints that have not started yet.`}
                {data.noDate > 0 && ` ${plural(data.noDate, 'ticket')} with no ${basis === 'resolved' ? 'resolved date (not resolved yet)' : basis === 'created' ? 'created date' : 'sprint start date'}.`}
                {group === 'client' && ' A ticket with several clients is counted under each of them, so the columns can be taller than the ticket count.'}
                {' '}The colors follow the {groupInfo.one}: the seven most common each keep theirs, the rest are grouped as Other (the table lists them all).
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
};

/** The names of every type inside a hidden series (Other hides several). */
const hiddenTypes = (series: ReturnType<typeof buildSeries>, hidden: ReadonlySet<string>) => new Set(series.filter(s => hidden.has(s.id)).flatMap(s => s.types));

// ---------------------------------------------------------------- the table view: every item, newest month first
const TrendTable: React.FC<{ months: string[]; label: string; types: SprintTrend['series']; counts: SprintTrend['counts']; dimmed?: boolean }> = ({ months, label, types, counts, dimmed }) => {
  const rowTotal = (i: number) => types.reduce((n, t) => n + (counts[t.name]?.[i] ?? 0), 0);
  const colTotal = (t: string) => (counts[t] ?? []).reduce((a, b) => a + b, 0);
  const order = months.map((_, i) => i).reverse();
  return (
    <div className="overflow-auto max-h-[480px] border border-gray-200 rounded-md" style={{ opacity: dimmed ? 0.55 : 1 }}>
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-gray-50 text-gray-600 sticky top-0">
          <tr>
            <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-gray-50">Month <span className="font-normal text-gray-400">by {label.toLowerCase()}</span></th>
            {types.map(t => (
              <th key={t.name} className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                <span aria-hidden className="inline-block rounded-sm mr-1.5 align-middle" style={{ width: 8, height: 8, background: t.rank <= MAX_NAMED ? SERIES_COLORS[t.rank - 1] : OTHER_COLOR }} />
                {t.name}
              </th>
            ))}
            <th className="text-right font-semibold px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.map(i => (
            <tr key={months[i]} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white">{monthLabel(months[i]).full}</td>
              {types.map(t => { const v = counts[t.name]?.[i] ?? 0; return <td key={t.name} className={`px-3 py-1.5 text-right ${v ? 'text-gray-800' : 'text-gray-300'}`}>{v || '–'}</td>; })}
              <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{rowTotal(i)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td className="px-3 py-2 font-semibold text-gray-800 sticky left-0 bg-gray-50">Total</td>
            {types.map(t => <td key={t.name} className="px-3 py-2 text-right font-semibold text-gray-900">{colTotal(t.name)}</td>)}
            <td className="px-3 py-2 text-right font-semibold text-gray-900">{months.reduce((n, _, i) => n + rowTotal(i), 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------- loading and choices
/** Sprint tickets by month: loads the counts, follows a sync in progress, and keeps the choices. */
const SprintTicketsTrend: React.FC = () => {
  const [basis, setBasis] = useState<TrendBasis>('sprint');
  const [group, setGroup] = useState<TrendGroup>('type');
  const [months, setMonths] = useState<TrendMonths>(6);
  const [filters, setFilters] = useState<TrendFilters>({});
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [data, setData] = useState<SprintTrend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await trendsApi.sprintTickets(basis, months, group, filters); setData(d); seen.current = d.status.lastSyncAt; setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the trend'); }
    finally { setLoading(false); }
  }, [basis, months, group, filters]);

  useEffect(() => { load(); }, [load]);

  // nothing updates on its own; while a read you started is running, check often and reload when it is done
  const running = data?.status.running;
  useEffect(() => {
    if (!running) return undefined;
    const t = window.setInterval(async () => {
      try { const s = await trendsApi.status(); if (!s.running) await load(); }
      catch { /* the backend may be restarting; try again on the next tick */ }
    }, 4000);
    return () => window.clearInterval(t);
  }, [running, load]);

  const refresh = async () => {
    try { await trendsApi.refresh(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start a read'); }
  };
  const toggle = (id: string) => setHidden(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const changeGroup = (g: TrendGroup) => { setHidden(new Set()); setGroup(g); };

  return (
    <SprintTicketsTrendView data={data} loading={loading} error={error} basis={basis} group={group} months={months} filters={filters} hidden={hidden} view={view}
      onBasis={setBasis} onGroup={changeGroup} onMonths={setMonths} onFilters={setFilters} onToggleSeries={toggle} onShowAll={() => setHidden(new Set())} onView={setView} onRefresh={refresh} />
  );
};

export default SprintTicketsTrend;
