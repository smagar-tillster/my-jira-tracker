import { useEffect, useMemo, useState } from 'react';
import { deliveryApi, DeliveryMeta, DeliveryRelease } from '../../services/api';
import ReleaseTable from './ReleaseTable';
import { MultiSelect } from './shared';
import ReleaseSummaryModal from './ReleaseSummaryModal';
import { RELEASE_TYPES, filterByType } from './releaseSummary';

/** Released: defaults to the last released day; pick a date or a from/to range; filter by tenant and env. */
export default function ReleasedTab({ meta, refreshKey }: { meta: DeliveryMeta; refreshKey: number }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tenants, setTenants] = useState<string[]>([]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [allRows, setRows] = useState<DeliveryRelease[]>([]);
  const rows = useMemo(() => filterByType(allRows, types), [allRows, types]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deliveryApi.released({ from, to, tenants, envs })
      .then(r => { if (!cancelled) { setRows(r.rows); setRange({ from: r.from, to: r.to }); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load releases'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, tenants, envs, refreshKey]);

  const released = rows.filter(r => r.released).length;
  const filtered = !!(from || to) || tenants.length > 0 || envs.length > 0 || types.length > 0;

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 text-sm text-gray-600">From
          <input type="date" value={from || range?.from || ''} onChange={e => { setFrom(e.target.value); if (!to) setTo(e.target.value); }}
            className="px-2 py-1 border border-gray-300 rounded-lg text-sm" />
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-600">To
          <input type="date" value={to || range?.to || ''} onChange={e => setTo(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-sm" />
        </label>
        <MultiSelect label="Tenant" options={meta.tenants} value={tenants} onChange={setTenants} />
        <MultiSelect label="Env" options={meta.envs} value={envs} onChange={setEnvs} tone="indigo" />
        <MultiSelect label="Type" options={RELEASE_TYPES} value={types} onChange={setTypes} />
        {filtered && (
          <button onClick={() => { setFrom(''); setTo(''); setTenants([]); setEnvs([]); setTypes([]); }}
            title={`Back to the last released day${meta.lastReleasedDay ? ` (${meta.lastReleasedDay})` : ''} with no tenant, env or type filter`}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 ring-1 ring-gray-300 hover:bg-gray-200 whitespace-nowrap">✕ Clear filters</button>
        )}
        <button onClick={() => setSummaryOpen(true)} disabled={rows.length === 0}
          className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">Release summary</button>
        <span className="text-sm text-gray-500 ml-auto">{rows.length} release ticket{rows.length === 1 ? '' : 's'} · {released} released</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error && <div className="mb-3 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error}</div>}
        {loading && rows.length === 0 ? <p className="text-sm text-gray-500">Loading…</p>
          : <ReleaseTable rows={rows} empty="No releases for these dates and filters." />}
      </div>
      {summaryOpen && <ReleaseSummaryModal rows={rows} range={range} onClose={() => setSummaryOpen(false)} />}
    </div>
  );
}
