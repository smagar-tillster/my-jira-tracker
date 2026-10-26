import { ReactNode, useMemo, useState } from 'react';
import { FALLBACK_TENANT, groupByTenant } from './tenantGrouping';

/**
 * Items grouped by tenant. Every group starts collapsed and shows what is inside it; open one to see its rows.
 * `unit` names one item in the count ("release ticket", "PR").
 */
export default function TenantGroupList<T>({ items, tenantsOf, summary, unit, children }: {
  items: T[];
  tenantsOf: (item: T) => readonly string[] | null | undefined;
  summary: (items: T[], tenant: string) => ReactNode;
  unit: string;
  children: (items: T[], tenant: string) => ReactNode;
}) {
  const { groups } = useMemo(() => groupByTenant(items, tenantsOf), [items, tenantsOf]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (t: string) => setOpen(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const allOpen = groups.length > 0 && groups.every(g => open.has(g.tenant));
  const several = items.filter(i => (tenantsOf(i) || []).filter(t => t && t.trim()).length > 1).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>
          {groups.length} tenant{groups.length === 1 ? '' : 's'} · {items.length} {unit}{items.length === 1 ? '' : 's'}.
          Grouped by tenant{several > 0 ? `; ${several} ${several === 1 ? 'names' : 'name'} more than one tenant and ${several === 1 ? 'is' : 'are'} listed under each` : ''}.
          Anything without a clear tenant is under {FALLBACK_TENANT}.
        </span>
        <button onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(g => g.tenant)))} className="ml-auto text-blue-600 hover:underline whitespace-nowrap">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {groups.map(g => (
        <div key={g.tenant} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <button onClick={() => toggle(g.tenant)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
            <span className="text-gray-400">{open.has(g.tenant) ? '▼' : '▶'}</span>
            <span className="font-semibold text-gray-800">{g.tenant}</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{g.items.length}</span>
            <span className="text-xs text-gray-500 truncate">{summary(g.items, g.tenant)}</span>
          </button>
          {open.has(g.tenant) && <div className="border-t border-gray-100">{children(g.items, g.tenant)}</div>}
        </div>
      ))}
    </div>
  );
}
