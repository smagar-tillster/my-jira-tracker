import { useCallback, useEffect, useRef, useState } from 'react';
import { deliveryApi, DeliveryMeta, RefreshJob, generateBusy, reviewsApi } from '../services/api';
import PrReviews from './PrReviews';
import { SUBTAB_KEY } from './delivery/useCodeReview';
import ReleasedTab from './delivery/ReleasedTab';
import ToReleaseTab from './delivery/ToReleaseTab';
import MergedPrsTab from './delivery/MergedPrsTab';
import OpenPrsTab from './delivery/OpenPrsTab';
import { RefreshContext } from './delivery/RefreshContext';

/** Time of day when it is today, with the date when it is older. */
const runTime = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${t}`;
};


type SubTab = 'released' | 'toRelease' | 'prs' | 'open' | 'reviews';

// The notification bell asks for the PR Reviews pill by leaving a note here; it is read once.
const takeRequestedTab = (): SubTab | null => {
  try { const v = sessionStorage.getItem(SUBTAB_KEY); sessionStorage.removeItem(SUBTAB_KEY); return v === 'reviews' ? 'reviews' : null; } catch { return null; }
};

/** Release & PRs: live data (no stored reports). "Run latest report" re-reads Jira and GitHub on demand; nothing is scheduled. */
export default function ReleasePrReports() {
  const [tab, setTab] = useState<SubTab>(() => takeRequestedTab() ?? 'released');
  const [reviewDrafts, setReviewDrafts] = useState<number | undefined>(undefined);
  const [busyReviews, setBusyReviews] = useState(0); // Initiate Code Review jobs waiting or running
  const [readyToasts, setReadyToasts] = useState<{ id: string; at: number }[]>([]);
  const prevBusy = useRef<Set<string>>(new Set());
  const [reviewsSeen, setReviewsSeen] = useState(false); // once opened, PR Reviews stays mounted (hidden) so its list and its cache survive switching pills
  const [meta, setMeta] = useState<DeliveryMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<RefreshJob | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pollRef = useRef<number | null>(null);

  const loadMeta = useCallback(async () => {
    try { setMeta(await deliveryApi.meta()); setError(null); setRefreshKey(k => k + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load delivery data'); }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  useEffect(() => {
    const open = () => { const t = takeRequestedTab(); if (t) setTab(t); };
    window.addEventListener('releases-subtab', open);
    return () => window.removeEventListener('releases-subtab', open);
  }, []);

  // Follow Initiate Code Review jobs: the pill shows how many are queued, and a toast appears only when one finishes (not when it is queued).
  const pollReviewJobs = useCallback(async () => {
    try {
      const next = await reviewsApi.generateStatus();
      const busyNow = new Set(Object.entries(next).filter(([, j]) => generateBusy(j)).map(([id]) => id));
      const finished = [...prevBusy.current].filter(id => next[id]?.state === 'done');
      prevBusy.current = busyNow;
      setBusyReviews(busyNow.size);
      if (finished.length) {
        setReadyToasts(t => [...t, ...finished.map(id => ({ id, at: Date.now() }))]);
        window.dispatchEvent(new Event('reviews-changed')); // the bell and the pill recount the drafts
      }
    } catch { /* backend busy: next tick */ }
  }, []);
  useEffect(() => {
    pollReviewJobs();
    window.addEventListener('reviews-queued', pollReviewJobs);
    return () => window.removeEventListener('reviews-queued', pollReviewJobs);
  }, [pollReviewJobs]);
  useEffect(() => {
    if (busyReviews === 0) return;
    const t = window.setInterval(pollReviewJobs, 3000);
    return () => window.clearInterval(t);
  }, [busyReviews, pollReviewJobs]);
  useEffect(() => {
    if (readyToasts.length === 0) return;
    const t = window.setTimeout(() => setReadyToasts(list => list.filter(x => Date.now() - x.at < 5000)), 5200);
    return () => window.clearTimeout(t);
  }, [readyToasts]);

  // the "done" pill for a finished run goes away after 5 seconds (a failed run stays until it is closed)
  const doneState = job && job.state !== 'idle' && job.state !== 'running' && job.state !== 'failed' ? job.state : null;
  useEffect(() => {
    if (!doneState) return;
    const t = window.setTimeout(() => setJob(null), 5000);
    return () => window.clearTimeout(t);
  }, [doneState, job?.kind]);

  // Count on the PR Reviews pill: drafts waiting to be read and posted. Quiet on failure.
  useEffect(() => {
    let alive = true;
    const poll = () => reviewsApi.summary().then(c => { if (alive) setReviewDrafts(c.draft || 0); }).catch(() => {});
    poll();
    window.addEventListener('reviews-changed', poll);
    window.addEventListener('focus', poll);
    return () => { alive = false; window.removeEventListener('reviews-changed', poll); window.removeEventListener('focus', poll); };
  }, []);

  const stopPolling = () => { if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPolling, []);

  const watch = () => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await deliveryApi.refreshStatus();
        setJob(s);
        if (s.state !== 'running') { stopPolling(); if (s.state === 'done') await loadMeta(); }
      } catch { /* backend may be restarting; keep polling */ }
    }, 2000);
  };

  const refresh = async () => {
    try { setJob(await deliveryApi.refresh()); watch(); }
    catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 409) { setJob(await deliveryApi.refreshStatus()); watch(); }
      else setError(e instanceof Error ? e.message : 'Could not start the report');
    }
  };

  const refreshPrs = async () => {
    try { setJob(await deliveryApi.refreshPrs()); watch(); }
    catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 409) { setJob(await deliveryApi.refreshStatus()); watch(); }
      else setJob({ state: 'failed', kind: 'prs', startedAt: null, finishedAt: null, log: [e instanceof Error ? e.message : 'Could not start the PR fetch'] });
    }
  };

  const refreshReleases = async () => {
    try { setJob(await deliveryApi.refreshReleases()); watch(); }
    catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 409) { setJob(await deliveryApi.refreshStatus()); watch(); }
      else setJob({ state: 'failed', kind: 'releases', startedAt: null, finishedAt: null, log: [e instanceof Error ? e.message : 'Could not start the releases refresh'] });
    }
  };

  useEffect(() => { if (tab === 'reviews') setReviewsSeen(true); }, [tab]);

  const running = job?.state === 'running';
  const prsAt = meta?.prsGeneratedAt || meta?.generatedAt || null;
  const tabs: { id: SubTab; label: string; count?: number }[] = [
    { id: 'released', label: '🚀 Released' },
    { id: 'toRelease', label: '⏰ To Release Today', count: meta?.counts.toRelease },
    { id: 'prs', label: '🔀 Merged PRs', count: meta?.counts.prsToday },
    { id: 'open', label: '📬 Open PRs', count: meta?.counts.openPrs },
    { id: 'reviews', label: '📝 PR Reviews', count: reviewDrafts },
  ];

  return (
    <RefreshContext.Provider value={{ fetchPrs: refreshPrs, refreshReleases, releasesAt: meta?.generatedAt || null, job, running, prsAt }}>
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={`inline-flex items-center gap-2 whitespace-nowrap shrink-0 px-4 py-1.5 text-sm font-medium rounded-full border transition-colors ${tab === t.id ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400'}`}>
            {t.label}{t.count !== undefined && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tab === t.id ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-700'}`}>{t.count}</span>}
            {t.id === 'reviews' && busyReviews > 0 && <span title="Code reviews waiting or running" className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">⏳ {busyReviews}</span>}
          </button>
        ))}
        {tab !== 'reviews' && <div className="ml-auto flex flex-col items-end gap-0.5 whitespace-nowrap">
          <button onClick={refresh} disabled={running}
            title="Re-reads Jira and GitHub and rebuilds the data on these tabs, then moves the 'since last run' marker for merged PRs."
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">
            {running ? (job?.kind === 'prs' ? '⏳ Fetching PRs…' : '⏳ Running…') : '▶ Run latest report'}
          </button>
          {meta && (
            <span className="text-[11px] leading-tight text-gray-500" title={meta.timing ? Object.entries(meta.timing.stages).map(([k, v]) => `${k}: ${v}s`).join('\n') : undefined}>
              Last run {runTime(meta.generatedAt)}{meta.timing && <> ({Math.round(meta.timing.totalSec)}s)</>}
            </span>
          )}
        </div>}
      </div>

      {tab !== 'reviews' && job && job.state === 'failed' && (
        <div className="px-4 py-2 text-sm border-b flex items-start gap-3 bg-red-50 text-red-800 border-red-200">
          <span className="font-medium">{job.kind === 'prs' ? 'Fetching PRs failed.' : job.kind === 'releases' ? 'Refreshing releases failed.' : 'The report run failed.'}</span>
          {job.log.length > 0 && (
            <details className="flex-1"><summary className="cursor-pointer">Run log</summary><pre className="mt-1 text-xs whitespace-pre-wrap max-h-40 overflow-auto">{job.log.join('\n')}</pre></details>
          )}
          <button onClick={() => setJob(null)} className="ml-auto text-gray-500 hover:text-gray-700">✕</button>
        </div>
      )}
      {tab !== 'reviews' && error && !meta && <div className="m-4 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error} — click “Run latest report” to build it now.</div>}

      {/* A finished run or review shows as a small pill at the top and goes away by itself after 5 seconds */}
      {((job && job.state !== 'idle' && job.state !== 'running' && job.state !== 'failed') || readyToasts.length > 0) && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
          {job && job.state !== 'idle' && job.state !== 'running' && job.state !== 'failed' && (
            <div className="pointer-events-auto px-4 py-1.5 bg-green-600 text-white rounded-full shadow-lg text-sm font-medium">
              ✓ {job.kind === 'prs' ? 'Latest PRs fetched' : job.kind === 'releases' ? 'Releases refreshed' : 'Latest report is ready'}
            </div>
          )}
          {readyToasts.filter(x => Date.now() - x.at < 5000).map(x => (
            <div key={`${x.id}-${x.at}`} className="pointer-events-auto flex items-center gap-2 pl-4 pr-2 py-1.5 bg-green-600 text-white rounded-full shadow-lg text-sm font-medium">
              <span>📝 Code review ready: {x.id}</span>
              <button onClick={() => { setTab('reviews'); setReadyToasts(l => l.filter(y => y !== x)); }} className="px-2 py-0.5 rounded-full bg-white text-green-700 text-xs hover:bg-green-50">Open</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {meta && tab === 'released' && <ReleasedTab meta={meta} refreshKey={refreshKey} />}
        {meta && tab === 'toRelease' && <ToReleaseTab meta={meta} refreshKey={refreshKey} />}
        {meta && tab === 'prs' && <MergedPrsTab meta={meta} refreshKey={refreshKey} />}
        {meta && tab === 'open' && <OpenPrsTab meta={meta} refreshKey={refreshKey} />}
        {(tab === 'reviews' || reviewsSeen) && <div className={tab === 'reviews' ? 'h-full' : 'hidden'}><PrReviews /></div>}
      </div>
    </div>
    </RefreshContext.Provider>
  );
}
