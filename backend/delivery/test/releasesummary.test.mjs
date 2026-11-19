// Release summary (frontend/src/components/delivery/releaseSummary.ts): software kept apart from menu, assets and configs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { classifyComponent, buildReleaseSummary } = await import('../../../frontend/src/components/delivery/releaseSummary.ts');

const group = (n) => { const k = classifyComponent(n); return k.kind === 'software' ? 'software' : k.group; };

test('component names from the live data land in software, menu, assets or configs', () => {
  const expect = {
    software: ['FE', 'SW', 'SW Override', 'Kiosk Web Service', 'Device Service', 'Kiosk Menu Service', 'MSS Payment Service Client', 'RBI Loyalty', 'OCC'],
    Menu: ['Menu', 'Skumap', 'TCE Menu', 'Menu Override', 'NutritionInfo'],
    Assets: ['ImageOverride', 'Banner', 'Attract Loop', 'OCC Attract Loop', 'Screensaver', 'Receipt Images', 'media/layout/x-subdirectory-x/images', 'AVOL-US - assets/theme', 'AVOL-US - style override'],
    Configs: ['TranslationFiles', 'PROD/config.json', 'layout/config.json', 'attract-loop.properties', 'Coupons', 'Receipt.xsl', 'tenant-config.json', 'languageinfo.json', 'Receipt Localization Properties'],
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

test('an entry is released only when every release ticket in it is', () => {
  const r = (released) => ({ tenant: 'T', date: '2026-11-18', env: 'PROD', released, components: [] });
  assert.equal(buildReleaseSummary([r(true), r(false)])[0].entries[0].released, false);
  assert.equal(buildReleaseSummary([r(true), r(true)])[0].entries[0].released, true);
});

test('newest day first', () => {
  const r = (date) => ({ tenant: 'T', date, env: 'PROD', released: true, components: [] });
  assert.deepEqual(buildReleaseSummary([r('2026-11-16'), r('2026-11-18'), r('2026-11-17')])[0].entries.map(e => e.date), ['2026-11-18', '2026-11-17', '2026-11-16']);
});
