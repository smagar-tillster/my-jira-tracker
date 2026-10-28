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

/** How the tenant groups are ordered. Used as an Array.sort comparator. */
export type GroupOrder<T> = (a: TenantGroup<T>, b: TenantGroup<T>) => number;

const byName = (a: { tenant: string }, b: { tenant: string }) => a.tenant.localeCompare(b.tenant, 'en', { sensitivity: 'base' });
/** Positive when only `a` is the fallback tenant (it sorts after), negative when only `b` is, 0 otherwise: real tenants come first. */
const fallbackLast = (a: { tenant: string }, b: { tenant: string }) => (a.tenant === FALLBACK_TENANT ? 1 : 0) - (b.tenant === FALLBACK_TENANT ? 1 : 0);

/** Alphabetical, fallback tenant last (the default). */
export const alphabetical = <T>(): GroupOrder<T> => (a, b) => fallbackLast(a, b) || byName(a, b);

/** Largest group first, ties alphabetical, fallback tenant last. */
export const byCount = <T>(): GroupOrder<T> => (a, b) => fallbackLast(a, b) || b.items.length - a.items.length || byName(a, b);

/**
 * Tenants with something not ready come first, the one with the most not-ready items on top; then the tenants that are all ready,
 * largest first. The fallback tenant is only pushed down within its own kind, so a not-ready item under it is never buried
 * below the ready tenants.
 */
export const byNotReady = <T>(notReady: (items: T[]) => number): GroupOrder<T> => (a, b) => {
  const na = notReady(a.items);
  const nb = notReady(b.items);
  if ((na > 0) !== (nb > 0)) return na > 0 ? -1 : 1;
  return fallbackLast(a, b) || nb - na || b.items.length - a.items.length || byName(a, b);
};

/**
 * One group per tenant, ordered by `order` (alphabetical with the fallback tenant last by default). An item that names several
 * tenants is listed under each of them (so a tenant's group is complete), and counted once in `unique`.
 */
export const groupByTenant = <T>(
  items: readonly T[],
  tenantsOf: (item: T) => readonly string[] | null | undefined,
  order: GroupOrder<T> = alphabetical<T>(),
): { groups: TenantGroup<T>[]; unique: number } => {
  const byTenant = new Map<string, TenantGroup<T>>();
  for (const item of items) {
    for (const t of cleanTenants(tenantsOf(item))) {
      const key = t.toLowerCase();
      const g = byTenant.get(key) || { tenant: t, items: [] };
      g.items.push(item);
      byTenant.set(key, g);
    }
  }
  const groups = [...byTenant.values()].sort(order);
  return { groups, unique: items.length };
};
