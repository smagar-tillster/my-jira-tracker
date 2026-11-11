// Proposed rows for the defects feed: CSV reading and writing, the repeat check, cleaning, and the pipeline with a fake `claude`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-defect-'));
process.env.NGK_DATA_DIR = tmp;
const d = await import('../lib/defectrow.mjs');

const FEED = [
  'jira_id,title,status,repo,tenant_scope,tags,symptom,root_cause,fingerprint_files,fingerprint_functions_config,repro_steps,test_case,fix_summary,related_tickets,date_logged',
  'NGK-100879,"Combo add-to-cart redirects, loses cart",fixed,kiosk-ui,KFC-MX,"navigation-state-loss, combo-vs-product-asymmetry","The ""6 Chicken Pieces"" combo\nredirects home",stayOnPageOnItemAddition not threaded,"src/common/directives/comboTile.js\nsrc/configs/promotion.js",stayOnPageOnItemAddition,open combo,"given a combo when added then stay",PR: https://x/pr/9106,,2026-09-20',
  'NGK-101000,Upsell price font differs,fixed,kiosk-ui,all,tenant-override-gap,font differs,override missing,src/themes/kfc-mx/upsell.scss,,,,fix,,2026-10-01',
].join('\n');

test('the CSV reader handles quotes, commas, doubled quotes and line breaks inside a field', () => {
  const { header, rows } = d.parseCsv(FEED);
  assert.equal(header.length, 15);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Combo add-to-cart redirects, loses cart');
  assert.equal(rows[0].symptom, 'The "6 Chicken Pieces" combo\nredirects home');
  assert.equal(rows[0].fingerprint_files, 'src/common/directives/comboTile.js\nsrc/configs/promotion.js');
  assert.deepEqual(d.parseCsv('').rows, []);
  assert.equal(d.parseCsv('a,b\r\n1,2\r\n').rows[0].b, '2');
});

test('a row written as CSV reads back the same, in the column order of the feed', () => {
  const columns = ['jira_id', 'title', 'tags'];
  const row = { jira_id: 'NGK-1', title: 'He said "hi", then left', tags: 'a, b', ignored: 'x' };
  const line = d.toCsvLine(row, columns);
  assert.equal(line, 'NGK-1,"He said ""hi"", then left","a, b"');
  assert.deepEqual(d.parseCsv(`${columns.join(',')}\n${line}`).rows[0], { jira_id: 'NGK-1', title: 'He said "hi", then left', tags: 'a, b' });
  assert.equal(d.toCsvLine({ title: 'multi\nline' }, ['title']), '"multi\nline"');
});

test('the tag vocabulary is the tags already in the feed, most used first', () => {
  const { rows } = d.parseCsv(FEED);
  assert.deepEqual(d.tagVocabulary(rows), ['combo-vs-product-asymmetry', 'navigation-state-loss', 'tenant-override-gap']);
});

test('a possible repeat shares a file (full path or file name) or a tag, files counting more', () => {
  const { rows } = d.parseCsv(FEED);
  const byPath = d.recurrenceFor(rows, { files: ['src/common/directives/comboTile.js'], tags: [] });
  assert.deepEqual(byPath.map((r) => r.jira_id), ['NGK-100879']);
  const byName = d.recurrenceFor(rows, { files: ['other/dir/promotion.js'], tags: [] });
  assert.deepEqual(byName.map((r) => r.jira_id), ['NGK-100879']);   // same file name in another folder still flags
  const both = d.recurrenceFor(rows, { files: ['src/themes/kfc-mx/upsell.scss'], tags: ['navigation-state-loss'] });
  assert.deepEqual(both.map((r) => r.jira_id), ['NGK-101000', 'NGK-100879']);  // file match outranks a tag match
  assert.deepEqual(d.recurrenceFor(rows, { files: ['nothing.js'], tags: ['unrelated'] }), []);
});

