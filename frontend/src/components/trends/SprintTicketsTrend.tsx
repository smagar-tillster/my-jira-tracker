import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trendsApi, SprintTrend, TrendFilters, TrendGroup, TrendMonths } from '../../services/api';
import { buildSeries, seriesCounts, monthLabel, OTHER_COLOR, SERIES_COLORS, MAX_NAMED } from '../../utils/trendsChart';
import LineChart, { LineSeries, INK } from './LineChart';
import MultiSelect from './MultiSelect';
import DefectAnalysisModal from './DefectAnalysisModal';

const RANGES: { id: TrendMonths; label: string }[] = [{ id: 3, label: '3 months' }, { id: 6, label: '6 months' }];
const GROUPS: { id: TrendGroup; label: string; one: string; many: string; hint: string }[] = [
  { id: 'all', label: 'All', one: 'ticket', many: 'tickets', hint: 'One line with every ticket.' },
  { id: 'client', label: 'Client', one: 'client', many: 'clients', hint: 'One line per client. A ticket with several clients is counted under each; a ticket with none is "No client".' },
  { id: 'type', label: 'Type', one: 'type', many: 'types', hint: 'One line per ticket type.' },
  { id: 'component', label: 'Component', one: 'component', many: 'components', hint: 'One line per Jira component, which developers set when the final fix is done (FE, a service, and so on). A ticket with several components is counted under each.' },
];

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

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

const Tile: React.FC<{ label: string; value: string; sub?: string; children?: React.ReactNode }> = ({ label, value, sub, children }) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 min-w-[170px] flex-1">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-2xl font-semibold text-gray-900 tabular-nums truncate" title={value}>{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    {children}
  </div>
);

export interface TrendViewProps {
  data: SprintTrend | null; loading: boolean; error: string | null;
  group: TrendGroup; months: TrendMonths; filters: TrendFilters; hidden: ReadonlySet<string>; view: 'chart' | 'table';
  onGroup: (g: TrendGroup) => void; onMonths: (m: TrendMonths) => void; onFilters: (f: TrendFilters) => void; onToggleSeries: (id: string) => void; onShowAll: () => void;
  onView: (v: 'chart' | 'table') => void; onRefresh: () => void; onDefects: () => void;
}

