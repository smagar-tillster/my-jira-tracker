// Release summary (frontend/src/components/delivery/releaseSummary.ts): software kept apart from menu, assets and configs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { classifyComponent, buildReleaseSummary, filterByType } = await import('../../../frontend/src/components/delivery/releaseSummary.ts');

const group = (n) => { const k = classifyComponent(n); return k.kind === 'software' ? 'software' : k.group; };

test('component names from the live data land in software, menu, assets or configs', () => {
  const expect = {
    software: ['FE', 'SW', 'SW Override', 'Kiosk Web Service', 'Device Service', 'Kiosk Menu Service', 'MSS Payment Service Client', 'RBI Loyalty'],
    Menu: ['Menu', 'Skumap', 'TCE Menu', 'Menu Override', 'NutritionInfo'],
    Assets: ['ImageOverride', 'Banner', 'Attract Loop', 'OCC Attract Loop', 'Screensaver', 'Receipt Images', 'media/layout/x-subdirectory-x/images', 'AVOL-US - assets/theme', 'AVOL-US - style override'],
    Configs: ['TranslationFiles', 'PROD/config.json', 'layout/config.json', 'attract-loop.properties', 'Coupons', 'Receipt.xsl', 'tenant-config.json', 'languageinfo.json', 'Receipt Localization Properties', 'OCC', 'LPID'],
  };
  for (const [g, names] of Object.entries(expect)) for (const n of names) assert.equal(group(n), g, n);
});

test('one entry per tenant, day and env; software and content are separate; versions are kept', () => {
  const rows = [
    { tenant: 'BK-US', date: '2026-11-18', env: 'PROD', released: true, components: [{ name: 'FE', version: '1.2' }, { name: 'Menu', version: '' }] },
    { tenant: 'BK-US', date: '2026-11-18', env: 'PROD', released: true, components: [{ name: 'FE', version: '' }, { name: 'Banner', version: '' }, { name: 'TranslationFiles', version: '' }] },
    { tenant: 'BK-US', date: '2026-11-18', env: 'UAT/LAB', released: false, components: [{ name: 'SW', version: '9' }] },
    { tenant: 'AVOL-US', date: '2026-11-17', env: 'PROD', released: true, components: [] },
  ];
  const out = buildReleaseSummary(rows);
  assert.deepEqual(out.map(t => t.tenant), ['AVOL-US', 'BK-US']);
  const bk = out[1].entries;
  assert.deepEqual(bk.map(e => e.env), ['PROD', 'UAT/LAB']); // PROD before UAT/LAB on the same day
  assert.deepEqual(bk[0].software, [{ name: 'FE', version: '1.2' }]); // merged, version kept
  assert.deepEqual(bk[0].content.Menu, [{ name: 'Menu', version: '' }]);
  assert.deepEqual(bk[0].content.Assets, [{ name: 'Banner', version: '' }]);
  assert.deepEqual(bk[0].content.Configs, [{ name: 'TranslationFiles', version: '' }]);
  assert.equal(bk[1].released, false);
});

test('each entry lists its release tickets once, with link and status', () => {
  const r = (key, status) => ({ tenant: 'T', date: '2026-11-18', env: 'PROD', released: true, key, url: `https://j/${key}`, status, components: [] });
  const e = buildReleaseSummary([r('NGK-1', 'Released'), r('NGK-2', 'Done'), r('NGK-1', 'Released'), r(null, '')])[0].entries[0];
  assert.deepEqual(e.tickets, [{ key: 'NGK-1', url: 'https://j/NGK-1', status: 'Released' }, { key: 'NGK-2', url: 'https://j/NGK-2', status: 'Done' }]);
});

test('an entry is released only when every release ticket in it is', () => {
  const r = (released) => ({ tenant: 'T', date: '2026-11-18', env: 'PROD', released, components: [] });
  assert.equal(buildReleaseSummary([r(true), r(false)])[0].entries[0].released, false);
  assert.equal(buildReleaseSummary([r(true), r(true)])[0].entries[0].released, true);
});

test('newest day first', () => {
  const r = (date) => ({ tenant: 'T', date, env: 'PROD', released: true, components: [] });
  assert.deepEqual(buildReleaseSummary([r('2026-11-16'), r('2026-11-18'), r('2026-11-17')])[0].entries.map(e => e.date), ['2026-11-18', '2026-11-17', '2026-11-16']);
});

test('the Type filter keeps only components of the chosen types and drops releases left empty', () => {
  const rows = [
    { id: 1, components: [{ name: 'FE', version: '1' }, { name: 'Menu', version: '' }] },
    { id: 2, components: [{ name: 'Banner', version: '' }] },
    { id: 3, components: [] },
  ];
  assert.equal(filterByType(rows, []), rows); // nothing chosen: everything
  const sw = filterByType(rows, ['Software']);
  assert.deepEqual(sw.map(r => [r.id, r.components.map(c => c.name)]), [[1, ['FE']]]);
  const content = filterByType(rows, ['Menu', 'Assets']);
  assert.deepEqual(content.map(r => [r.id, r.components.map(c => c.name)]), [[1, ['Menu']], [2, ['Banner']]]);
  assert.equal(filterByType(rows, ['Configs']).length, 0);
});
