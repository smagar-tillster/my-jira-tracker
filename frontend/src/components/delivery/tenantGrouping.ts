// Grouping by tenant for the delivery views. Plain functions with no imports so they can be tested with node directly.

/** Tenant for anything whose tenant is not clear (no client on the ticket, nothing inferred from the PR). */
export const FALLBACK_TENANT = 'Tillster-All';

/** Cleaned, de-duplicated tenant names; an empty list, a blank or "(no client)" becomes the fallback tenant. */
export const cleanTenants = (list: readonly string[] | null | undefined): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list || []) {
    const t = String(raw ?? '').trim();
    if (!t || /^\(no client\)$/i.test(t)) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.length ? out : [FALLBACK_TENANT];
};

export interface TenantGroup<T> { tenant: string; items: T[] }

/**
 * One group per tenant, alphabetical, with the fallback tenant last. An item that names several tenants is listed under each of
 * them (so a tenant's group is complete), and counted once in `unique`.
 */
export const groupByTenant = <T>(items: readonly T[], tenantsOf: (item: T) => readonly string[] | null | undefined): { groups: TenantGroup<T>[]; unique: number } => {
  const byTenant = new Map<string, TenantGroup<T>>();
  for (const item of items) {
    for (const t of cleanTenants(tenantsOf(item))) {
      const key = t.toLowerCase();
      const g = byTenant.get(key) || { tenant: t, items: [] };
      g.items.push(item);
      byTenant.set(key, g);
    }
  }
  const groups = [...byTenant.values()].sort((a, b) => {
    const fa = a.tenant === FALLBACK_TENANT ? 1 : 0;
    const fb = b.tenant === FALLBACK_TENANT ? 1 : 0;
    return fa - fb || a.tenant.localeCompare(b.tenant, 'en', { sensitivity: 'base' });
  });
  return { groups, unique: items.length };
};
