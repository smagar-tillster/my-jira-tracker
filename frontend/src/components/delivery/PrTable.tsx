import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyzeJob, DeliveryPr, GenerateJob, deliveryApi, generateBusy, reviewsApi } from '../../services/api';
import { ListControls, Modal, Section } from './shared';
import { filterRows, prSearchText } from './search';
import { useRefresh } from './RefreshContext';
import DefectRowButton from './DefectRow';
import { jobText, openPrReviews, prId, useCodeReview } from './useCodeReview';
import TenantGroupList from './TenantGroupList';
import { byCount } from './tenantGrouping';

const RISK: Record<string, string> = { low: 'bg-green-100 text-green-800', medium: 'bg-yellow-100 text-yellow-800', high: 'bg-red-100 text-red-800' };
const TONE: Record<string, string> = { ok: 'bg-green-100 text-green-800', warn: 'bg-red-100 text-red-800', info: 'bg-blue-100 text-blue-800' };
const REVIEW: Record<string, [string, string]> = {
  APPROVED: ['approved', 'bg-green-100 text-green-800'],
  CHANGES_REQUESTED: ['changes requested', 'bg-red-100 text-red-800'],
  REVIEW_REQUIRED: ['review required', 'bg-amber-100 text-amber-800'],
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));

/** Per-PR AI analysis on request. The backend runs scripts/analyze-pr.mjs (rules build the packet, a cheap model reads it). */
export function useAnalyze(onDone: () => void) {
  const [jobs, setJobs] = useState<Record<string, AnalyzeJob>>({});
  const timer = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const poll = useCallback(async () => {
    try {
      const next = await deliveryApi.analyzeStatus();
      setJobs(prev => {
        for (const [id, j] of Object.entries(next)) if (prev[id]?.state === 'running' && j.state === 'done') onDoneRef.current();
        return next;
      });
      if (!Object.values(next).some(j => j.state === 'running') && timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
    } catch { /* backend busy; try again on the next tick */ }
  }, []);

  useEffect(() => { poll(); return () => { if (timer.current !== null) window.clearInterval(timer.current); }; }, [poll]);

  const start = async (p: DeliveryPr) => {
    try {
      const j = await deliveryApi.analyzePr(p.repo, p.number);
      setJobs(prev => ({ ...prev, [j.id]: j }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || (e instanceof Error ? e.message : 'Could not start');
      setJobs(prev => ({ ...prev, [`${p.repo}#${p.number}`]: { id: `${p.repo}#${p.number}`, state: 'failed', startedAt: '', finishedAt: null, message: msg } }));
      return;
    }
    if (timer.current === null) timer.current = window.setInterval(poll, 3000);
  };
  return { jobs, start };
}

/** Merged PRs: "Analyze" is a link in the Details window; the analysis then shows right there. */
function AnalyzeLink({ p, job, onStart }: { p: DeliveryPr; job?: AnalyzeJob; onStart: (p: DeliveryPr) => void }) {
  if (job?.state === 'running') return <span className="text-sm text-blue-700">⏳ Analyzing… the analysis will appear here</span>;
  if (job?.state === 'queued') return <span className="text-sm text-amber-700" title={job.message}>Queued for a manual run</span>;
  const label = p.analysis && !p.rulesOnly ? '↻ Re-analyze' : 'Analyze this PR';
  return (
    <span className="inline-flex flex-col">
      <button onClick={() => onStart(p)} className="text-sm text-blue-600 hover:underline text-left">{label}</button>
      {job?.state === 'failed' && <span className="text-xs text-red-600" title={job.message}>failed: {job.message.slice(0, 100)}</span>}
    </span>
  );
}

const JOB_TONE: Record<string, string> = { info: 'text-blue-700', ok: 'text-green-700', warn: 'text-amber-700', err: 'text-red-600' };

const PILL = 'inline-block px-3 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap';
const PILL_BLUE = `${PILL} bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100`;
const PILL_INDIGO = `${PILL} bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100`;
const PILL_GREEN = `${PILL} bg-green-50 text-green-700 border-green-200 hover:bg-green-100`;

/** Open PRs: the review is written as a draft in the PR Reviews pill, which the user reads and posts by hand.
 *  Queued or running: a progress pill. Done (or a review already exists): "See PR review", which opens PR Reviews. */
function CodeReviewPill({ p, job, reviewed, onStart }: { p: DeliveryPr; job?: GenerateJob; reviewed: boolean; onStart: (p: DeliveryPr) => void }) {
  if (generateBusy(job)) return <span className={`${PILL} bg-amber-50 text-amber-800 border-amber-200`}>⏳ {job?.state === 'running' ? 'Reviewing…' : 'Queued'}</span>;
  if (job?.state === 'done' || job?.state === 'exists' || reviewed) return <button onClick={openPrReviews} className={PILL_GREEN} title="Opens PR Reviews">See PR review →</button>;
  const t = jobText(job);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button onClick={() => onStart(p)} className={PILL_INDIGO}>Initiate Code Review</button>
      {t && <span className={`text-[11px] max-w-[220px] ${JOB_TONE[t.tone]}`} title={job?.message}>{t.text.slice(0, 80)}</span>}
    </span>
  );
}

const List = ({ items }: { items?: string[] }) => <ul className="list-disc pl-5 space-y-1">{(items || []).map((s, i) => <li key={i}>{s}</li>)}</ul>;

function PrModal({ p, job, onStart, reviewJob, reviewed, onReview, onClose }: { p: DeliveryPr; job?: AnalyzeJob; onStart: (p: DeliveryPr) => void; reviewJob?: GenerateJob; reviewed: boolean; onReview: (p: DeliveryPr) => void; onClose: () => void }) {
  const a = p.analysis;
  const adds = p.files.reduce((s, f) => s + f.add, 0);
  const dels = p.files.reduce((s, f) => s + f.del, 0);
  return (
    <Modal title={`${p.repo}#${p.number} · ${p.line1}`}
      subtitle={<>{p.keys.join(', ') || 'no ticket'} · {p.author} · {p.open ? `opened ${dateOf(p.createdAt || '')}` : `merged ${dateOf(p.mergedAt || '')} ${timeOf(p.mergedAt || '')}`} · <a href={p.url} target="_blank" rel="noreferrer" className="underline">open on GitHub</a></>} onClose={onClose}>
      <Section title="What changed">
        <p className="mb-1">{p.files.length} files, +{adds} / −{dels}</p>
        {p.files.length > 0 && (
          <table className="w-full text-xs border border-gray-200"><tbody>
            {[...p.files].sort((x, y) => (y.add + y.del) - (x.add + x.del)).slice(0, 12).map(f => (
              <tr key={f.name} className="border-t border-gray-100 first:border-t-0"><td className="px-2 py-1 font-mono">{f.name}</td><td className="px-2 py-1 whitespace-nowrap">+{f.add} / −{f.del}</td></tr>
            ))}
          </tbody></table>
        )}
      </Section>
      <Section title="Depends on">
        {p.dependsOn.length ? <div className="flex flex-wrap gap-1.5">{p.dependsOn.map((d, i) => <span key={i} className={`px-2 py-0.5 rounded text-xs ${TONE[d.tone]}`}>{d.text}</span>)}</div>
          : <p className="text-gray-500">None found by the rules.</p>}
      </Section>
      <Section title="Understanding">
        {a ? (
          <div className="bg-blue-50 border border-blue-100 rounded p-3 space-y-2">
            <p className="text-xs text-gray-500">{a.ai === false ? `Rules-based summary (${a.basis}).` : `Reading of the diff and ticket (${a.basis}; ${a.generatedAt}). Verify before relying on it.`}</p>
            <p className="font-medium">{a.summary}</p>
            {a.how?.length > 0 && <><p className="text-xs text-gray-500">How it works</p><List items={a.how} /></>}
            {a.dependencies?.length > 0 && <><p className="text-xs text-gray-500">Dependencies (my reading)</p><List items={a.dependencies} /></>}
          </div>
        ) : <p className="text-gray-500">No analysis yet.</p>}
        <div className="mt-2">
          {p.open ? (!p.isDraft && <CodeReviewPill p={p} job={reviewJob} reviewed={reviewed} onStart={onReview} />) : <AnalyzeLink p={p} job={job} onStart={onStart} />}
        </div>
      </Section>
      {a?.confirm?.length ? <Section title="Please confirm"><List items={a.confirm} /></Section> : null}
    </Modal>
  );
}

function Understanding({ p }: { p: DeliveryPr }) {
  if (p.analysis && p.rulesOnly) return <><span className="px-1.5 py-0.5 rounded mr-1.5 bg-gray-100 text-gray-600">rules only</span>{p.analysis.summary}</>;
  if (p.analysis) return <><span className={`px-1.5 py-0.5 rounded mr-1.5 font-medium ${RISK[p.risk || 'low']}`}>{p.risk}</span>{p.analysis.summary}</>;
  if (p.aiRecommended) return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title={p.tierWhy}>Analysis recommended ({p.tierWhy})</span>;
  return <span className="text-gray-400">Not reviewed</span>;
}

/** "Fetch latest PRs": re-reads GitHub for the PR lists only (no Jira sprint or release sync), so it is much quicker than the full report. */
function FetchPrsButton() {
  const r = useRefresh();
  if (!r) return null;
  const mine = r.running && r.job?.kind === 'prs';
  const at = r.prsAt ? new Date(r.prsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <>
      <button onClick={r.fetchPrs} disabled={r.running}
        title={r.running && !mine ? 'The full report is running; PRs refresh with it' : 'Re-reads GitHub for open and merged PRs only. Quicker than the full report; releases are not refreshed.'}
        className="px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap">
        {mine ? '⏳ Fetching PRs…' : '⟳ Fetch latest PRs'}
      </button>
      {at && <span className="text-xs text-gray-500">PRs as of {at}</span>}
    </>
  );
}

const SHIP_TONE: Record<string, string> = { prod: 'bg-green-100 text-green-800', uat: 'bg-sky-100 text-sky-800', planned: 'bg-amber-100 text-amber-800' };

/** Where a merged PR's ticket went: the release tickets that carry it, with tenant, environment and date. */
function Shipped({ p }: { p: DeliveryPr }) {
  if (p.open) return null;
  const rows = p.shipped || [];
  if (!rows.length) return <div className="text-[11px] text-gray-400 mt-0.5 whitespace-normal" title="No release ticket dated on or after the merge lists this PR's ticket">not in a release yet</div>;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5 whitespace-normal">
      {rows.slice(0, 3).map(r => (
        <span key={r.key} className={`text-[11px] px-1.5 py-px rounded ${SHIP_TONE[r.released ? (/PROD/i.test(r.env) ? 'prod' : 'uat') : 'planned']}`}
          title={`${r.key} · ${r.tenant} · ${r.env} · ${r.date} · ${r.released ? 'released' : r.status}${p.shippedApprox ? ' · by ticket: it also has PRs in other repos, so this PR may not be in this release' : ''}`}>
          {p.shippedApprox ? '~' : ''}{/PROD/i.test(r.env) ? 'PROD' : 'UAT'} {r.tenant} {r.date.slice(5)}{r.released ? ' ✓' : ''}
        </span>
      ))}
      {rows.length > 3 && <span className="text-[11px] text-gray-500" title={rows.slice(3).map(r => `${r.key} ${r.tenant} ${r.env} ${r.date}`).join('\n')}>+{rows.length - 3} more</span>}
    </div>
  );
}

const prTenants = (p: DeliveryPr) => p.tenants;
const prRepo = (p: DeliveryPr) => [p.repo];
const GROUPS = [
  { id: 'client' as const, label: 'Client', hint: 'One group per tenant (a PR for several tenants appears under each)' },
  { id: 'repo' as const, label: 'Repo', hint: 'One group per repository' },
];
type GroupBy = typeof GROUPS[number]['id'];

/** What a collapsed repo group says: how many PRs, for which tenants, and drafts (open PRs). */
const repoSummary = (prs: DeliveryPr[], open?: boolean) => {
  const tenants = [...new Set(prs.flatMap(p => p.tenants))].sort();
  const parts = [`${prs.length} PR${prs.length === 1 ? '' : 's'}${tenants.length ? ` for ${tenants.length} tenant${tenants.length === 1 ? '' : 's'} (${tenants.slice(0, 6).join(', ')}${tenants.length > 6 ? ', …' : ''})` : ''}`];
  if (open) { const d = prs.filter(p => p.isDraft).length; if (d) parts.push(`${d} draft${d === 1 ? '' : 's'}`); }
  return parts.join(' · ');
};

/** What a collapsed tenant group says about its PRs: how many, in which repos, and (merged PRs) over how many days. */
const prSummary = (prs: DeliveryPr[], open?: boolean) => {
  const repos = [...new Set(prs.map(p => p.repo))];
  const days = [...new Set(prs.map(p => p.day).filter(Boolean))] as string[];
  const parts = [`${prs.length} PR${prs.length === 1 ? '' : 's'} in ${repos.length} repo${repos.length === 1 ? '' : 's'} (${repos.join(', ')})`];
  if (open) { const d = prs.filter(p => p.isDraft).length; if (d) parts.push(`${d} draft${d === 1 ? '' : 's'}`); }
  else if (days.length) parts.push(`${days.length} day${days.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
};

/** PRs grouped by tenant (across repos), dependencies on the PR's own line. Used for merged and open PRs ("open" adds draft/review/age). */
// The tenant with the most PRs first.
const mostFirst = byCount<DeliveryPr>();

export default function PrTable({ rows, open, empty, onChanged }: { rows: DeliveryPr[]; open?: boolean; empty: string; onChanged: () => void }) {
  const [shown, setShown] = useState<DeliveryPr | null>(null);
  const { jobs, start } = useAnalyze(onChanged);
  const review = useCodeReview(onChanged);
  const startReview = (p: DeliveryPr) => review.start([{ repo: p.repo, number: p.number }]);
  // PRs that already have a review in PR Reviews (any status): their pill reads "See PR review". Open PRs only.
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => reviewsApi.list().then(l => { if (alive) setReviewedIds(new Set(l.filter(r => r.status === 'draft' || r.status === 'posted').map(r => prId(r)))); }).catch(() => { /* the pill just offers to initiate */ });
    load();
    window.addEventListener('reviews-changed', load);
    return () => { alive = false; window.removeEventListener('reviews-changed', load); };
  }, [open]);
  const [groupBy, setGroupBy] = useState<GroupBy>('client');
  const [query, setQuery] = useState('');
  const [cmd, setCmd] = useState({ open: false, n: 0 });
  const [allOpen, setAllOpen] = useState(false);
  const toggleAll = () => setCmd(c => ({ open: !allOpen, n: c.n + 1 }));
  const visible = useMemo(() => filterRows(rows, query, prSearchText), [rows, query]);
  const byClient = groupBy === 'client';

  // keep the open modal in sync with refreshed rows
  const current = shown ? rows.find(r => r.id === shown.id) || shown : null;

  if (rows.length === 0) return (
    <>
      <div className="flex items-center gap-3 mb-2"><FetchPrsButton /></div>
      <div className="p-8 text-center text-gray-400">{empty}</div>
    </>
  );
  return (
    <>
      <ListControls groups={GROUPS} groupBy={groupBy} onGroupBy={setGroupBy} query={query} onQuery={setQuery} shown={visible.length} total={rows.length} unit="PR" extra={<FetchPrsButton />} allOpen={allOpen} onToggleAll={toggleAll} placeholder="Search PR #, ticket or title…" />
      {visible.length === 0 ? <div className="p-8 text-center text-gray-400">Nothing matches &ldquo;{query.trim()}&rdquo;.</div> : (
      <TenantGroupList command={cmd} onAllOpenChange={setAllOpen} items={visible} tenantsOf={byClient ? prTenants : prRepo} unit="PR" summary={prs => byClient ? prSummary(prs, open) : repoSummary(prs, open)}
        groupLabel={byClient ? 'tenant' : 'repo'} expandAll={!!query.trim()} order={mostFirst} orderLabel="most PRs first">
        {prs => (
            <table className="w-full table-fixed text-[14px] leading-[22px] [overflow-wrap:anywhere]">
              <thead className="bg-gray-50 text-left text-[13px] font-semibold text-gray-600 border-b border-gray-200">
                <tr><th className="px-2 py-[7px] w-[220px]">PR</th><th className="px-2 py-[7px] w-[250px]">Ticket</th><th className="px-2 py-[7px]">What it builds</th><th className="px-2 py-[7px] w-[30%]">Understanding</th></tr>
              </thead>
              <tbody>
                {prs.map(p => (
                  <tr key={p.id} className="border-t border-gray-100 align-middle hover:bg-gray-50">
                    <td className="px-2 py-[5.5px] whitespace-nowrap">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">{p.repo} #{p.number}</a>
                      {open && p.isDraft && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">draft</span>}
                      {p.defectFix && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-medium" title="The Jira ticket is a Defect, Bug or Incident">defect fix</span>}
                      <div className="text-xs text-gray-400">
                        {open ? `opened ${dateOf(p.createdAt || '')} · ${ageDays(p.createdAt || '')}d` : `${dateOf(p.mergedAt || '')} ${timeOf(p.mergedAt || '')}`}
                      </div>
                      {open && p.reviewDecision && REVIEW[p.reviewDecision] && <span className={`text-[11px] px-1.5 py-0.5 rounded ${REVIEW[p.reviewDecision][1]}`}>{REVIEW[p.reviewDecision][0]}</span>}
                    </td>
                    <td className="px-2 py-[5.5px] whitespace-nowrap">
                      {p.tickets.map(t => <div key={t.key}><a href={t.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{t.key}</a></div>)}
                      {p.tickets.length === 0 && <span className="text-gray-400">—</span>}
                      {p.tenants.length > 0 && <div className="text-xs text-gray-500 whitespace-normal break-words">{p.tenants.join(', ')}</div>}
                      <Shipped p={p} />
                    </td>
                    <td className="px-2 py-[5.5px]">
                      <div className="font-medium text-gray-800" title={p.meaning ? `${p.meaning}${p.meaningSource && p.meaningSource !== 'title' ? ` (from the ${p.meaningSource.replace('-', ' ')})` : ''}` : p.line1}>{p.line1}</div>
                      {p.line2 && <div className="text-xs text-gray-500 mt-0.5">{p.line2}</div>}
                      {p.dependsOn.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <span className="text-xs text-gray-500 mr-0.5">Depends on:</span>
                          {p.dependsOn.map((d, i) => (
                            d.url
                              ? <a key={i} href={d.url} target="_blank" rel="noreferrer" className={`px-1.5 py-0.5 rounded text-xs ${TONE[d.tone]} hover:opacity-80`}>{d.text}</a>
                              : <span key={i} className={`px-1.5 py-0.5 rounded text-xs ${TONE[d.tone]}`}>{d.text}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-[5.5px] text-xs text-gray-700">
                      <Understanding p={p} />
                      <div className="flex flex-wrap items-start gap-2 mt-2">
                        <button onClick={() => setShown(p)} className={PILL_BLUE}>Details</button>
                        {p.open && !p.isDraft && <CodeReviewPill p={p} job={review.jobs[prId(p)]} reviewed={reviewedIds.has(prId(p))} onStart={startReview} />}
                        <DefectRowButton p={p} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        )}
      </TenantGroupList>
      )}
      {current && <PrModal p={current} job={jobs[current.id]} onStart={start} reviewJob={review.jobs[prId(current)]} reviewed={reviewedIds.has(prId(current))} onReview={startReview} onClose={() => setShown(null)} />}
    </>
  );
}
