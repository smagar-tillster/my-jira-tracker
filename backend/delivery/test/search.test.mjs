// Free-text search over delivery rows (frontend/src/components/delivery/search.ts) and the grouping fallback it relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { flattenText, matchesQuery, filterRows, queryTerms, prSearchText, quickFindPrs } = await import('../../../frontend/src/components/delivery/search.ts');
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

// ---- PR lists: search only the PR column, the ticket and the title
test('PR search covers #number, repo, ticket and title, and nothing else', () => {
  const p = pr({ number: 394, repo: 'kiosk-web-service', title: 'NGK-84570: Use previous caltotal cache', line1: 'Use previous caltotal cache', line2: 'Hidden detail about zebra', keys: ['NGK-84570'], tickets: [{ key: 'NGK-84570' }], tenants: ['BK-US'] });
  const hit = (q) => matchesQuery(p, q, prSearchText);
  assert.equal(hit('#394'), true);
  assert.equal(hit('kiosk-web-service#394'), true);
  assert.equal(hit('kiosk-web-service #394'), true);
  assert.equal(hit('ngk-84570'), true);
  assert.equal(hit('caltotal cache'), true);          // words from the title, in any order
  assert.equal(hit('web-service'), true);             // part of the repo name
  assert.equal(hit('zebra'), false);                  // the description line is not searched
  assert.equal(hit('bk-us'), false);                  // neither is the tenant
  assert.equal(hit('banner.js'), false);              // nor the file list
  assert.equal(hit('dev1'), false);                   // nor the author
});

test('a PR number must match whole: #39 does not find #394, but a bare word still matches inside text', () => {
  const p = pr({ number: 394, repo: 'r', title: 'Fix', line1: 'Fix', keys: [], tickets: [] });
  assert.equal(matchesQuery(p, '#39', prSearchText), false);
  assert.equal(matchesQuery(p, '#3940', prSearchText), false);
  assert.equal(matchesQuery(p, '#394', prSearchText), true);
  assert.equal(matchesQuery(pr({ number: 12, repo: 'r', title: 'Fix', line1: 'Fix', keys: [], tickets: [] }), '#1', prSearchText), false);
  const rows = [pr({ number: 5, repo: 'r', title: 'See #50 for context', line1: 'x', keys: [], tickets: [] }), pr({ number: 50, repo: 'r', title: 'y', line1: 'y', keys: [], tickets: [] })];
  assert.deepEqual(filterRows(rows, '#50', prSearchText).map(r => r.number), [5, 50]); // a title that names #50 matches too
  assert.deepEqual(filterRows(rows, '#5', prSearchText).map(r => r.number), [5]);
});

// ---- PR Reviews page: quick find in "Open PRs without a review"
test('quick find: a number matches PR numbers by prefix, other words match repo or title', () => {
  const items = [
    { repo: 'kiosk-web-service', number: 419, title: 'NGK-87781 spring7 java25' },
    { repo: 'kiosk-ui', number: 4190, title: 'Fix banner' },
    { repo: 'kiosk-ui', number: 41, title: 'Cart tweak' },
    { repo: 'kiosk-menu-service', number: 264, title: 'NGK-87781 upgrade to Spring7' },
  ];
  const nums = (q) => quickFindPrs(items, q).map(i => i.number);
  assert.deepEqual(nums(''), [419, 4190, 41, 264]);
  assert.deepEqual(nums('#419'), [419, 4190]);        // typing narrows as you go
  assert.deepEqual(nums('419'), [419, 4190]);         // the # is optional
  assert.deepEqual(nums('#41'), [419, 4190, 41]);
  assert.deepEqual(nums('#2'), [264]);
  assert.deepEqual(nums('#9'), []);
  assert.deepEqual(nums('ui #41'), [4190, 41]);       // a repo word narrows further
  assert.deepEqual(nums('spring7'), [419, 264]);
  assert.deepEqual(nums('NGK-87781 menu'), [264]);
  assert.deepEqual(quickFindPrs(items, '   '), items);
});
