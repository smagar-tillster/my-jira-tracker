// Free-text search over delivery rows (frontend/src/components/delivery/search.ts) and the grouping fallback it relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { flattenText, matchesQuery, filterRows, queryTerms } = await import('../../../frontend/src/components/delivery/search.ts');
const { groupByTenant, cleanTenants } = await import('../../../frontend/src/components/delivery/tenantGrouping.ts');

const pr = (over = {}) => ({
  id: 'kiosk-ui#1', repo: 'kiosk-ui', number: 1, line1: 'Fix loyalty banner', line2: 'Banner hid on small screens', url: 'https://github.com/o/kiosk-ui/pull/1',
  tickets: [{ key: 'NGK-100', url: 'https://jira/NGK-100' }], tenants: ['BK-US'], author: 'dev1',
  dependsOn: [{ text: 'needs menu-service#9', tone: 'warn', url: null }], files: [{ name: 'src/banner.js', add: 3, del: 1 }], ...over,
});

test('every word of the query must appear somewhere in the row, in any case', () => {
  assert.equal(matchesQuery(pr(), 'loyalty'), true);
  assert.equal(matchesQuery(pr(), 'LOYALTY bk-us'), true);
  assert.equal(matchesQuery(pr(), 'loyalty nonsense'), false);
  assert.equal(matchesQuery(pr(), 'ngk-100'), true);
  assert.equal(matchesQuery(pr(), 'banner.js'), true);       // file names are searchable
  assert.equal(matchesQuery(pr(), 'menu-service#9'), true);  // so is a dependency note
});

test('a blank query matches everything and keeps the same array', () => {
  const rows = [pr(), pr({ id: 'x' })];
  assert.equal(matchesQuery(pr(), '   '), true);
  assert.equal(filterRows(rows, ''), rows);
  assert.deepEqual(queryTerms('  a   B '), ['a', 'b']);
});

test('links are not searchable text, so "github" or "https" do not match every row', () => {
  assert.equal(matchesQuery(pr(), 'github'), false);
  assert.equal(matchesQuery(pr(), 'https'), false);
  assert.equal(flattenText({ a: 'https://x.y', b: 'ok', c: [1, { d: 'deep' }] }).trim().split(/\s+/).join(' '), 'ok 1 deep');
});

test('filterRows keeps order and drops what does not match', () => {
  const rows = [pr({ id: 'a', line1: 'one' }), pr({ id: 'b', line1: 'two' }), pr({ id: 'c', line1: 'one more' })];
  assert.deepEqual(filterRows(rows, 'one').map(r => r.id), ['a', 'c']);
  assert.deepEqual(filterRows(rows, 'zzz'), []);
});

test('grouping by repo or component puts an item with none under the named fallback', () => {
  const rows = [{ id: 1, comps: ['Menu', 'Skumap'] }, { id: 2, comps: [] }, { id: 3, comps: ['Menu'] }];
  const { groups } = groupByTenant(rows, r => r.comps, undefined, '(no component)');
  assert.deepEqual(groups.map(g => [g.tenant, g.items.map(i => i.id)]), [['(no component)', [2]], ['Menu', [1, 3]], ['Skumap', [1]]]);
  assert.deepEqual(cleanTenants([], '(none)'), ['(none)']);
  assert.deepEqual(cleanTenants([]), ['Tillster-All']); // the default is unchanged
});
