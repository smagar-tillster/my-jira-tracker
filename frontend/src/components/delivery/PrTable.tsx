import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalyzeJob, DeliveryPr, GenerateJob, deliveryApi, generateBusy } from '../../services/api';
import { Modal, Section } from './shared';
import { jobText, prId, useCodeReview } from './useCodeReview';
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

function AnalyzeButton({ p, job, onStart }: { p: DeliveryPr; job?: AnalyzeJob; onStart: (p: DeliveryPr) => void }) {
  if (job?.state === 'running') return <span className="text-xs text-blue-700">⏳ Analyzing…</span>;
  if (job?.state === 'queued') return <span className="text-xs text-amber-700" title={job.message}>Queued for a manual run</span>;
  const label = p.analysis && !p.rulesOnly ? '↻ Re-analyze' : 'Analyze';
  return (
    <span className="inline-flex flex-col">
      <button onClick={() => onStart(p)} className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-800 hover:bg-indigo-200 whitespace-nowrap">{label}</button>
      {job?.state === 'failed' && <span className="text-[11px] text-red-600 max-w-[160px]" title={job.message}>failed: {job.message.slice(0, 60)}</span>}
    </span>
  );
}

const JOB_TONE: Record<string, string> = { info: 'text-blue-700', ok: 'text-green-700', warn: 'text-amber-700', err: 'text-red-600' };

/** Open PRs: the review is written as a draft in the PR Reviews tab, which the user reads and posts by hand. */
function CodeReviewButton({ p, job, onStart }: { p: DeliveryPr; job?: GenerateJob; onStart: (p: DeliveryPr) => void }) {
  const t = jobText(job);
  return (
    <span className="inline-flex flex-col">
      {generateBusy(job)
        ? <span className="text-xs text-blue-700">⏳ {t?.text}</span>
        : <button onClick={() => onStart(p)} className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-800 hover:bg-indigo-200 whitespace-nowrap">Initiate Code Review</button>}
      {t && !generateBusy(job) && <span className={`text-[11px] max-w-[170px] ${JOB_TONE[t.tone]}`} title={job?.message}>{t.text.slice(0, 80)}</span>}
    </span>
  );
}

const List = ({ items }: { items?: string[] }) => <ul className="list-disc pl-5 space-y-1">{(items || []).map((s, i) => <li key={i}>{s}</li>)}</ul>;

function PrModal({ p, job, onStart, reviewJob, onReview, onClose }: { p: DeliveryPr; job?: AnalyzeJob; onStart: (p: DeliveryPr) => void; reviewJob?: GenerateJob; onReview: (p: DeliveryPr) => void; onClose: () => void }) {
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
          {p.open ? <CodeReviewButton p={p} job={reviewJob} onStart={onReview} /> : <AnalyzeButton p={p} job={job} onStart={onStart} />}
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

const prTenants = (p: DeliveryPr) => p.tenants;

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

  // keep the open modal in sync with refreshed rows
  const current = shown ? rows.find(r => r.id === shown.id) || shown : null;

  if (rows.length === 0) return <div className="p-8 text-center text-gray-400">{empty}</div>;
  return (
    <>
      <TenantGroupList items={rows} tenantsOf={prTenants} unit="PR" summary={prs => prSummary(prs, open)} order={mostFirst} orderLabel="most PRs first">
        {prs => (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-1.5">PR</th><th className="px-3 py-1.5">Ticket</th><th className="px-3 py-1.5">What it builds</th><th className="px-3 py-1.5">Understanding</th><th className="px-3 py-1.5"></th></tr>
              </thead>
              <tbody>
                {prs.map(p => (
                  <tr key={p.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">{p.repo} #{p.number}</a>
                      {open && p.isDraft && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">draft</span>}
                      <div className="text-xs text-gray-400">
                        {open ? `opened ${dateOf(p.createdAt || '')} · ${ageDays(p.createdAt || '')}d` : `${dateOf(p.mergedAt || '')} ${timeOf(p.mergedAt || '')}`}
                      </div>
                      {open && p.reviewDecision && REVIEW[p.reviewDecision] && <span className={`text-[11px] px-1.5 py-0.5 rounded ${REVIEW[p.reviewDecision][1]}`}>{REVIEW[p.reviewDecision][0]}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.tickets.map(t => <div key={t.key}><a href={t.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{t.key}</a></div>)}
                      {p.tickets.length === 0 && <span className="text-gray-400">—</span>}
                      {p.tenants.length > 0 && <div className="text-xs text-gray-500">{p.tenants.join(', ')}</div>}
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <div className="font-medium text-gray-800">{p.line1}</div>
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
                    <td className="px-3 py-2 max-w-sm text-xs text-gray-700"><Understanding p={p} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1.5">
                        <button onClick={() => setShown(p)} className="text-blue-600 hover:underline text-sm">Details</button>
                        {p.open
                          ? !p.isDraft && <CodeReviewButton p={p} job={review.jobs[prId(p)]} onStart={startReview} />
                          : (!p.analysis || p.rulesOnly) && <AnalyzeButton p={p} job={jobs[p.id]} onStart={start} />}
                        {!p.open && p.analysis && !p.rulesOnly && jobs[p.id]?.state === 'running' && <span className="text-xs text-blue-700">⏳ Analyzing…</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        )}
      </TenantGroupList>
      {current && <PrModal p={current} job={jobs[current.id]} onStart={start} reviewJob={review.jobs[prId(current)]} onReview={startReview} onClose={() => setShown(null)} />}
    </>
  );
}
