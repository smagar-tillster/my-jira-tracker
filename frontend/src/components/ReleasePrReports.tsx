import { useCallback, useEffect, useRef, useState } from 'react';
import { deliveryApi, DeliveryMeta, RefreshJob } from '../services/api';
import ReleasedTab from './delivery/ReleasedTab';
import ToReleaseTab from './delivery/ToReleaseTab';
import MergedPrsTab from './delivery/MergedPrsTab';
import OpenPrsTab from './delivery/OpenPrsTab';

type SubTab = 'released' | 'toRelease' | 'prs' | 'open';

/** Release & PRs: live data (no stored reports). "Run latest report" re-reads Jira and GitHub on demand; nothing is scheduled. */
export default function ReleasePrReports() {
  const [tab, setTab] = useState<SubTab>('released');
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

  const running = job?.state === 'running';
  const tabs: { id: SubTab; label: string; count?: number }[] = [
    { id: 'released', label: '🚀 Released' },
    { id: 'toRelease', label: '⏰ To Release Today', count: meta?.counts.toRelease },
    { id: 'prs', label: '🔀 Merged PRs', count: meta?.counts.prsToday },
    { id: 'open', label: '📬 Open PRs', count: meta?.counts.openPrs },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-4 pt-3 flex items-end gap-2">
        <span className="text-lg font-semibold text-gray-800 mr-3 pb-2">📦 Release &amp; PRs</span>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-100'}`}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full">{t.count}</span>}
          </button>
        ))}
        <div className="ml-auto pb-2 flex items-center gap-3">
          {meta && (
            <span className="text-xs text-gray-500" title={meta.timing ? Object.entries(meta.timing.stages).map(([k, v]) => `${k}: ${v}s`).join('\n') : undefined}>
              Data as of {new Date(meta.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {meta.timing && <> · last run took {Math.round(meta.timing.totalSec)}s</>}
            </span>
          )}
          <button onClick={refresh} disabled={running}
            title="Re-reads Jira and GitHub and rebuilds the data on these tabs, then moves the 'since last run' marker for merged PRs."
            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">
            {running ? '⏳ Running…' : '▶ Run latest report'}
          </button>
        </div>
      </div>

      {job && job.state !== 'idle' && job.state !== 'running' && (
        <div className={`px-4 py-2 text-sm border-b flex items-start gap-3 ${job.state === 'failed' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-green-50 text-green-800 border-green-200'}`}>
          <span className="font-medium">{job.state === 'failed' ? 'The report run failed.' : 'Latest report is ready.'}</span>
          {job.state === 'failed' && job.log.length > 0 && (
            <details className="flex-1"><summary className="cursor-pointer">Run log</summary><pre className="mt-1 text-xs whitespace-pre-wrap max-h-40 overflow-auto">{job.log.join('\n')}</pre></details>
          )}
          <button onClick={() => setJob(null)} className="ml-auto text-gray-500 hover:text-gray-700">✕</button>
        </div>
      )}
      {error && !meta && <div className="m-4 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error} — click “Run latest report” to build it now.</div>}

      <div className="flex-1 overflow-hidden">
        {meta && tab === 'released' && <ReleasedTab meta={meta} refreshKey={refreshKey} />}
        {meta && tab === 'toRelease' && <ToReleaseTab meta={meta} refreshKey={refreshKey} />}
        {meta && tab === 'prs' && <MergedPrsTab meta={meta} refreshKey={refreshKey} />}
        {meta && tab === 'open' && <OpenPrsTab meta={meta} refreshKey={refreshKey} />}
      </div>
    </div>
  );
}