const model = (o = {}) => ({ title: 'Cart lost on combo add', tenant_scope: 'KFC-MX', tags: ['Navigation State Loss', 'brand new tag'], symptom: 'Cart is lost after adding a combo.',
  root_cause: 'The redirect ignored the stay-on-page flag.', fingerprint_functions_config: 'addComboToCart, stayOnPageOnItemAddition', repro_steps: 'Add a combo.', test_case: 'Given a combo, when added, then the cart stays.', fix_summary: 'Honors the flag.', ...o });
const facts = { key: 'NGK-5', repo: 'kiosk-ui', status: 'fixed', prUrl: 'https://x/pr/5', files: ['src/a.js', 'src/b.js'], related: ['NGK-6'], today: '2026-11-01', tenants: [] };

test('the row takes ids, files, links and dates from facts, and tags are cleaned against the vocabulary', () => {
  const { row, newTags, unsure } = d.buildRow({ facts, model: model(), vocabulary: ['navigation-state-loss'] });
  assert.equal(row.jira_id, 'NGK-5');
  assert.equal(row.repo, 'kiosk-ui');
  assert.equal(row.fingerprint_files, 'src/a.js\nsrc/b.js');
  assert.equal(row.fix_summary, 'Honors the flag. — PR: https://x/pr/5');
  assert.equal(row.related_tickets, 'NGK-6');
  assert.equal(row.date_logged, '2026-11-01');
  assert.equal(row.tags, 'navigation-state-loss, brand-new-tag');
  assert.deepEqual(newTags, ['brand-new-tag']);
  assert.deepEqual(unsure, []);
});

test('a model value never replaces a fact, and empty or "unclear" fields are reported', () => {
  const { row, unsure } = d.buildRow({ facts, model: model({ jira_id: 'NGK-999', repo: 'other', fingerprint_files: 'x.js', root_cause: 'Unclear: needs the server log', repro_steps: '' }), vocabulary: [] });
  assert.equal(row.jira_id, 'NGK-5');
  assert.equal(row.repo, 'kiosk-ui');
  assert.equal(row.fingerprint_files, 'src/a.js\nsrc/b.js');
  assert.deepEqual(unsure.sort(), ['repro_steps', 'root_cause']);
});

test('anything that looks like a secret or a card number is redacted and reported', () => {
  const { row, redacted } = d.buildRow({ facts, model: model({ symptom: 'Failed with key AKIAABCDEFGHIJKLMNOP and card 4111 1111 1111 1111' }), vocabulary: [] });
  assert.ok(!row.symptom.includes('AKIA') && !row.symptom.includes('4111'));
  assert.ok(redacted.length >= 1);
});

// ---- the pipeline
const packet = (keys = ['NGK-5'], state = 'MERGED') => async () => ({ text: '## Ticket\nbroken', p: { files: [{ name: 'src/a.js' }, { name: 'package-lock.json' }, { name: 'docs/x.md' }, { name: 'src/b.js' }], keys }, head: { state, url: 'https://x/pr/5' } });
const cfg = (dir) => ({ ragRoot: dir, models: { light: 'haiku', deep: 'sonnet' }, claudeTimeoutMs: 1000 });
const ok = (o, seen = []) => async (a) => { seen.push(a); return { ok: true, text: JSON.stringify(o) }; };

test('drafts a row, saves it, uses the feed header and flags a possible repeat', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'rag-')); fs.mkdirSync(path.join(dir, 'datafeeds'));
  fs.writeFileSync(path.join(dir, 'datafeeds', 'defects.csv'), FEED);
  const seen = [];
  const r = await d.generateDefectRow({ repo: 'kiosk-ui', number: 5, buildPacket: packet(), claude: ok(model({ tags: ['combo-vs-product-asymmetry'] }), seen), cfg: cfg(dir), now: () => new Date('2026-11-01T12:00:00') });
  assert.equal(r.state, 'done');
  const p = r.proposal;
  assert.equal(p.headerFromFeed, true);
  assert.deepEqual(p.columns.slice(0, 3), ['jira_id', 'title', 'status']);
  assert.deepEqual(p.row.fingerprint_files.split('\n'), ['src/a.js', 'src/b.js']);   // lock files and docs are left out
  assert.equal(p.row.date_logged, '2026-11-01');
  assert.equal(p.possibleRepeat[0].jira_id, 'NGK-100879');                            // shares the tag
  assert.match(seen[0].input, /combo-vs-product-asymmetry/);                          // the vocabulary reached the model
  assert.equal(seen[0].model, 'sonnet');
  assert.equal(d.parseCsv(`${p.columns.join(',')}\n${p.csvLine}`).rows[0].jira_id, 'NGK-5');
  assert.equal(d.loadProposal('kiosk-ui', 5).key, 'NGK-5');                           // saved under the app's own data folder
  assert.ok(!fs.readFileSync(path.join(dir, 'datafeeds', 'defects.csv'), 'utf8').includes('NGK-5,')); // the feed itself is untouched
});

