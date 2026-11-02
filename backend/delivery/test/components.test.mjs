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
