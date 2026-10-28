import { ReactNode, useMemo, useState } from 'react';
import { FALLBACK_TENANT, GroupOrder, groupByTenant } from './tenantGrouping';

/**
 * Items grouped by tenant. Every group starts collapsed and shows what is inside it; open one to see its rows.
 * `unit` names one item in the count ("release ticket", "PR").
 * `order` sets the tenant order (alphabetical by default) and `orderLabel` says so in the note above the list; pass both from a
 * module-level constant so the grouping is not rebuilt on every render. `alert` marks a tenant line in red (for example a tenant
 * with something not ready).
 */
export default function TenantGroupList<T>({ items, tenantsOf, summary, unit, children, order, orderLabel = 'alphabetical', alert }: {
  items: T[];
  tenantsOf: (item: T) => readonly string[] | null | undefined;
  summary: (items: T[], tenant: string) => ReactNode;
  unit: string;
  children: (items: T[], tenant: string) => ReactNode;
  order?: GroupOrder<T>;
  orderLabel?: string;
  alert?: (items: T[], tenant: string) => boolean;
}) {
  const { groups } = useMemo(() => groupByTenant(items, tenantsOf, order), [items, tenantsOf, order]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (t: string) => setOpen(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const allOpen = groups.length > 0 && groups.every(g => open.has(g.tenant));
  const several = items.filter(i => (tenantsOf(i) || []).filter(t => t && t.trim()).length > 1).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>
          {groups.length} tenant{groups.length === 1 ? '' : 's'} · {items.length} {unit}{items.length === 1 ? '' : 's'}.
          Grouped by tenant, {orderLabel}{several > 0 ? `; ${several} ${several === 1 ? 'names' : 'name'} more than one tenant and ${several === 1 ? 'is' : 'are'} listed under each` : ''}.
          Anything without a clear tenant is under {FALLBACK_TENANT}.
        </span>
        <button onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(g => g.tenant)))} className="ml-auto text-blue-600 hover:underline whitespace-nowrap">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {groups.map(g => {
        const red = !!alert?.(g.items, g.tenant);
        return (
          <div key={g.tenant} className={`bg-white rounded-lg shadow-sm border overflow-hidden ${red ? 'border-red-300' : 'border-gray-200'}`}>
            <button onClick={() => toggle(g.tenant)} data-alert={red || undefined}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-4 ${red ? 'bg-red-50 hover:bg-red-100 border-red-500' : 'hover:bg-gray-50 border-transparent'}`}>
              <span className={red ? 'text-red-400' : 'text-gray-400'}>{open.has(g.tenant) ? '▼' : '▶'}</span>
              <span className={`font-semibold ${red ? 'text-red-700' : 'text-gray-800'}`}>{g.tenant}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${red ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{g.items.length}</span>
              <span className={`text-xs truncate ${red ? 'text-red-600' : 'text-gray-500'}`}>{summary(g.items, g.tenant)}</span>
            </button>
            {open.has(g.tenant) && <div className={`border-t ${red ? 'border-red-100' : 'border-gray-100'}`}>{children(g.items, g.tenant)}</div>}
          </div>
        );
      })}
    </div>
  );
}
