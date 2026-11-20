import { useCallback, useEffect, useState } from 'react';
import { deliveryApi, DeliveryMeta, DeliveryPr } from '../../services/api';
import PrTable from './PrTable';

/** Open PRs: same format as merged ones, fully scripted (files, dependencies, tickets, tenants). AI analysis only when asked, per PR. */
export default function OpenPrsTab({ refreshKey }: { meta: DeliveryMeta; refreshKey: number }) {
  const [rows, setRows] = useState<DeliveryPr[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [hideDrafts, setHideDrafts] = useState(false);
  const load = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deliveryApi.openPrs()
      .then(r => { if (!cancelled) { setRows(r.rows); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load open PRs'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey, tick]);

  const shown = hideDrafts ? rows.filter(r => !r.isDraft) : rows;
  const drafts = rows.filter(r => r.isDraft).length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto p-4">
        {error && <div className="mb-3 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error}</div>}
        {loading && rows.length === 0 ? <p className="text-sm text-gray-500">Loading…</p>
          : <PrTable rows={shown} open empty={rows.length ? 'Only drafts are open; untick Hide drafts to see them.' : 'No open PRs in the tracked repos.'} onChanged={load}
              controls={<label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={hideDrafts} onChange={e => setHideDrafts(e.target.checked)} className="w-4 h-4" />Hide drafts ({drafts})
              </label>} />}
      </div>
    </div>
  );
}
