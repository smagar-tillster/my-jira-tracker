// Release components: names from the Jira Components field, versions from the table header then the table, never config keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentList, componentText, isConfigKey, parseReleaseDescription } from '../lib/releases.mjs';

const names = (g) => componentList(g).map((c) => c.name);
const text = (g) => componentText(componentList(g));

test('NGK-103046 shape: the title says SW but the Jira field says Menu, Skumap, TranslationFiles; only the field counts, and none has a version', () => {
  const g = { components: ['Menu', 'Skumap', 'TranslationFiles'], titleComponents: 'SW', items: [], versions: [] };
  assert.deepEqual(names(g), ['Menu', 'Skumap', 'TranslationFiles']);
  assert.equal(text(g), 'Menu, Skumap, TranslationFiles');
});

test('NGK-103224 shape: MENU+OVERRIDE in the title does not add Override; the field gives ImageOverride and TranslationFiles', () => {
  const g = { components: ['ImageOverride', 'TranslationFiles'], titleComponents: 'MENU+OVERRIDE', items: [{ key: 'NGK-1', component: 'TranslationFiles', version: 'Unknown' }, { key: 'NGK-2', component: 'ImageOverride', version: 'Unknown' }], versions: [] };
  assert.deepEqual(names(g), ['ImageOverride', 'TranslationFiles']);
  assert.equal(text(g), 'ImageOverride, TranslationFiles');   // "Unknown" is not a version
});

test('a config key in the table is a setting, not a component; PROD/config.json is the component', () => {
  const g = { components: ['PROD/config.json (AKA "Global Config")', 'FE'], titleComponents: '', items: [{ key: 'NGK-3', component: 'ui.menu.itemClickGuard.enabled = true', version: '' }], versions: [] };
  assert.deepEqual(names(g), ['PROD/config.json', 'FE']);
  for (const k of ['ui.menu.itemClickGuard.enabled', 'ui.menu.itemClickGuard.enabled = true', 'a.b.c', 'x.y = 5']) assert.equal(isConfigKey(k), true, k);
  for (const k of ['PROD/config.json', 'FE', 'TranslationFiles', 'RBI Loyalty', 'Menu', 'config.json']) assert.equal(isConfigKey(k), false, k);
});

test('versions come from the table header first and attach only to names in the Jira field', () => {
  const g = { components: ['FE', 'Menu'], titleComponents: 'FE + SW', items: [], versions: [{ name: 'FE', uat: '1.294.0-16', prod: '1.294.0-14' }, { name: 'SW', value: '9.1' }] };
  assert.equal(text(g), 'FE (UAT 1.294.0-16 / PROD 1.294.0-14), Menu');   // SW is not a component here, so its version is not shown
});

test('a version the header does not have is read from the rest of the table; the header wins when both have one', () => {
  const noHeader = { components: ['FE'], titleComponents: '', items: [{ key: 'NGK-1', component: 'FE', version: 'FE: 1.294.0-2' }], versions: [] };
  assert.equal(text(noHeader), 'FE (1.294.0-2)');
  const both = { components: ['FE'], titleComponents: '', items: [{ key: 'NGK-1', component: 'FE', version: 'FE: 1.0.0-1' }], versions: [{ name: 'FE', value: '1.294.0-2' }] };
  assert.equal(text(both), 'FE (1.294.0-2)');
});

test('with no Jira components the title is used, then the table; a config key never is', () => {
  assert.deepEqual(names({ components: [], titleComponents: 'FE + SW', items: [], versions: [] }), ['FE', 'SW']);
  const g = { components: [], titleComponents: '', items: [{ component: 'ui.menu.x.enabled' }, { component: 'Menu' }], versions: [] };
  assert.deepEqual(names(g), ['Menu']);
});

test('aliases line up: a header version for Kiosk lands on FE', () => {
  assert.equal(text({ components: ['FE'], titleComponents: '', items: [], versions: [{ name: 'Kiosk', value: '1.2.3' }] }), 'FE (1.2.3)');
});

// ---- the description parser: no release table, no versions
const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const cell = (t) => ({ type: 'tableCell', content: [p(t)] });
const row = (...c) => ({ type: 'tableRow', content: c.map(cell) });

test('without a release table, version-looking lines are not read as versions', () => {
  const adf = { type: 'doc', content: [p('Maintenance update'), p('SW: 1.2.3'), p('FE: 4.5.6')] };
  assert.deepEqual(parseReleaseDescription(adf).versions, []);
});

test('with a release table, versions in the header are used, and loose lines are read only when the header has none', () => {
  const withHeader = { type: 'doc', content: [{ type: 'table', content: [row('Tickets', 'Components', 'UAT Version / PROD Version\nFE: 1.2-16 / 1.2-14'), row('NGK-1', 'FE', 'x')] }] };
  assert.deepEqual(parseReleaseDescription(withHeader).versions, [{ name: 'FE', uat: '1.2-16', prod: '1.2-14' }]);
  const looseOnly = { type: 'doc', content: [{ type: 'table', content: [row('Tickets', 'Components', 'Version'), row('NGK-1', 'FE', 'x')] }, p('FE: 7.8.9')] };
  assert.deepEqual(parseReleaseDescription(looseOnly).versions, [{ name: 'FE', value: '7.8.9' }]);
});

