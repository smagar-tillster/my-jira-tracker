import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyzeJob, DeliveryPr, deliveryApi } from '../../services/api';
import { Modal, Section } from './shared';

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
  if (job?.state === 'queued') return <span className="text-xs text-amber-700" title={job.message}>Queued for Claude <span className="text-gray-400">(CLI not signed in)</span></span>;
  const label = p.analysis && !p.rulesOnly ? '↻ Re-analyze' : '✨ Analyze with AI';
  return (
    <span className="inline-flex flex-col">
      <button onClick={() => onStart(p)} className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-800 hover:bg-indigo-200 whitespace-nowrap">{label}</button>
      {job?.state === 'failed' && <span className="text-[11px] text-red-600 max-w-[160px]" title={job.message}>failed: {job.message.slice(0, 60)}</span>}
    </span>
  );
}

const List = ({ items }: { items?: string[] }) => <ul className="list-disc pl-5 space-y-1">{(items || []).map((s, i) => <li key={i}>{s}</li>)}</ul>;

function PrModal({ p, job, onStart, onClose }: { p: DeliveryPr; job?: AnalyzeJob; onStart: (p: DeliveryPr) => void; onClose: () => void }) {
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
            <p className="text-xs text-gray-500">{a.ai === false ? `Not AI-reviewed (${a.basis}).` : `AI-assisted reading of the diff and ticket (${a.basis}; ${a.generatedAt}). Verify before relying on it.`}</p>
            <p className="font-medium">{a.summary}</p>
            {a.how?.length > 0 && <><p className="text-xs text-gray-500">How it works</p><List items={a.how} /></>}
            {a.dependencies?.length > 0 && <><p className="text-xs text-gray-500">Dependencies (my reading)</p><List items={a.dependencies} /></>}
          </div>
        ) : <p className="text-gray-500">No AI analysis yet.</p>}
        <div className="mt-2"><AnalyzeButton p={p} job={job} onStart={onStart} /></div>
      </Section>
      {a?.confirm?.length ? <Section title="Please confirm"><List items={a.confirm} /></Section> : null}
    </Modal>
  );
}

function Understanding({ p }: { p: DeliveryPr }) {
  if (p.analysis && p.rulesOnly) return <><span className="px-1.5 py-0.5 rounded mr-1.5 bg-gray-100 text-gray-600">rules only</span>{p.analysis.summary}</>;
  if (p.analysis) return <><span className={`px-1.5 py-0.5 rounded mr-1.5 font-medium ${RISK[p.risk || 'low']}`}>{p.risk}</span>{p.analysis.summary}</>;
  if (p.aiRecommended) return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title={p.tierWhy}>AI recommended ({p.tierWhy})</span>;
  return <span className="text-gray-400">Not reviewed</span>;
}

/** PRs grouped by repo, dependencies on the PR's own line. Used for merged and open PRs ("open" adds draft/review/age). */
export default function PrTable({ rows, open, empty, onChanged }: { rows: DeliveryPr[]; open?: boolean; empty: string; onChanged: () => void }) {
  const [shown, setShown] = useState<DeliveryPr | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { jobs, start } = useAnalyze(onChanged);

  const byRepo = useMemo(() => {
    const m = new Map<string, DeliveryPr[]>();
    for (const p of rows) m.set(p.repo, [...(m.get(p.repo) || []), p]);
    return [...m.entries()];
  }, [rows]);
  // keep the open modal in sync with refreshed rows
  const current = shown ? rows.find(r => r.id === shown.id) || shown : null;
  const toggle = (repo: string) => setCollapsed(prev => { const n = new Set(prev); n.has(repo) ? n.delete(repo) : n.add(repo); return n; });

  if (rows.length === 0) return <div className="p-8 text-center text-gray-400">{empty}</div>;
  return (
    <div className="space-y-3">
      {byRepo.map(([repo, prs]) => (
        <div key={repo} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <button onClick={() => toggle(repo)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
            <span className="text-gray-400">{collapsed.has(repo) ? '▶' : '▼'}</span>
            <span className="font-semibold text-gray-800">{repo}</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{prs.length}</span>
          </button>
          {!collapsed.has(repo) && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-1.5">PR</th><th className="px-3 py-1.5">Ticket</th><th className="px-3 py-1.5">What it builds</th><th className="px-3 py-1.5">Understanding</th><th className="px-3 py-1.5"></th></tr>
              </thead>
              <tbody>
                {prs.map(p => (
                  <tr key={p.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">#{p.number}</a>
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
                        {(!p.analysis || p.rulesOnly) && <AnalyzeButton p={p} job={jobs[p.id]} onStart={start} />}
                        {p.analysis && !p.rulesOnly && jobs[p.id]?.state === 'running' && <span className="text-xs text-blue-700">⏳ Analyzing…</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {current && <PrModal p={current} job={jobs[current.id]} onStart={start} onClose={() => setShown(null)} />}
    </div>
  );
}
