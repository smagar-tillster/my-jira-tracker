import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trendsApi, DefectAnalysis, DefectCategory, DefectGuidance, TrendFilters, TrendMonths } from '../../services/api';
import { monthCounts, monthLabel, sparkline, trendText, SERIES_COLORS } from '../../utils/trendsChart';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const TONE: Record<string, string> = { up: 'text-red-700', down: 'text-green-700', flat: 'text-gray-500', none: 'text-gray-400' };

/** One number in the stats line: a small label, then the value. */
const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col min-w-0">
    <span className="text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
    <span className="text-sm text-gray-900 truncate">{children}</span>
  </div>
);

/** The months as a small line with the last point marked; the counts are in its label and hover text. */
const Spark: React.FC<{ months: string[]; values: number[] }> = ({ months, values }) => {
  const s = sparkline(values, 110, 28);
  const label = monthCounts(months, values).map(m => `${m.label} ${m.count}`).join(', ');
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <svg width={110} height={28} role="img" aria-label={`Defects per month: ${label}`}>
        <polyline points={s.points} fill="none" stroke={SERIES_COLORS[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {s.last && <circle cx={s.last.x} cy={s.last.y} r={4} fill={SERIES_COLORS[0]} stroke="#fff" strokeWidth={2} />}
      </svg>
      <span className="text-xs text-gray-500 tabular-nums">{values.join(' · ')}</span>
    </span>
  );
};

/** What to do about a category: its advice, plus the repeats that belong to it. */
const adviceFor = (c: DefectCategory) =>
  `${c.advice}${c.repeats.length ? ` Repeats: ${c.repeats.map(r => `"${r.phrase}" in ${r.count} defects${r.clients > 1 ? ` (${r.clients} clients)` : ''}`).join('; ')}. Check whether they share one cause.` : ''}`;

const CategoryRow: React.FC<{ c: DefectCategory }> = ({ c }) => {
  const tr = trendText(c.changePct);
  return (
    <li className="py-2.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-semibold text-gray-900">{c.name}</span>
        <span className="text-sm text-gray-600 tabular-nums">({c.count} · {c.share}%)</span>
        <span className={`text-xs tabular-nums ${TONE[tr.tone]}`} title={c.changePct === null ? 'Too few defects in the earlier months for a percentage' : 'Defects per month, recent months against the earlier ones'}>{tr.arrow} {tr.text}</span>
        {c.medianDaysToFix !== null && <span className="text-xs text-gray-400 tabular-nums" title="Median days from created to done">fix {c.medianDaysToFix} d</span>}
      </div>
      <div className="text-xs text-gray-500">{c.meaning}</div>
      <div className="mt-1 text-xs text-gray-700 flex flex-wrap gap-x-4 gap-y-0.5">
        <span><span className="text-gray-400">Top tenants </span>{c.tenants.length ? c.tenants.map(t => `${t.name} ${t.count}`).join(' · ') : 'none set'}</span>
        <span><span className="text-gray-400">Samples </span>
          {c.examples.map((e, i) => (
            <React.Fragment key={e.key}>{i > 0 && ' · '}<a href={e.url} target="_blank" rel="noopener noreferrer" title={e.summary} className="text-blue-600 hover:underline">{e.key}</a></React.Fragment>
          ))}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-800"><span className="text-gray-400">Advice </span>{adviceFor(c)}</div>
    </li>
  );
};

export interface DefectViewProps {
  data: DefectAnalysis | null; loading: boolean; error: string | null;
  guidance: DefectGuidance | null; guiding: boolean; guideError: string | null;
  onWrite: (force: boolean) => void; onClose: () => void;
}

/** The defect analysis for given data. No loading here, so it can be rendered on its own. */
export const DefectAnalysisView: React.FC<DefectViewProps> = ({ data, loading, error, guidance, guiding, guideError, onWrite, onClose }) => {
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
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2 pb-3 border-b border-gray-100">
              <Stat label="Defects"><b className="font-semibold tabular-nums">{t.defects.toLocaleString('en-US')}</b> <span className="text-gray-500">({t.shareOfDone}% of done)</span></Stat>
              <Stat label="Top clients"><span className="tabular-nums">{f.topClients.length ? f.topClients.map(c => `${c.name} ${c.count}`).join(' · ') : 'none set'}</span></Stat>
              <Stat label="Top category">{top ? <><b className="font-semibold">{top.name}</b> <span className="text-gray-500 tabular-nums">{top.count}</span></> : '–'}</Stat>
              <Stat label="By month"><Spark months={f.months} values={f.perMonth} /></Stat>
            </div>

            <section>
              <ul className="divide-y divide-gray-100">
                {f.categories.map(c => <CategoryRow key={c.name} c={c} />)}
              </ul>
            </section>

            <section className="border-t border-gray-100 pt-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-800">AI analysis</h3>
                {guidance && <span className="text-xs text-gray-400">{guidance.model} · {ago(guidance.at)}{guidance.cached ? ' · saved for these numbers' : ''}</span>}
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
                  {guidance.caveats.map(c => <p key={c} className="text-xs text-gray-400">{c}</p>)}
                </div>
              )}
            </section>

            <p className="text-xs text-gray-400">
              {f.typesCounted.join(', ')} done in these months{f.typeFilterIgnored ? '; the Type filter is ignored here' : ''}. Categories are fixed and keyword-based on title, labels and component. Numbers change when you press Refresh on the report.
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

  const write = useCallback(async (force: boolean) => {
    setGuiding(true); setGuideError(null);
    try { setGuidance(await trendsApi.defectGuidance(months, filters, force)); }
    catch (e) { setGuideError(e instanceof Error ? e.message : 'Could not write the guidance'); }
    finally { setGuiding(false); }
  }, [months, filters]);

  // Rendered at the top of the page (not inside the report) so no parent can clip or cover it, and sized to the window: the header stays, the body scrolls.
  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ height: '100dvh' }}>
      <DefectAnalysisView data={data} loading={loading} error={error} guidance={guidance} guiding={guiding} guideError={guideError} onWrite={write} onClose={onClose} />
    </div>,
    document.body,
  );
};

export default DefectAnalysisModal;
