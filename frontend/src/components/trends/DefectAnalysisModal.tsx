import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trendsApi, DefectAnalysis, DefectCategory, DefectGuidance, DefectPatterns, PatternAdded, PatternDraft, RecordResult, TrendFilters, TrendMonths } from '../../services/api';
import { FE_COMPONENT, monthCounts, monthLabel, sparkline, toggleFeFixes, trendText, SERIES_COLORS } from '../../utils/trendsChart';

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
        {c.weak > 0 && <span className="text-sm text-gray-500 tabular-nums" title="Placed on the description or the PR title alone: the title, the fix component and the PR files gave no evidence">{c.weak} by description only</span>}
      </div>
      <p className="text-sm text-gray-600">{c.meaning}</p>
      <Line label="Fixed in">{c.fixedIn.map(x => `${x.name} ${x.pct}%`).join(' · ')}</Line>
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

/** What recording repeats did, in words. */
export const recordSummary = (r: RecordResult): string => {
  const n = r.updated.reduce((a, u) => a + u.added.length, 0);
  const parts: string[] = [];
  parts.push(r.updated.length ? `Updated ${r.updated.length} ${r.updated.length === 1 ? 'pattern' : 'patterns'} with ${n} ${n === 1 ? 'repeat' : 'repeats'} (${r.updated.map(u => `${u.id} now seen ${u.seen}`).join('; ')}).` : 'Nothing needed updating.');
  if (r.skipped.length) parts.push(`Left alone: ${r.skipped.map(s => `${s.id} (${s.reason})`).join('; ')}.`);
  if (r.ingest === 'ok') parts.push('Ingest ran.');
  if (r.ingest === 'failed') parts.push(`The files are updated but ingest failed: ${r.reason}`);
  return parts.join(' ');
};

/** The state of the pattern actions (record repeats, draft a pattern), kept next to the view so it can be rendered on its own. */
export interface PatternActions {
  recording: boolean; recordResult: RecordResult | null; recordError: string | null; onRecord: () => void;
  drafting: string | null; drafts: Record<string, PatternDraft>; draftErrors: Record<string, string>; onDraft: (cluster: string) => void;
  edits: Record<string, string>; onEdit: (cluster: string, text: string) => void;
  adding: string | null; added: Record<string, PatternAdded>; addErrors: Record<string, string>; onAdd: (cluster: string) => void;
}

/** What adding a pattern to the RAG did, in words. */
export const addedSummary = (a: PatternAdded): string =>
  `Added docs/defects/${a.id}.md to the RAG. It is a new, uncommitted file in the RAG's git working tree: run the RAG's tests and commit it. ${a.ingest === 'ok' ? 'Ingest ran.' : `The file is there but ingest failed: ${a.reason}`}`;

const newRepeats = (p: DefectPatterns) => p.matches.reduce((n, m) => n + m.tickets.length, 0);