/** The Ticket trend report for given data and choices. No loading here, so it can be rendered on its own. */
export const SprintTicketsTrendView: React.FC<TrendViewProps> = ({ data, loading, error, group, months, filters, hidden, view, onGroup, onMonths, onFilters, onToggleSeries, onShowAll, onView, onRefresh, onDefects }) => {
  const status = data?.status;
  const groupInfo = GROUPS.find(g => g.id === group) as (typeof GROUPS)[number];
  const series = useMemo(() => (data ? buildSeries(data.series, groupInfo.many) : []), [data, groupInfo]);
  const monthCount = data?.months.length ?? 0;

  // every line with its counts per month; the position (not the visible order) picks its dash and marker, so hiding a line changes no other
  const all: LineSeries[] = useMemo(() => (data ? series.map((s, position) => ({ series: s, position, counts: seriesCounts(s, data.counts, monthCount) })) : []), [data, series, monthCount]);
  const shown = all.filter(d => !hidden.has(d.series.id));
  const sums = all.map(d => d.counts.reduce((a, b) => a + b, 0));
  const empty = !!data && data.tickets === 0;
  const filtered = !!filters.feTeam || !!filters.type?.length || !!filters.client?.length || !!filters.assignee?.length || !!filters.component?.length;

  const totals = data?.totals ?? [];
  const busiest = totals.length ? totals.indexOf(Math.max(...totals)) : -1;
  const inRange = data?.inRange ?? 0;
  const sd = data ? data.summary.stories + data.summary.defects : 0;

  return (
    <div className="space-y-4">
      {error || status?.lastStatus === 'failed' ? (
        <div className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {error || `The last read from Jira failed: ${status?.lastError || 'unknown error'}`}{data ? ' The numbers below are from the last good read.' : ''}</div>
      ) : null}

      {data && !empty && (
        <div className="flex flex-wrap gap-3">
          <Tile label="Tickets done" value={inRange.toLocaleString('en-US')} sub={`${monthCount ? Math.round(inRange / monthCount) : 0} per month, ${plural(monthCount, 'month')}`} />
          <Tile label="Stories vs defects" value={`${data.summary.stories.toLocaleString('en-US')} / ${data.summary.defects.toLocaleString('en-US')}`}
            sub={sd ? `${pct(data.summary.stories, inRange)}% stories, ${pct(data.summary.defects, inRange)}% defects` : 'None done in view'}>
            <div className="flex h-1.5 rounded-full overflow-hidden mt-2 gap-0.5" aria-hidden>
              <div style={{ width: `${sd ? (data.summary.stories / sd) * 100 : 0}%`, background: SERIES_COLORS[0] }} />
              <div style={{ width: `${sd ? (data.summary.defects / sd) * 100 : 0}%`, background: SERIES_COLORS[1] }} />
            </div>
          </Tile>
          <Tile label="Top client" value={data.summary.topClient?.name ?? '–'} sub={data.summary.topClient ? `${plural(data.summary.topClient.count, 'ticket')}, ${pct(data.summary.topClient.count, inRange)}% of tickets shown` : 'No done ticket has a client'} />
          <Tile label="Busiest month" value={busiest >= 0 && totals[busiest] > 0 ? monthLabel(data.months[busiest]).full : '–'} sub={busiest >= 0 && totals[busiest] > 0 ? plural(totals[busiest], 'ticket') : undefined} />
        </div>
      )}

      {/* Controls: rows above the content they scope */}
      <div className="flex items-center gap-x-6 gap-y-2 flex-wrap">
        <Segmented label="Split by" value={group} options={GROUPS} onChange={onGroup} />
        <Segmented label="Show" value={months} options={RANGES} onChange={onMonths} />
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
          {status?.running ? <span>⏳ Reading…</span> : status?.lastSyncAt ? <span title={`Read from Jira ${ago(status.lastSyncAt)}: ${status.tickets.toLocaleString('en-US')} done tickets. The numbers change only when you press Refresh.`}>Read {ago(status.lastSyncAt)} · {status.tickets.toLocaleString('en-US')}</span> : null}
          <button onClick={onRefresh} disabled={!!status?.running} title="Reads the tickets done in the last 6 months from Jira. Nothing updates on its own."
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed">↻ Refresh</button>
        </div>
      </div>
      {data && (
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-sm text-gray-600">
          <span>Only</span>
          <button onClick={() => onFilters({ ...filters, feTeam: !filters.feTeam })} aria-pressed={!!filters.feTeam}
            title="Tickets assigned to a member of the FE team (the people flagged on the Tasks page)"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ring-1 ${filters.feTeam ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'}`}>FE team</button>
          {([['client', 'Client', data.options.clients], ['component', 'Component', data.options.components], ['assignee', 'Assignee', data.options.assignees], ['type', 'Type', data.options.types]] as const).map(([k, label, opts]) => (
            <MultiSelect key={k} label={label} options={opts} value={filters[k] ?? []} onChange={v => onFilters({ ...filters, [k]: v.length ? v : undefined })} />
          ))}
          {filtered && <button onClick={() => onFilters({})} className="text-xs text-blue-600 hover:underline">Clear filters</button>}
          <button onClick={onDefects} disabled={empty} title="Patterns in the defects done in these months, and where to focus to reduce them. Follows the client, assignee and FE team filters."
            className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed">🔎 Defect analysis</button>
        </div>
      )}

      {!data && loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!data && !loading && !error && status?.firstLoad && <p className="text-sm text-gray-500">Nothing has been read from Jira yet. Press Refresh to read the done tickets.</p>}

      {data && (
        empty ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            <div className="text-3xl mb-2">📈</div>
            {status?.running ? 'Reading Jira. This can take a minute.' : 'No done tickets yet. Press Refresh to read them from Jira.'}
          </div>
        ) : data.matching === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No ticket matches these filters. <button onClick={() => onFilters({})} className="text-blue-600 hover:underline">Clear filters</button></div>
        ) : (
          <>
            <section className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
                <h2 className="text-[15px] font-semibold text-gray-800">Ticket trend report{group === 'all' ? '' : `, by ${groupInfo.one}`}</h2>
                <span className="text-xs text-gray-500">Done = passed QA or later (Jira's Done). Counted in the month it was done, each ticket once.</span>
                <div className="ml-auto inline-flex rounded-lg overflow-clip ring-1 ring-gray-300 bg-white" role="group" aria-label="View">
                  {(['chart', 'table'] as const).map(v => (
                    <button key={v} onClick={() => onView(v)} aria-pressed={view === v}
                      className={`px-3 py-1 text-sm font-medium ${view === v ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{v === 'chart' ? 'Chart' : 'Table'}</button>
                  ))}
                </div>
              </div>

              {/* Legend: with more than one line it is always there, and it is the filter that hides a line */}
              {group !== 'all' && (
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
              )}

              <div className="p-4">
                {shown.length === 0 ? <p className="text-sm text-gray-400 py-10 text-center">Every line is hidden. Click one above to show it.</p>
                  : view === 'chart' ? <LineChart months={data.months} data={shown} dimmed={loading} ariaLabel={`Tickets per month${group === 'all' ? '' : `, one line per ${groupInfo.one}`}`} />
                  : <TrendTable months={data.months} label={groupInfo.label} series={data.series.filter(t => !hiddenNames(series, hidden).has(t.name))} counts={data.counts} totals={data.totals} dimmed={loading} />}
              </div>
            </section>

            <p className="text-xs text-gray-500">
              {plural(data.inRange, 'ticket')} done in these months.
              {data.before > 0 && ` ${plural(data.before, 'ticket')} done before this range (read, not shown).`}
              {data.noDate > 0 && ` ${plural(data.noDate, 'ticket')} with no done date.`}
              {' '}The last month is still in progress (dashed).
              {group === 'client' && ' A ticket with several clients is counted under each of them, so the lines add up to more than the ticket count.'}
              {group === 'component' && ' A ticket with several components is counted under each of them, so the lines add up to more than the ticket count.'}
              {group !== 'all' && ' The seven biggest lines each keep a color; the rest are grouped as Other (the table lists them all).'}
            </p>
          </>
        )
      )}
    </div>
  );
};

/** The names inside a hidden series (Other hides several). */
const hiddenNames = (series: ReturnType<typeof buildSeries>, hidden: ReadonlySet<string>) => new Set(series.filter(s => hidden.has(s.id)).flatMap(s => s.types));

// ---------------------------------------------------------------- the table view: every item, newest month first
const TrendTable: React.FC<{ months: string[]; label: string; series: SprintTrend['series']; counts: SprintTrend['counts']; totals: number[]; dimmed?: boolean }> = ({ months, label, series, counts, totals, dimmed }) => {
  const colTotal = (t: string) => (counts[t] ?? []).reduce((a, b) => a + b, 0);
  const order = months.map((_, i) => i).reverse();
  return (
    <div className="overflow-auto max-h-[480px] border border-gray-200 rounded-md" style={{ opacity: dimmed ? 0.55 : 1 }}>
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-gray-50 text-gray-600 sticky top-0">
          <tr>
            <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-gray-50">Month <span className="font-normal text-gray-400">{label.toLowerCase()}</span></th>
            {series.length > 1 && series.map(t => (
              <th key={t.name} className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                <span aria-hidden className="inline-block rounded-sm mr-1.5 align-middle" style={{ width: 8, height: 8, background: t.rank <= MAX_NAMED ? SERIES_COLORS[t.rank - 1] : OTHER_COLOR }} />
                {t.name}
              </th>
            ))}
            <th className="text-right font-semibold px-3 py-2">Tickets</th>
          </tr>
        </thead>
        <tbody>
          {order.map(i => (
            <tr key={months[i]} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white">{monthLabel(months[i]).full}</td>
              {series.length > 1 && series.map(t => { const v = counts[t.name]?.[i] ?? 0; return <td key={t.name} className={`px-3 py-1.5 text-right ${v ? 'text-gray-800' : 'text-gray-300'}`}>{v || '–'}</td>; })}
              <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{totals[i]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td className="px-3 py-2 font-semibold text-gray-800 sticky left-0 bg-gray-50">Total</td>
            {series.length > 1 && series.map(t => <td key={t.name} className="px-3 py-2 text-right font-semibold text-gray-900">{colTotal(t.name)}</td>)}
            <td className="px-3 py-2 text-right font-semibold text-gray-900">{totals.reduce((a, b) => a + b, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------- loading and choices
/** Sprint tickets by month: loads the counts and keeps the choices. Nothing refreshes on its own; while a read you started is running it checks until it is done. */
const SprintTicketsTrend: React.FC = () => {
  const [group, setGroup] = useState<TrendGroup>('all');
  const [months, setMonths] = useState<TrendMonths>(6);
  const [filters, setFilters] = useState<TrendFilters>({});
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [defectsOpen, setDefectsOpen] = useState(false);
  const [data, setData] = useState<SprintTrend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try { const d = await trendsApi.sprintTickets('resolved', months, group, filters); if (mine === latest.current) { setData(d); setError(null); } }
    catch (e) { if (mine === latest.current) setError(e instanceof Error ? e.message : 'Could not load the trend'); }
    finally { if (mine === latest.current) setLoading(false); }
  }, [months, group, filters]);

  useEffect(() => { load(); }, [load]);

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
    <>
    <SprintTicketsTrendView data={data} loading={loading} error={error} group={group} months={months} filters={filters} hidden={hidden} view={view}
      onGroup={changeGroup} onMonths={setMonths} onFilters={setFilters} onToggleSeries={toggle} onShowAll={() => setHidden(new Set())} onView={setView} onRefresh={refresh} onDefects={() => setDefectsOpen(true)} />
      {defectsOpen && <DefectAnalysisModal months={months} filters={filters} onClose={() => setDefectsOpen(false)} />}
    </>
  );
};

export default SprintTicketsTrend;
