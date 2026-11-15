import React, { useCallback, useEffect, useRef, useState } from 'react';
import { trendsApi, DefectAnalysis, DefectGuidance, FocusItem, TrendFilters, TrendMonths } from '../../services/api';
import { monthCounts, monthLabel, trendText, SERIES_COLORS, OTHER_COLOR } from '../../utils/trendsChart';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const Tile: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-gray-50 rounded-lg px-3 py-2.5 flex-1 min-w-[150px]">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-xl font-semibold text-gray-900 tabular-nums truncate" title={value}>{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const Heading: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}{hint && <span className="ml-2 font-normal text-xs text-gray-400">{hint}</span>}</h3>
);

const TONE: Record<string, string> = { up: 'text-red-700', down: 'text-green-700', flat: 'text-gray-500', none: 'text-gray-400' };

const FocusList: React.FC<{ items: FocusItem[] }> = ({ items }) => (
  <ol className="space-y-3">
    {items.map((f, i) => (
      <li key={`${f.title}-${i}`} className="text-sm text-gray-800">
        <div className="font-semibold">{i + 1}. {f.title}</div>
        <p className="text-gray-700">{f.why}</p>
        <ul className="list-disc pl-5 mt-1 text-gray-700">{f.actions.map(a => <li key={a}>{a}</li>)}</ul>
        {f.measure && <p className="text-xs text-gray-500 mt-1">How you would know: {f.measure}</p>}
      </li>
    ))}
  </ol>
);

export interface DefectViewProps {
  data: DefectAnalysis | null; loading: boolean; error: string | null;
  guidance: DefectGuidance | null; guiding: boolean; guideError: string | null;
  onWrite: (force: boolean) => void; onClose: () => void;
}