test('a ticket already in the feed is not drafted again and no model call is spent', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'rag-')); fs.mkdirSync(path.join(dir, 'datafeeds'));
  fs.writeFileSync(path.join(dir, 'datafeeds', 'defects.csv'), FEED);
  let calls = 0;
  const r = await d.generateDefectRow({ repo: 'kiosk-ui', number: 7, key: 'ngk-100879', buildPacket: packet(['NGK-100879']), claude: async () => { calls++; return { ok: true, text: '{}' }; }, cfg: cfg(dir) });
  assert.equal(r.state, 'exists');
  assert.equal(calls, 0);
  assert.equal(r.proposal.existing.jira_id, 'NGK-100879');
});

test('with no feed file the default columns are used, and failures are reported plainly', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'rag-'));
  const r = await d.generateDefectRow({ repo: 'kiosk-ui', number: 8, buildPacket: packet(), claude: ok(model()), cfg: cfg(dir) });
  assert.equal(r.state, 'done');
  assert.equal(r.proposal.feedFound, false);
  assert.deepEqual(r.proposal.columns, d.DEFAULT_COLUMNS);
  assert.equal((await d.generateDefectRow({ repo: 'kiosk-ui', number: 9, buildPacket: packet([]), claude: ok(model()), cfg: cfg(dir) })).state, 'failed');
  assert.equal((await d.generateDefectRow({ repo: 'kiosk-ui', number: 10, buildPacket: packet(), claude: async () => ({ ok: false, reason: 'not logged in' }), cfg: cfg(dir) })).state, 'failed');
  assert.equal((await d.generateDefectRow({ repo: 'kiosk-ui', number: 11, buildPacket: packet(), claude: async () => ({ ok: true, text: 'sorry' }), cfg: cfg(dir) })).state, 'failed');
});

// ---- the routes (validation and reading a saved row; the model path is covered above)
import http from 'node:http';
const call = async (server, method, url, body) => {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('the defect-row routes refuse bad input and return a saved row', async () => {
  const { default: express } = await import('express');
  const { createReviewsRouter } = await import('../../src/routes/reviews.js');
  const app = express(); app.use(express.json()); app.use('/api', createReviewsRouter({ gh: async () => { throw new Error('no network in tests'); } }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await call(server, 'POST', '/api/reviews/defect-row', { repo: 'not-a-repo', number: 5 })).status, 400);
    assert.equal((await call(server, 'POST', '/api/reviews/defect-row', { repo: 'kiosk-ui', number: -1 })).status, 400);
    assert.equal((await call(server, 'POST', '/api/reviews/defect-row', { repo: 'kiosk-ui', number: 5, key: 'DROP TABLE' })).status, 400);
    assert.equal((await call(server, 'GET', '/api/reviews/defect-row/kiosk-ui/424242')).status, 404);
    assert.equal((await call(server, 'GET', '/api/reviews/defect-row/not-a-repo/5')).status, 400);
    fs.mkdirSync(d.PROPOSALS_DIR, { recursive: true });
    fs.writeFileSync(d.proposalFile('kiosk-ui', 424242), JSON.stringify({ repo: 'kiosk-ui', number: 424242, key: 'NGK-1', csvLine: 'x' }));
    const got = await call(server, 'GET', '/api/reviews/defect-row/kiosk-ui/424242');
    assert.equal(got.status, 200);
    assert.equal(got.json.data.key, 'NGK-1');
  } finally { server.close(); }
});
