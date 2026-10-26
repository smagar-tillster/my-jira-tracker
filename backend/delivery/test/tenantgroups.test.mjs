// Tenant grouping used by the Released, To Release, Merged PRs and Open PRs views (frontend/src/components/delivery/tenantGrouping.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { FALLBACK_TENANT, cleanTenants, groupByTenant } = await import('../../../frontend/src/components/delivery/tenantGrouping.ts');

test('anything without a clear tenant goes to Tillster-All', () => {
  assert.equal(FALLBACK_TENANT, 'Tillster-All');
  assert.deepEqual(cleanTenants([]), ['Tillster-All']);
  assert.deepEqual(cleanTenants(undefined), ['Tillster-All']);
  assert.deepEqual(cleanTenants(['', '  ', '(no client)']), ['Tillster-All']);
  assert.deepEqual(cleanTenants(['AVOL-US', 'avol-us', ' BK-US ']), ['AVOL-US', 'BK-US']);
});

test('PRs from different repos for one tenant land in one group', () => {
  const prs = [
    { id: 'kiosk-ui#1', tenants: ['AVOL-US'] },
    { id: 'menu#2', tenants: ['AVOL-US'] },
    { id: 'kiosk-ui#3', tenants: ['BK-US'] },
  ];
  const { groups, unique } = groupByTenant(prs, (p) => p.tenants);
  assert.equal(unique, 3);
  assert.deepEqual(groups.map((g) => [g.tenant, g.items.map((i) => i.id)]), [['AVOL-US', ['kiosk-ui#1', 'menu#2']], ['BK-US', ['kiosk-ui#3']]]);
});

test('a PR naming several tenants is listed under each, and tenants sort alphabetically with Tillster-All last', () => {
  const prs = [{ id: 'a', tenants: ['Zed', 'Alpha'] }, { id: 'b', tenants: [] }, { id: 'c', tenants: ['alpha'] }];
  const { groups, unique } = groupByTenant(prs, (p) => p.tenants);
  assert.equal(unique, 3);
  assert.deepEqual(groups.map((g) => g.tenant), ['Zed'.length ? 'Alpha' : '', 'Zed', 'Tillster-All']);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'c']); // case differences do not split a tenant
  assert.deepEqual(groups[2].items.map((i) => i.id), ['b']);
});

test('releases without a tenant ("(no client)" rows) are grouped under Tillster-All with the others', () => {
  const rows = [{ tenant: '(no client)', date: '2026-10-20' }, { tenant: 'BK-US', date: '2026-10-21' }, { tenant: 'BK-US', date: '2026-10-22' }];
  const { groups } = groupByTenant(rows, (r) => [r.tenant]);
  assert.deepEqual(groups.map((g) => [g.tenant, g.items.length]), [['BK-US', 2], ['Tillster-All', 1]]);
});