// ---- NGK-102846: versions run together in the header cell, written as "kiosk = X / kiosk = Y"
const run = (...parts) => ({ type: 'paragraph', content: parts.map((t, i) => ({ type: 'text', text: t, ...(i % 2 ? { marks: [{ type: 'strong' }] } : {}) })) });
const td = (...paras) => ({ type: 'tableCell', content: paras });
const NGK_102846 = { type: 'doc', content: [{ type: 'table', content: [
  { type: 'tableRow', content: [td(p('TIX')), td(run('ASSETS & VERSIONS', ' Current Versions Staged to UAT / PROD ', 'kiosk = 1.295.0-17-main', ' / ', 'kiosk = 1.290.0-14-main', ' ', 'rbi-loyalty-client = 1.146 /', '  ', 'rbi-loyalty-client = 1.129'))] },
  row('NGK-98585', 'RBI Loyalty = 1.144'),
  row('NGK-100499', 'FE = TBD'),
  row('NGK-102322', 'FE = 1.295.0-6 PROD/config.json NGK-103302 ui.analytics.GA4.limitHandling.rateLimit.enabled = true'),
  row('NGK-102968', 'FE = 1.295.0-3-main or v1.290.0-14-NGK-102968-hotfix PROD/config.json ‘ui.menu.itemClickGuard.enabled’ = true (default: false)'),
] }] };

test('NGK-102846: the run-together header gives UAT and PROD versions for kiosk and rbi-loyalty-client', () => {
  const v = parseReleaseDescription(NGK_102846).versions;
  assert.deepEqual(v, [{ name: 'kiosk', uat: '1.295.0-17-main', prod: '1.290.0-14-main' }, { name: 'rbi-loyalty-client', uat: '1.146', prod: '1.129' }]);
});

test('NGK-102846: kiosk is FE and rbi-loyalty-client is RBI Loyalty; names come from the Jira field, config keys never appear', () => {
  const parsed = parseReleaseDescription(NGK_102846);
  const g = { components: ['FE', 'GTM', 'PROD/config.json (AKA "Global Config" - all current PROD stores )', 'RBI Loyalty'], titleComponents: 'FE + RBI Loyalty + CONFIGS', items: parsed.rows, versions: parsed.versions };
  assert.equal(text(g), 'FE (UAT 1.295.0-17-main / PROD 1.290.0-14-main), GTM, PROD/config.json, RBI Loyalty (UAT 1.146 / PROD 1.129)');
});

test('with no header versions, the whole table is read, including versions written in the Components cell', () => {
  const rows = parseReleaseDescription({ type: 'doc', content: [{ type: 'table', content: [row('Tickets', 'Assets & versions'), row('NGK-1', 'RBI Loyalty = 1.144'), row('NGK-2', 'FE = 1.295.0-6 ui.menu.itemClickGuard.enabled = true'), row('NGK-3', 'FE = TBD')] }] }).rows;
  const g = { components: ['FE', 'GTM', 'RBI Loyalty'], titleComponents: '', items: rows, versions: [] };
  assert.equal(text(g), 'FE (1.295.0-6), GTM, RBI Loyalty (1.144)');
});

test('the existing line-by-line header format still works', () => {
  const adf = { type: 'doc', content: [{ type: 'table', content: [row('Tickets', 'Components', 'UAT Version / PROD Version\nFE: 1.2-16 / 1.2-14\nMS: 26.166'), row('NGK-1', 'FE', 'x')] }] };
  assert.deepEqual(parseReleaseDescription(adf).versions, [{ name: 'FE', uat: '1.2-16', prod: '1.2-14' }, { name: 'MS', value: '26.166' }]);
});

// ---- SW releases: the Jira field says SW and the header lists the services with their versions
test('when the field lists SW, the services named in the header are its versions; without SW they are not shown', () => {
  const versions = [{ name: 'mobilem8-menu-service', value: '26.166' }, { name: 'deviceservice', uat: '1.2', prod: '1.1' }, { name: 'version', value: '20261029' }];
  assert.equal(text({ components: ['SW', 'Menu'], titleComponents: '', items: [], versions }), 'SW (menu-service 26.166, deviceservice UAT 1.2 / PROD 1.1), Menu');
  assert.equal(text({ components: ['Menu', 'Skumap'], titleComponents: 'SW', items: [], versions }), 'Menu, Skumap');   // SW only in the title: not a component here
});

test('a long list of services is shortened like any other version list', () => {
  const versions = ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ name: `svc-${n}`, value: `${i}.0` }));
  assert.equal(text({ components: ['SW'], titleComponents: '', items: [], versions }), 'SW (svc-a 0.0, svc-b 1.0, svc-c 2.0 +2)');
});

test('the FE alias still applies next to SW: a header kiosk version lands on FE, the services on SW', () => {
  const versions = [{ name: 'kiosk', uat: '1.295', prod: '1.290' }, { name: 'mobilem8-web-service', value: '3.4' }];
  assert.equal(text({ components: ['FE', 'SW'], titleComponents: '', items: [], versions }), 'FE (UAT 1.295 / PROD 1.290), SW (web-service 3.4)');
});