const PatternsSection: React.FC<{ patterns: DefectPatterns } & PatternActions> = ({ patterns, recording, recordResult, recordError, onRecord, drafting, drafts, draftErrors, onDraft, edits, onEdit, adding, added, addErrors, onAdd }) => {
  const total = newRepeats(patterns);
  const copy = (text: string) => { try { navigator.clipboard?.writeText(text); } catch { /* the text is on screen to copy by hand */ } };
  return (
    <section aria-label="Defect patterns" className="pt-1 space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Defect patterns</h3>
        <p className="text-sm text-gray-500">Matched against the RAG's review patterns through the files each fix changed (PR ledger).</p>
      </div>
      {/* what was added stays here: once a pattern is added its group is matched and leaves the list below, so a message kept inside the group would vanish */}
      {Object.values(added).map(a => (
        <p key={a.id} className="px-3 py-2 text-sm bg-green-50 text-green-900 border border-green-200 rounded">{addedSummary(a)}</p>
      ))}
      {!patterns.ragFound ? (
        <p className="text-sm text-gray-700">The RAG's defect patterns were not found at {patterns.ragRoot}/docs/defects, so nothing can be matched.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700">{patterns.withPr} of {patterns.defects} defects have their fix PR in the ledger. {patterns.patternCount} {patterns.patternCount === 1 ? 'pattern is' : 'patterns are'} known{patterns.recorded ? `; ${patterns.recorded} ${patterns.recorded === 1 ? 'repeat is' : 'repeats are'} already recorded` : ''}.</p>

          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h4 className="text-sm font-semibold text-gray-900">Repeats of known patterns</h4>
              <button onClick={onRecord} disabled={recording || total === 0} title="Raises seen by one and adds the ticket to tickets in the matching pattern files in the RAG, then runs ingest. Nothing else in those files changes."
                className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed">
                {recording ? '⏳ Recording…' : total ? `Record ${total} ${total === 1 ? 'repeat' : 'repeats'}` : 'Nothing to record'}
              </button>
            </div>
            {patterns.matches.length === 0 && <p className="text-sm text-gray-600">No new repeats of an existing pattern.</p>}
            <ul className="space-y-1">
              {patterns.matches.map(m => (
                <li key={m.patternId} className="text-sm text-gray-900">
                  <span className="font-semibold">{m.patternId}</span> <span className="text-gray-600">(seen {m.seen}) · {m.tickets.length} new: {m.tickets.slice(0, 6).map(t => t.key).join(', ')}{m.tickets.length > 6 ? ' …' : ''}</span>
                </li>
              ))}
            </ul>
            {recordError && <p className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {recordError}</p>}
            {recordResult && <p className="px-3 py-2 text-sm bg-green-50 text-green-900 border border-green-200 rounded">{recordSummary(recordResult)}</p>}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">Possible new patterns</h4>
            {patterns.clusters.length === 0 && <p className="text-sm text-gray-600">No group of 3 or more defects without a pattern changed the same files.</p>}
            {patterns.clusters.map(c => {
              const draft = drafts[c.id];
              const current = edits[c.id] ?? draft?.text ?? '';
              const edited = draft?.text !== undefined && current !== draft.text;
              const shownProblems = edited ? [] : (draft?.problems ?? []).filter(p => !(draft?.needsCapability && /capabilities is empty/.test(p)));
              return (
                <div key={c.id} className="border border-gray-200 rounded-lg px-3 py-2 space-y-1.5">
                  <div className="flex items-start gap-3 flex-wrap">
                    <p className="text-sm text-gray-900 flex-1 min-w-[220px]">
                      <span className="font-semibold">{c.count} defects</span> changed <span className="font-mono text-xs">{c.files.join(', ') || 'the same files'}</span> in {c.repo}
                      <span className="text-gray-600"> (mostly {c.category.toLowerCase()}): {c.tickets.slice(0, 5).map(t => t.key).join(', ')}{c.tickets.length > 5 ? ' …' : ''}</span>
                    </p>
                    <button onClick={() => onDraft(c.id)} disabled={drafting !== null} title="One model call that drafts a pattern in the RAG's format. The draft is saved for review in this app's data folder; nothing is written to the RAG."
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed">
                      {drafting === c.id ? '⏳ Drafting…' : draft?.id ? 'Draft again' : 'Draft pattern'}
                    </button>
                  </div>
                  {drafting === c.id && <p className="text-xs text-gray-500">This takes about half a minute.</p>}
                  {draftErrors[c.id] && <p className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {draftErrors[c.id]}</p>}
                  {draft?.notAPattern && <p className="px-3 py-2 text-sm bg-gray-50 text-gray-800 border border-gray-200 rounded">The model does not think this is a pattern worth recording: {draft.reason}</p>}
                  {draft?.id && draft.text && (
                    <div className="space-y-1.5">
                      <p className="text-sm text-gray-700">Draft <span className="font-semibold">{draft.id}</span>, saved for review at <span className="font-mono text-xs">{draft.path}</span>. Nothing has been written to the RAG yet. Read it and edit it below; when you press Add to RAG it is checked again against the RAG's rules and added as <span className="font-mono text-xs">docs/defects/{draft.id}.md</span>.</p>
                      {draft.needsCapability && !edited && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">Pick a capability name from docs/implementations and put it on the capabilities line before adding it: the model did not name one that exists.</p>}
                      {shownProblems.length > 0 && (
                        <ul className="list-disc pl-5 text-sm text-amber-900">{shownProblems.map(p => <li key={p}>The RAG's checks would fail: {p}</li>)}</ul>
                      )}
                      <textarea value={current} onChange={e => onEdit(c.id, e.target.value)} rows={14} spellCheck={false} aria-label={`Draft pattern ${draft.id}`}
                        className="w-full text-xs font-mono bg-gray-50 border border-gray-200 rounded p-3 leading-relaxed" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => onAdd(c.id)} disabled={adding !== null || !!added[c.id]} title="Checks the text against the RAG's rules, creates the file in the RAG's docs/defects (never overwriting one), and runs ingest"
                          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed">{adding === c.id ? '⏳ Adding…' : added[c.id] ? 'Added' : 'Add to RAG'}</button>
                        <button onClick={() => copy(current)} className="px-3 py-1 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100">Copy</button>
                        {edited && <span className="text-xs text-gray-500">Edited. It is checked again when you add it.</span>}
                      </div>
                      {addErrors[c.id] && <p className="px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">❌ {addErrors[c.id]}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
};

export interface DefectViewProps {
  data: DefectAnalysis | null; loading: boolean; error: string | null;
  guidance: DefectGuidance | null; guiding: boolean; guideError: string | null;
  feOnly: boolean; onToggleFe: () => void;
  actions: PatternActions;
  onWrite: (force: boolean) => void; onClose: () => void;
}

/** The defect analysis for given data. No loading here, so it can be rendered on its own. */
export const DefectAnalysisView: React.FC<DefectViewProps> = ({ data, loading, error, guidance, guiding, guideError, feOnly, onToggleFe, actions, onWrite, onClose }) => {
  const f = data?.facts;
  const t = f?.tiles;
  const top = f?.categories.find(c => !c.name.startsWith('Other')) ?? f?.categories[0];
  const range = f ? `${monthLabel(f.months[0]).full} to ${monthLabel(f.months[f.months.length - 1]).full}` : '';

  return (
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full min-h-0" role="dialog" aria-modal="true" aria-labelledby="defect-title">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 shrink-0">
        <h2 id="defect-title" className="text-base font-semibold text-gray-900">Defect analysis</h2>
        {f && <span className="text-xs text-gray-500">{range} · {data?.scope}</span>}
        <button onClick={onToggleFe} aria-pressed={feOnly} title="Only defects whose fix was made in the FE component (the Jira component developers set when the final fix is done)"
          className={`ml-auto px-3 py-1 rounded-lg text-sm font-medium ring-1 ${feOnly ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'}`}>FE fixes</button>
        <button onClick={onClose} aria-label="Close" autoFocus className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100">✕</button>
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

            <section aria-label="By category" className="pt-1">
              <h3 className="text-base font-semibold text-gray-900">By category</h3>
              <p className="text-sm text-gray-500 mb-1">Decided from the title, the component the fix was made in, the files the fix changed (PR ledger) and the description. The same categories every time.</p>
              <ul className="divide-y divide-gray-100">
                {f.categories.map(c => <CategoryRow key={c.name} c={c} />)}
              </ul>
            </section>

            {data?.patterns && <PatternsSection patterns={data.patterns} {...actions} />}

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

            <p className="text-xs text-gray-500">
              {f.typesCounted.join(', ')} done in these months{f.typeFilterIgnored ? '; the Type filter is ignored here' : ''}. The PR ledger holds the fix PR for {f.prCoverage.withPr} of {f.prCoverage.defects} defects; the others are placed by title, component and description. Numbers change when you press Refresh on the report.
            </p>
          </>
        ))}
      </div>
    </div>
  );
};

/** The modal: loads the analysis for the page's months and filters, and asks for the written guidance on request. */
const DefectAnalysisModal: React.FC<{ months: TrendMonths; filters: TrendFilters; onClose: () => void }> = ({ months, filters: pageFilters, onClose }) => {
  // the modal starts from the report's filters and can flip FE fixes on its own, without changing the report behind it
  const [filters, setFilters] = useState<TrendFilters>(pageFilters);
  const [data, setData] = useState<DefectAnalysis | null>(null);
  const [guidance, setGuidance] = useState<DefectGuidance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guiding, setGuiding] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordResult, setRecordResult] = useState<RecordResult | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PatternDraft>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, PatternAdded>>({});
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
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

  const record = useCallback(async () => {
    setRecording(true); setRecordError(null); setRecordResult(null);
    try {
      setRecordResult(await trendsApi.recordRepeats(months, filters));
      setData(await trendsApi.defects(months, filters));        // the recorded repeats are no longer waiting
    } catch (e) { setRecordError(e instanceof Error ? e.message : 'Could not record the repeats'); }
    finally { setRecording(false); }
  }, [months, filters]);

  const draft = useCallback(async (cluster: string) => {
    setDrafting(cluster); setDraftErrors(({ [cluster]: _gone, ...rest }) => rest);
    try {
      const d = await trendsApi.draftPattern(months, filters, cluster);
      setDrafts(prev => ({ ...prev, [cluster]: d }));
      const drop = <T,>(m: Record<string, T>) => { const { [cluster]: _gone, ...rest } = m; return rest; };
      setEdits(drop); setAdded(drop); setAddErrors(drop);        // a new draft starts clean
    }
    catch (e) { setDraftErrors(prev => ({ ...prev, [cluster]: e instanceof Error ? e.message : 'Could not draft the pattern' })); }
    finally { setDrafting(null); }
  }, [months, filters]);

  const add = useCallback(async (cluster: string) => {
    const text = edits[cluster] ?? drafts[cluster]?.text;
    if (!text) return;
    setAdding(cluster); setAddErrors(({ [cluster]: _gone, ...rest }) => rest);
    try {
      const a = await trendsApi.addPattern(text);
      setAdded(prev => ({ ...prev, [cluster]: a }));
      setData(await trendsApi.defects(months, filters));         // the new pattern is part of the matching now
    } catch (e) { setAddErrors(prev => ({ ...prev, [cluster]: e instanceof Error ? e.message : 'Could not add the pattern' })); }
    finally { setAdding(null); }
  }, [edits, drafts, months, filters]);

  // Rendered at the top of the page (not inside the report) so no parent can clip or cover it, and sized to the window: the header stays, the body scrolls.
  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ height: '100dvh' }}>
      <DefectAnalysisView data={data} loading={loading} error={error} guidance={guidance} guiding={guiding} guideError={guideError} feOnly={(filters.component ?? []).includes(FE_COMPONENT)} onToggleFe={() => setFilters(toggleFeFixes(filters))} actions={{ recording, recordResult, recordError, onRecord: record, drafting, drafts, draftErrors, onDraft: draft, edits, onEdit: (c: string, t: string) => setEdits(prev => ({ ...prev, [c]: t })), adding, added, addErrors, onAdd: add }} onWrite={write} onClose={onClose} />
    </div>,
    document.body,
  );
};

export default DefectAnalysisModal;
