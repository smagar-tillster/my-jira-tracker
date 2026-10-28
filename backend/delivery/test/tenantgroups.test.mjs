// Tenant grouping used by the Released, To Release, Merged PRs and Open PRs views (frontend/src/components/delivery/tenantGrouping.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { FALLBACK_TENANT, cleanTenants, groupByTenant, byCount, byNotReady } = await import('../../../frontend/src/components/delivery/tenantGrouping.ts');

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

test('byCount: the tenant with the most items comes first, ties alphabetical, Tillster-All last even when it is the biggest', () => {
  const items = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, t: ['BK-US'] })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, t: ['AVOL-US'] })),
    { id: 'p', t: ['PLK-US'] },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, t: [] })),
  ];
  const { groups } = groupByTenant(items, (i) => i.t, byCount());
  assert.deepEqual(groups.map((g) => [g.tenant, g.items.length]), [['AVOL-US', 3], ['BK-US', 3], ['PLK-US', 1], ['Tillster-All', 5]]);
});

test('byCount: an item naming two tenants counts toward each of them', () => {
  const items = [{ id: '1', t: ['A-US', 'B-US'] }, { id: '2', t: ['B-US'] }, { id: '3', t: ['C-US'] }];
  const { groups } = groupByTenant(items, (i) => i.t, byCount());
  assert.deepEqual(groups.map((g) => [g.tenant, g.items.length]), [['B-US', 2], ['A-US', 1], ['C-US', 1]]);
});

const rel = (tenant, ready) => ({ tenant, ready });
const notReadyOf = (items) => items.filter((r) => !r.ready).length;

test('byNotReady: tenants with not-ready tickets first (most not-ready on top), then the all-ready ones largest first', () => {
  const rows = [
    rel('BK-US', true), rel('BK-US', false), rel('BK-US', true),
    rel('AVOL-US', true), rel('AVOL-US', true),
    ...Array.from({ length: 5 }, () => rel('PLK-US', true)),
    rel('JM-UK', false), rel('JM-UK', false),
  ];
  const { groups } = groupByTenant(rows, (r) => [r.tenant], byNotReady(notReadyOf));
  assert.deepEqual(groups.map((g) => g.tenant), ['JM-UK', 'BK-US', 'PLK-US', 'AVOL-US']);
});

test('byNotReady: a not-ready item with no clear tenant is not buried below the ready tenants', () => {
  const rows = [rel('(no client)', false), rel('BK-US', false), rel('BK-US', true), rel('PLK-US', true), rel('PLK-US', true), rel('PLK-US', true)];
  const { groups } = groupByTenant(rows, (r) => [r.tenant], byNotReady(notReadyOf));
  // BK-US and Tillster-All both have one not-ready ticket; real tenant first, then the fallback, then the all-ready PLK-US
  assert.deepEqual(groups.map((g) => g.tenant), ['BK-US', 'Tillster-All', 'PLK-US']);
});

test('byNotReady: when everything is ready it falls back to largest first with Tillster-All last', () => {
  const rows = [rel('(no client)', true), rel('(no client)', true), rel('(no client)', true), rel('A-US', true), rel('B-US', true), rel('B-US', true)];
  const { groups } = groupByTenant(rows, (r) => [r.tenant], byNotReady(notReadyOf));
  assert.deepEqual(groups.map((g) => g.tenant), ['B-US', 'A-US', 'Tillster-All']);
});

test('byNotReady: more not-ready tickets beats a bigger group with fewer', () => {
  const rows = [...Array.from({ length: 6 }, () => rel('BIG-US', true)), rel('BIG-US', false), rel('SMALL-US', false), rel('SMALL-US', false)];
  const { groups } = groupByTenant(rows, (r) => [r.tenant], byNotReady(notReadyOf));
  assert.deepEqual(groups.map((g) => g.tenant), ['SMALL-US', 'BIG-US']);
});