/** The defect analysis for given data. No loading here, so it can be rendered on its own. */
export const DefectAnalysisView: React.FC<DefectViewProps> = ({ data, loading, error, guidance, guiding, guideError, onWrite, onClose }) => {
  const f = data?.facts;
  const t = f?.tiles;
  const maxCat = f ? Math.max(1, ...f.categories.map(c => c.count)) : 1;
  const top = f?.categories[0];
  const range = f ? `${monthLabel(f.months[0]).full} to ${monthLabel(f.months[f.months.length - 1]).full}` : '';

  return (
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-6" role="dialog" aria-modal="true" aria-labelledby="defect-title">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200">
        <h2 id="defect-title" className="text-base font-semibold text-gray-900">Defect analysis</h2>
        {f && <span className="text-xs text-gray-500">{range} · {data?.scope}</span>}
        <button onClick={onClose} aria-label="Close" autoFocus className="ml-auto px-2 py-1 rounded text-gray-500 hover:bg-gray-100">✕</button>
      </div>

      <div className="px-5 py-4 space-y-5">
        {error && <div className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {error}</div>}
        {!data && loading && <p className="text-sm text-gray-500">Analyzing…</p>}

        {f && t && (t.defects === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No defects were done in these months with these filters. Clear a filter on the Trends page, or press Refresh there if you have not read Jira yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Tile label="Defects done" value={t.defects.toLocaleString('en-US')} sub={`${t.shareOfDone}% of ${plural(t.ticketsDone, 'ticket')} done`} />
              <Tile label="Median days to fix" value={t.medianDaysToFix === null ? '–' : String(t.medianDaysToFix)}
                sub={t.medianDaysRecent !== null && t.medianDaysEarlier !== null ? `${t.medianDaysRecent} recent, ${t.medianDaysEarlier} earlier` : 'created to done'} />
              <Tile label="Found in UAT" value={`${t.uatShare}%`} sub={`${plural(t.uat, 'UAT defect')}`} />
              <Tile label="Biggest category" value={top ? top.name : '–'} sub={top ? `${plural(top.count, 'defect')}, ${top.share}%` : undefined} />
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs text-gray-600" aria-label="Defects per month">
              {monthCounts(f.months, f.perMonth).map(m => <span key={m.month} className="px-2 py-0.5 rounded-full bg-gray-100 tabular-nums">{m.label} <b className="font-semibold text-gray-900">{m.count}</b></span>)}
              <span className="px-1 py-0.5 text-gray-400">defects done per month</span>
            </div>

            <section>
              <Heading title="Where defects come from" hint="category picked by keywords in the ticket title, labels and component" />
              <div className="overflow-auto border border-gray-200 rounded-md">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-gray-50 text-gray-600"><tr>
                    <th className="text-left font-medium px-3 py-1.5">Category</th><th className="text-right font-medium px-3 py-1.5">Defects</th><th className="px-3 py-1.5 w-32" />
                    <th className="text-right font-medium px-3 py-1.5">Share</th><th className="text-right font-medium px-3 py-1.5" title="Change in defects per month, recent half against the earlier half">Trend</th><th className="text-right font-medium px-3 py-1.5">Median fix</th>
                  </tr></thead>
                  <tbody>
                    {f.categories.map(c => {
                      const tr = trendText(c.changePct);
                      return (
                        <tr key={c.name} className="border-t border-gray-100 align-top">
                          <td className="px-3 py-1.5">
                            <div className="text-gray-900">{c.name}</div>
                            {c.examples.length > 0 && <div className="text-xs text-gray-400" title={c.examples.map(e => `${e.key} ${e.summary}`).join('\n')}>{c.examples.slice(0, 2).map(e => `${e.key} ${clip(e.summary, 48)}`).join(' · ')}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{c.count}</td>
                          <td className="px-3 py-2"><span aria-hidden className="block h-2 rounded-sm" style={{ width: `${(c.count / maxCat) * 100}%`, background: c.name.startsWith('Other') ? OTHER_COLOR : SERIES_COLORS[0] }} /></td>
                          <td className="px-3 py-1.5 text-right text-gray-700">{c.share}%</td>
                          <td className={`px-3 py-1.5 text-right ${TONE[tr.tone]}`} title={c.changePct === null ? 'Too few defects in the earlier half to give a percentage' : 'Defects per month, recent half against the earlier half'}>{tr.arrow} {tr.text}</td>
                          <td className="px-3 py-1.5 text-right text-gray-700">{c.medianDaysToFix === null ? '–' : `${c.medianDaysToFix} d`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <section>
                <Heading title="Client hot spots" hint={`defects per 100 done tickets (average ${f.averagePer100}); clients with ${f.minClientDone}+ done`} />
                {f.clients.length === 0 ? <p className="text-sm text-gray-400">No client has enough done tickets for a rate.</p> : (
                  <table className="w-full text-sm tabular-nums border border-gray-200 rounded-md">
                    <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left font-medium px-3 py-1.5">Client</th><th className="text-right font-medium px-3 py-1.5">Defects</th><th className="text-right font-medium px-3 py-1.5">Per 100</th><th className="text-right font-medium px-3 py-1.5">× avg</th></tr></thead>
                    <tbody>{f.clients.map(c => (
                      <tr key={c.name} className="border-t border-gray-100"><td className="px-3 py-1.5 text-gray-900">{c.name}</td><td className="px-3 py-1.5 text-right">{c.defects}</td><td className="px-3 py-1.5 text-right font-semibold text-gray-900">{c.per100}</td><td className="px-3 py-1.5 text-right text-gray-600">{c.times ?? '–'}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </section>
              <section>
                <Heading title="Repeats" hint="two words that recur in 3+ defect titles" />
                {f.repeats.length === 0 ? <p className="text-sm text-gray-400">No phrase repeats in 3 or more defects.</p> : (
                  <table className="w-full text-sm tabular-nums border border-gray-200 rounded-md">
                    <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left font-medium px-3 py-1.5">Phrase</th><th className="text-right font-medium px-3 py-1.5">Defects</th><th className="text-right font-medium px-3 py-1.5">Clients</th></tr></thead>
                    <tbody>{f.repeats.map(r => (
                      <tr key={r.phrase} className="border-t border-gray-100"><td className="px-3 py-1.5 text-gray-900" title={r.keys.join(', ')}>{r.phrase}</td><td className="px-3 py-1.5 text-right font-semibold text-gray-900">{r.count}</td><td className="px-3 py-1.5 text-right text-gray-600">{r.clients || '–'}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </section>
            </div>

            <section>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Where to focus</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{guidance ? 'AI-written from the numbers above' : 'From the rules (no AI yet)'}</span>
                <button onClick={() => onWrite(!!guidance)} disabled={guiding}
                  className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed">
                  {guiding ? '⏳ Writing…' : guidance ? '↻ Write again' : 'Write guidance with AI'}
                </button>
              </div>
              {guideError && <div className="mb-2 px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {guideError} The rule-based list below is still valid.</div>}
              {guiding && <p className="text-xs text-gray-500 mb-2">This takes about half a minute.</p>}
              <div className="bg-gray-50 rounded-lg px-4 py-3">
                {guidance ? (
                  <>
                    {guidance.headline && <p className="text-sm font-medium text-gray-900 mb-3">{guidance.headline}</p>}
                    <FocusList items={guidance.focus} />
                    {guidance.caveats.length > 0 && <ul className="list-disc pl-5 mt-3 text-xs text-gray-500">{guidance.caveats.map(c => <li key={c}>{c}</li>)}</ul>}
                    <p className="text-xs text-gray-400 mt-3">Written by AI ({guidance.model}) {ago(guidance.at)}{guidance.cached ? ', saved for these numbers' : ''}. Treat each point as a lead to check, not a finding.</p>
                  </>
                ) : (
                  <>
                    <FocusList items={data?.ruleFocus ?? []} />
                    <p className="text-xs text-gray-400 mt-3">Ranked by size and growth. Based on titles, labels and dates only; it cannot see root causes.</p>
                  </>
                )}
              </div>
            </section>

            <p className="text-xs text-gray-400">
              Counted: {f.typesCounted.join(', ')} done in these months{f.typeFilterIgnored ? '. The Type filter on the page is ignored here' : ''}. Numbers change when you press Refresh on the Trends page.
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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-auto flex items-start justify-center px-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <DefectAnalysisView data={data} loading={loading} error={error} guidance={guidance} guiding={guiding} guideError={guideError} onWrite={write} onClose={onClose} />
    </div>
  );
};

export default DefectAnalysisModal;
