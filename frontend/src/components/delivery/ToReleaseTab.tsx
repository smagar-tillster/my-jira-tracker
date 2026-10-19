import { useEffect, useState } from 'react';
import { deliveryApi, DeliveryMeta, DeliveryRelease } from '../../services/api';
import ReleaseTable from './ReleaseTable';
import { MultiSelect, dayLabel } from './shared';

/** To Release Today: always today. Red status = at least one ticket is not ready; green = everything is ready. */
export default function ToReleaseTab({ meta, refreshKey }: { meta: DeliveryMeta; refreshKey: number }) {
  const [tenants, setTenants] = useState<string[]>([]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [rows, setRows] = useState<DeliveryRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deliveryApi.toRelease({ tenants, envs })
      .then(r => { if (!cancelled) { setRows(r.rows); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenants, envs, refreshKey]);

  const red = rows.filter(r => !r.ready).length;

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700">Today · {dayLabel(meta.day)}</span>
        <MultiSelect label="Tenant" options={meta.tenants} value={tenants} onChange={setTenants} />
        <MultiSelect label="Env" options={meta.envs} value={envs} onChange={setEnvs} tone="indigo" />
        <span className="text-sm text-gray-500 ml-auto">{rows.length} to release · <span className="text-red-600 font-medium">{red} not ready</span> · <span className="text-green-700 font-medium">{rows.length - red} ready</span></span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error && <div className="mb-3 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error}</div>}
        {loading && rows.length === 0 ? <p className="text-sm text-gray-500">Loading…</p>
          : <ReleaseTable rows={rows} showStatus empty="Nothing is waiting on a release today." />}
      </div>
    </div>
  );
}
