import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trendsApi, DefectAnalysis, DefectCategory, DefectComponent, DefectGuidance, KbStatus, TrendFilters, TrendMonths } from '../../services/api';
import { monthCounts, monthLabel, sparkline, trendText, SERIES_COLORS } from '../../utils/trendsChart';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const TONE: Record<string, string> = { up: 'text-red-700', down: 'text-green-700', flat: 'text-gray-500', none: 'text-gray-500' };

/** One number in the stats line: a small label, then the value. */
const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col min-w-0">
    <span className="text-xs text-gray-500">{label}</span>
    <span className="text-base text-gray-900">{children}</span>
  </div>
);

/**
 * Defects done per month as a line across the full width of the modal: the value above each point, the month below. The last month is
 * still in progress, so its segment is dashed (as in the report's chart). The counts are also in the label for screen readers.
 */
const MonthTrend: React.FC<{ months: string[]; values: number[] }> = ({ months, values }) => {
  const W = 680; const H = 104; const PADX = 24; const TOP = 26;
  const s = sparkline(values, W - 2 * PADX, H - TOP - 28, 6);
  const pts = s.points ? s.points.split(' ').map(p => { const [x, y] = p.split(',').map(Number); return { x: x + PADX, y: y + TOP }; }) : [];
  const items = monthCounts(months, values);
  const label = items.map(m => `${m.label} ${m.count}`).join(', ');
  const n = pts.length;
  const stroke = { fill: 'none', stroke: SERIES_COLORS[0], strokeWidth: 2.5, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Defects per month: ${label}`} style={{ display: 'block' }}>
      <line x1={PADX} x2={W - PADX} y1={H - 28 + 6} y2={H - 28 + 6} stroke="#e1e0d9" strokeWidth={1} />
      {n > 2 && <polyline points={pts.slice(0, n - 1).map(p => `${p.x},${p.y}`).join(' ')} {...stroke} />}
      {n > 1 && <polyline points={pts.slice(n - 2).map(p => `${p.x},${p.y}`).join(' ')} {...stroke} strokeDasharray="5 4" />}
      {pts.map((p, i) => (
        <g key={items[i].month}>
          <circle cx={p.x} cy={p.y} r={5} fill={SERIES_COLORS[0]} stroke="#fff" strokeWidth={2} />
          <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize={14} fontWeight={600} fill="#0b0b0b" style={{ fontVariantNumeric: 'tabular-nums' }}>{items[i].count}</text>
          <text x={p.x} y={H - 6} textAnchor="middle" fontSize={13} fill="#52514e">{items[i].label}</text>
        </g>
      ))}
    </svg>
  );
};

/** What to do about a category: its advice, plus the repeats that belong to it. */
const adviceFor = (c: DefectCategory) =>
  `${c.advice}${c.repeats.length ? ` Repeats: ${c.repeats.map(r => `"${r.phrase}" in ${r.count} defects${r.clients > 1 ? ` (${r.clients} clients)` : ''}`).join('; ')}. Check whether they share one cause.` : ''}`;

/** A labelled line inside a category: a fixed label column, then the value. */
const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-3 text-sm leading-relaxed">
    <span className="w-20 shrink-0 text-gray-500">{label}</span>
    <span className="min-w-0 text-gray-900">{children}</span>
  </div>
);

const CategoryRow: React.FC<{ c: DefectCategory }> = ({ c }) => {
  const tr = trendText(c.changePct);
  return (
    <li className="py-4 space-y-1.5">
      <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap">
        <span className="text-base font-semibold text-gray-900">{c.name}</span>
        <span className="text-sm text-gray-700 tabular-nums">({c.count} · {c.share}%)</span>
        <span className={`text-sm tabular-nums ${TONE[tr.tone]}`} title={c.changePct === null ? 'Too few defects in the earlier months for a percentage' : 'Defects per month, recent months against the earlier ones'}>{tr.arrow} {tr.text}</span>
        {c.medianDaysToFix !== null && <span className="text-sm text-gray-500 tabular-nums" title="Median days from created to done">fix {c.medianDaysToFix} d</span>}
      </div>
      <p className="text-sm text-gray-600">{c.meaning}</p>
      <Line label="Top tenants">{c.tenants.length ? c.tenants.map(t => `${t.name} ${t.count}`).join(' · ') : 'none set'}</Line>
      <Line label="Samples"><Samples examples={c.examples} /></Line>
      <Line label="Advice">{adviceFor(c)}</Line>
    </li>
  );
};

/** The samples as links, shared by the category and component rows. */
const Samples: React.FC<{ examples: { key: string; summary: string; url: string }[] }> = ({ examples }) => (
  <>
    {examples.map((e, i) => (
      <React.Fragment key={e.key}>{i > 0 && ' · '}<a href={e.url} target="_blank" rel="noopener noreferrer" title={e.summary} className="text-blue-700 hover:underline">{e.key}</a></React.Fragment>
    ))}
  </>
);

/** A fix component: the Jira component developers set when the final fix is done, so it says which part of the platform was changed. */
const ComponentRow: React.FC<{ c: DefectComponent }> = ({ c }) => {
  const tr = trendText(c.changePct);
  return (
    <li className="py-3 space-y-1.5">
      <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap">
        <span className="text-base font-semibold text-gray-900">{c.name}</span>
        <span className="text-sm text-gray-700 tabular-nums">({c.count} · {c.share}%)</span>
        <span className={`text-sm tabular-nums ${TONE[tr.tone]}`} title={c.changePct === null ? 'Too few defects in the earlier months for a percentage' : 'Defects per month, recent months against the earlier ones'}>{tr.arrow} {tr.text}</span>
        <span className="text-sm text-gray-500 tabular-nums" title={`${c.count} defects among ${c.done} tickets done in this component`}>{c.per100} per 100 done</span>
        {c.medianDaysToFix !== null && <span className="text-sm text-gray-500 tabular-nums" title="Median days from created to done">fix {c.medianDaysToFix} d</span>}
      </div>
      <Line label="Top categories">{c.categories.map(x => `${x.name} ${x.count}`).join(' · ') || 'none'}</Line>
      <Line label="Top tenants">{c.tenants.length ? c.tenants.map(t => `${t.name} ${t.count}`).join(' · ') : 'none set'}</Line>
      <Line label="Samples"><Samples examples={c.examples} /></Line>
    </li>
  );
};

/** What the defects knowledge base queue says, in words. */
export const kbSummary = (kb: KbStatus): string => {
  const bits: string[] = [];
  bits.push(kb.pending ? `${kb.pending} ${kb.pending === 1 ? 'defect is' : 'defects are'} waiting to go to the defects knowledge base` : 'Nothing is waiting for the defects knowledge base');
  if (kb.disabled) bits.push('the daily sync is switched off in the config');
  else if (kb.pending) bits.push(`it syncs once a day after ${kb.hour}:00`);
  const r = kb.lastResult;
  if (r) {
    const parts = [`${r.written} added`, `${r.matched} matched an existing pattern`, `${r.exists} already there`];
    bits.push(`last sync ${ago(r.at)}: ${parts.join(', ')}${r.ingest === 'failed' ? `. Ingest failed (${r.reason}); it is retried next time` : r.ingest === 'ok' ? '; ingest ran' : ''}${r.ingest === 'none' && r.reason ? `. ${r.reason}` : ''}`);
  }
  return `${bits[0]}${bits.length > 1 ? `; ${bits.slice(1).join('; ')}` : ''}.`;
};

export interface DefectViewProps {
  data: DefectAnalysis | null; loading: boolean; error: string | null;
  guidance: DefectGuidance | null; guiding: boolean; guideError: string | null;
  kb: KbStatus | null; syncing: boolean; kbError: string | null; onSync: () => void;
  onWrite: (force: boolean) => void; onClose: () => void;
}

/** The defect analysis for given data. No loading here, so it can be rendered on its own. */
export const DefectAnalysisView: React.FC<DefectViewProps> = ({ data, loading, error, guidance, guiding, guideError, kb, syncing, kbError, onSync, onWrite, onClose }) => {
  const f = data?.facts;
  const t = f?.tiles;
  const top = f?.categories.find(c => !c.name.startsWith('Other')) ?? f?.categories[0];
  const range = f ? `${monthLabel(f.months[0]).full} to ${monthLabel(f.months[f.months.length - 1]).full}` : '';

  return (
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full min-h-0" role="dialog" aria-modal="true" aria-labelledby="defect-title">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 shrink-0">
        <h2 id="defect-title" className="text-base font-semibold text-gray-900">Defect analysis</h2>
        {f && <span className="text-xs text-gray-500">{range} · {data?.scope}</span>}
        <button onClick={onClose} aria-label="Close" autoFocus className="ml-auto px-2 py-1 rounded text-gray-500 hover:bg-gray-100">✕</button>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
        {error && <div className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {error}</div>}
        {!data && loading && <p className="text-sm text-gray-500">Analyzing…</p>}

        {f && t && (t.defects === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No defects were done in these months with these filters. Clear a filter on the report, or press Refresh there if you have not read Jira yet.</p>
        ) : (
          <>
            {/* one line of numbers */}
            <div className="flex flex-wrap items-end gap-x-10 gap-y-2">
              <Stat label="Defects"><b className="font-semibold tabular-nums">{t.defects.toLocaleString('en-US')}</b> <span className="text-gray-500">({t.shareOfDone}% of done)</span></Stat>
              <Stat label="Top clients"><span className="tabular-nums">{f.topClients.length ? f.topClients.map(c => `${c.name} ${c.count}`).join(' · ') : 'none set'}</span></Stat>
              <Stat label="Top category">{top ? <><b className="font-semibold">{top.name}</b> <span className="text-gray-500 tabular-nums">{top.count}</span></> : '–'}</Stat>
            </div>

            <section aria-label="Defects done per month" className="pb-3 border-b border-gray-100">
              <div className="text-xs text-gray-500 mb-1">Defects done per month</div>
              <MonthTrend months={f.months} values={f.perMonth} />
            </section>

            <section aria-label="By fix component">
              <h3 className="text-base font-semibold text-gray-900">By fix component</h3>
              <p className="text-sm text-gray-500 mb-1">The Jira component set when the final fix was done. A defect with several components counts under each.</p>
              <ul className="divide-y divide-gray-100">
                {f.components.map(c => <ComponentRow key={c.name} c={c} />)}
              </ul>
            </section>

            <section aria-label="By category" className="pt-1">
              <h3 className="text-base font-semibold text-gray-900">By category</h3>
              <p className="text-sm text-gray-500 mb-1">Picked by keywords in the title, labels and component. The same categories every time.</p>
              <ul className="divide-y divide-gray-100">
                {f.categories.map(c => <CategoryRow key={c.name} c={c} />)}
              </ul>
            </section>

            <section className="border-t border-gray-100 pt-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900">AI analysis</h3>
                {guidance && <span className="text-xs text-gray-500">{guidance.model} · {ago(guidance.at)}{guidance.cached ? ' · saved for these numbers' : ''}</span>}
                <button onClick={() => onWrite(!!guidance)} disabled={guiding}
                  className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed">
                  {guiding ? '⏳ Analyzing…' : guidance ? '↻ Run again' : 'AI analysis'}
                </button>
              </div>
              {guideError && <div className="mt-2 px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {guideError}</div>}
              {guiding && <p className="mt-2 text-xs text-gray-500">This can take up to a minute.</p>}
              {guidance && (
                <div className="mt-2 bg-gray-50 rounded-lg px-4 py-3 space-y-2">
                  {guidance.headline && <p className="text-sm font-medium text-gray-900">{guidance.headline}</p>}
                  <ol className="space-y-2">
                    {guidance.focus.map((x, i) => (
                      <li key={`${x.title}-${i}`} className="text-sm text-gray-800">
                        <span className="font-semibold">{i + 1}. {x.title}</span> <span className="text-gray-600">{x.why}</span>
                        <ul className="list-disc pl-5 text-gray-800">{x.actions.map(a => <li key={a}>{a}</li>)}</ul>
                        {x.measure && <div className="text-xs text-gray-500">Watch: {x.measure}</div>}
                      </li>
                    ))}
                  </ol>
                  {guidance.caveats.map(c => <p key={c} className="text-xs text-gray-500">{c}</p>)}
                </div>
              )}
            </section>

            {kb && (
              <section aria-label="Defects knowledge base" className="border-t border-gray-100 pt-3 flex items-start gap-3 flex-wrap">
                <p className="text-sm text-gray-700 flex-1 min-w-[240px]"><span className="font-semibold text-gray-900">Defects knowledge base. </span>{kbSummary(kb)}</p>
                <button onClick={onSync} disabled={syncing || (!kb.pending && !kb.ingestPending)} title="Adds the new defect patterns to the RAG defects feed and runs ingest, as the daily sync does"
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed">{syncing ? '⏳ Syncing…' : 'Sync now'}</button>
                {kbError && <p className="basis-full px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {kbError}</p>}
              </section>
            )}

            <p className="text-xs text-gray-500">
              {f.typesCounted.join(', ')} done in these months{f.typeFilterIgnored ? '; the Type filter is ignored here' : ''}. Numbers change when you press Refresh on the report.
            </p>
          </>
        ))}
      </div>
    </div>
  );
};

/** The modal: loads the analysis for the page's months and filters, and asks for the written guidance on request. */
const DefectAnalysisModal: React.FC<{ months: TrendMonths; filters: TrendFilters; onClose: () => void }> = ({ months, filters, onClose }) => {
  const [data, setData] = useState<DefectAnalysis | null>(null);
  const [guidance, setGuidance] = useState<DefectGuidance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guiding, setGuiding] = useState(false);
  const [kb, setKb] = useState<KbStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const mine = ++latest.current;
    setLoading(true); setGuideError(null);
    trendsApi.defects(months, filters)
      .then(d => { if (mine === latest.current) { setData(d); setGuidance(d.guidance); setError(null); } })
      .catch(e => { if (mine === latest.current) setError(e instanceof Error ? e.message : 'Could not load the analysis'); })
      .finally(() => { if (mine === latest.current) setLoading(false); });
  }, [months, filters]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const loadKb = useCallback(() => { trendsApi.kbStatus().then(setKb).catch(() => { /* the status line is optional */ }); }, []);
  useEffect(() => { loadKb(); }, [loadKb]);

  const write = useCallback(async (force: boolean) => {
    setGuiding(true); setGuideError(null);
    try { setGuidance(await trendsApi.defectGuidance(months, filters, force)); }
    catch (e) { setGuideError(e instanceof Error ? e.message : 'Could not write the guidance'); }
    finally { setGuiding(false); loadKb(); }       // running the analysis queues the defects it looked at
  }, [months, filters, loadKb]);

  const sync = useCallback(async () => {
    setSyncing(true); setKbError(null);
    try { setKb(await trendsApi.kbSync()); }
    catch (e) { setKbError(e instanceof Error ? e.message : 'Could not sync'); loadKb(); }
    finally { setSyncing(false); }
  }, [loadKb]);

  // Rendered at the top of the page (not inside the report) so no parent can clip or cover it, and sized to the window: the header stays, the body scrolls.
  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ height: '100dvh' }}>
      <DefectAnalysisView data={data} loading={loading} error={error} guidance={guidance} guiding={guiding} guideError={guideError} kb={kb} syncing={syncing} kbError={kbError} onSync={sync} onWrite={write} onClose={onClose} />
    </div>,
    document.body,
  );
};

export default DefectAnalysisModal;
