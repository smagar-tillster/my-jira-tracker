import { useCallback, useEffect, useState } from 'react';
import { deliveryApi, DeliveryMeta, DeliveryPr } from '../../services/api';
import PrTable from './PrTable';

/** Merged PRs: stored by merge date (every report run adds the PRs merged since the previous run). Default today; pick From/To to look back. */
export default function MergedPrsTab({ refreshKey }: { meta: DeliveryMeta; refreshKey: number }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<DeliveryPr[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deliveryApi.prs({ from, to })
      .then(r => { if (!cancelled) { setRows(r.rows); setRange({ from: r.from, to: r.to }); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load PRs'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, refreshKey, tick]);

  const repos = new Set(rows.map(r => r.repo)).size;
  const pending = rows.filter(r => r.aiRecommended).length;
  const custom = !!(from || to);

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 text-sm text-gray-600">From
          <input type="date" value={from || range?.from || ''} onChange={e => { setFrom(e.target.value); if (!to) setTo(e.target.value); }} className="px-2 py-1 border border-gray-300 rounded-lg text-sm" />
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-600">To
          <input type="date" value={to || range?.to || ''} onChange={e => setTo(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-sm" />
        </label>
        {custom && <button onClick={() => { setFrom(''); setTo(''); }} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Today</button>}
        {pending > 0 && <span className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded px-2 py-1">{pending} complex PR{pending === 1 ? '' : 's'}: analysis recommended</span>}
        <span className="text-sm text-gray-500 ml-auto">{rows.length} PR{rows.length === 1 ? '' : 's'} in {repos} repo{repos === 1 ? '' : 's'} · merged by date; each run adds PRs since the previous run</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error && <div className="mb-3 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error}</div>}
        {loading && rows.length === 0 ? <p className="text-sm text-gray-500">Loading…</p>
          : <PrTable rows={rows} empty="No PRs merged in these dates." onChanged={load} />}
      </div>
    </div>
  );
}
