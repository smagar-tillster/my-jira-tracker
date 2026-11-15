// Defects knowledge base queue and daily sync: candidates from the PR ledger, the pattern test, appending to the feed, ingest, and the routes.
// Everything runs against a temp folder and a fake ingest: these tests never touch the real RAG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-kb-'));
process.env.DATA_DIR = tmp;
process.env.NGK_DATA_DIR = tmp;
const { initDb, getDb } = await import('../../src/db/database.js');
initDb();
const K = await import('../../src/services/trends/kb.js');
const store = await import('../../src/services/trends/store.js');
const { createTrendsService } = await import('../../src/services/trends/service.js');
const { createTrendsRouter } = await import('../../src/routes/trends.js');
const { parseCsv } = await import('../../delivery/lib/defectrow.mjs');

const reset = () => { getDb().exec('DELETE FROM trend_tickets; DELETE FROM trend_kb_queue; DELETE FROM trend_kb_state; DELETE FROM trend_ai'); };
const NOW = new Date('2026-11-14T09:00:00');
const HEADER = 'jira_id,title,status,repo,tenant_scope,tags,symptom,root_cause,fingerprint_files,fingerprint_functions_config,repro_steps,test_case,fix_summary,related_tickets,date_logged';
const pr = (n, keys, files, o = {}) => ({ id: `kiosk-ui#${n}`, repo: 'kiosk-ui', number: String(n), url: `https://github.com/example/kiosk-ui/pull/${n}`, title: `${keys[0]}: fix thing`, mergedAt: '2026-11-10T10:00:00Z', keys, tenants: ['AA-US'], files: files.map((name) => ({ name, status: 'modified' })), ...o });
const ledgerOf = (...prs) => ({ updated: '2026-11-13', prs: Object.fromEntries(prs.map((p) => [p.id, p])) });
const defect = (key, o = {}) => ({ key, summary: `${key} receipt total wrong`, components: ['FE'], clients: ['AA-US'], resolved: '2026-11-11T12:00:00', labels: [], ...o });
const cand = (key, files, o = {}) => K.candidateFor(defect(key, { category: 'Receipts and printing' }), pr(900 + Number(key.split('-')[1]), [key], files, o));
const makeRag = (rows = '', { header = HEADER, newline = true } = {}) => {
  const root = fs.mkdtempSync(path.join(tmp, 'rag-'));
  fs.mkdirSync(path.join(root, 'datafeeds'), { recursive: true });
  const file = path.join(root, 'datafeeds', 'defects.csv');
  fs.writeFileSync(file, header ? `${header}\n${rows}${rows && newline ? '\n' : ''}` : rows);
  return { root, file };
};

// ---------------------------------------------------------------- candidates
test('a candidate is built from the ticket and its ledger PR, with no real files meaning no candidate and no PR meaning none', () => {
  const c = K.candidateFor({ ...defect('NGK-1'), category: 'Receipts and printing' }, pr(5, ['NGK-1', 'NGK-2'], ['src/receipt.js', 'package-lock.json', 'logo.png', 'src/totals.js']));
  assert.deepEqual(c.files, ['src/receipt.js', 'src/totals.js']);                                    // lock files and images are not patterns
  assert.deepEqual([c.key, c.repo, c.prNumber, c.components, c.tenants, c.related, c.category, c.resolved], ['NGK-1', 'kiosk-ui', '5', ['FE'], ['AA-US'], ['NGK-2'], 'Receipts and printing', '2026-11-11']);
  assert.equal(K.candidateFor(defect('NGK-3'), undefined), null);                                      // not in the ledger: component analysis only
  assert.equal(K.candidateFor(defect('NGK-3'), pr(6, ['NGK-3'], ['package-lock.json', 'a.png'])), null);
  assert.deepEqual(K.candidateFor(defect('NGK-4', { clients: [] }), pr(7, ['NGK-4'], ['a.js'], { tenants: ['PENN-US'] })).tenants, ['PENN-US']);   // the PR's tenants when the ticket has no client
  assert.deepEqual(K.candidateFor(defect('NGK-5', { components: [], component: 'Menu Service (MS)' }), pr(8, ['NGK-5'], ['a.js'])).components, ['Menu Service (MS)']);
});

test('the ledger index maps a ticket to its latest merged PR', () => {
  const idx = K.ledgerIndex(ledgerOf(pr(1, ['NGK-1'], ['a.js'], { mergedAt: '2026-10-01T00:00:00Z' }), pr(2, ['NGK-1', 'NGK-9'], ['b.js'], { mergedAt: '2026-11-01T00:00:00Z' })));
  assert.equal(idx.get('NGK-1').number, '2'); assert.equal(idx.get('NGK-9').number, '2'); assert.equal(idx.get('NGK-404'), undefined);
  assert.equal(K.ledgerIndex({}).size, 0);
});

// ---------------------------------------------------------------- the row and the pattern test
test('the row fills what the ledger and ticket know, leaves the rest empty, reuses the feed columns, and scrubs secrets', () => {
  const c = cand('NGK-1', ['src/receipt.js', 'src/totals.js'], { title: 'NGK-1: fix totals password=hunter2secret' });
  const row = K.buildKbRow(c, '2026-11-14');
  assert.deepEqual([row.jira_id, row.status, row.repo, row.tenant_scope, row.tags, row.date_logged], ['NGK-1', 'fixed', 'kiosk-ui', 'AA-US', 'receipts-and-printing, fe', '2026-11-14']);
  assert.equal(row.fingerprint_files, 'src/receipt.js\nsrc/totals.js');
  assert.ok(row.fix_summary.includes('PR: https://github.com/example/kiosk-ui/pull/901'));
  assert.ok(!row.fix_summary.includes('hunter2secret')); assert.ok(row.fix_summary.includes('[redacted]'));
  assert.deepEqual(['root_cause', 'fingerprint_functions_config', 'repro_steps', 'test_case'].map((k) => row[k]), ['', '', '', '']);   // not guessed
});

test('a defect is an existing pattern only when every real file it touched is already in one feed row of the same repo', () => {
  const feed = [{ jira_id: 'NGK-50', repo: 'kiosk-ui', fingerprint_files: 'src/receipt.js\nsrc/totals.js\nsrc/other.js' }, { jira_id: 'NGK-60', repo: 'kiosk-web-service', fingerprint_files: 'src/menu.js' }];
  const m = (files, repo = 'kiosk-ui') => K.patternMatch(feed, { files, repo });
  assert.equal(m(['src/receipt.js', 'src/totals.js']), 'NGK-50');                                       // a subset of one row
  assert.equal(m(['SRC/RECEIPT.JS']), 'NGK-50');                                                        // case does not matter
  assert.equal(m(['src/receipt.js', 'src/brand-new.js']), null);                                        // one new file: a new pattern
  assert.equal(m(['other/receipt.js']), null);                                                           // same file name, different path: not a pattern
  assert.equal(m(['src/menu.js']), null);                                                                // the row is for another repo
  assert.equal(m(['src/menu.js'], 'kiosk-web-service'), 'NGK-60');
  assert.equal(K.patternMatch(feed, { files: [], repo: 'kiosk-ui' }), null);
  assert.equal(K.patternMatch([], { files: ['a.js'], repo: 'kiosk-ui' }), null);
});

// ---------------------------------------------------------------- schedule and settings
test('the daily sync is due once a day from the set hour, and never when switched off', () => {
  const at = (s) => new Date(s);
  assert.equal(K.syncDue({ now: at('2026-11-14T06:59:00'), lastRunAt: null, hour: 7 }), false);       // too early
  assert.equal(K.syncDue({ now: at('2026-11-14T07:00:00'), lastRunAt: null, hour: 7 }), true);
  assert.equal(K.syncDue({ now: at('2026-11-14T15:00:00'), lastRunAt: at('2026-11-14T07:05:00').toISOString(), hour: 7 }), false);   // already ran today
  assert.equal(K.syncDue({ now: at('2026-11-15T07:30:00'), lastRunAt: at('2026-11-14T07:05:00').toISOString(), hour: 7 }), true);    // the next day
  assert.equal(K.syncDue({ now: at('2026-11-14T15:00:00'), lastRunAt: null, hour: 7, disabled: true }), false);
  assert.deepEqual(K.kbConfig(() => '{}'), { disabled: false, hour: 7 });
  assert.deepEqual(K.kbConfig(() => JSON.stringify({ defectsKb: { disabled: true, hour: 22 } })), { disabled: true, hour: 22 });
  assert.equal(K.kbConfig(() => JSON.stringify({ defectsKb: { hour: 99 } })).hour, 7);                 // nonsense falls back
  assert.deepEqual(K.kbConfig(() => { throw new Error('no file'); }), { disabled: false, hour: 7 });
});

// ---------------------------------------------------------------- ingest
const fakeSpawn = (code, { error = false } = {}) => () => {
  const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
  setImmediate(() => { if (error) c.emit('error', new Error('spawn failed')); else { c.stderr.emit('data', 'boom line\n'); c.emit('close', code); } });
  return c;
};
test('ingest runs the RAG python on ingest.py from the RAG folder, and reports a missing setup, a failure or an error without throwing', async () => {
  const calls = [];
  const spy = (cmd, args, opts) => { calls.push([cmd, args, opts.cwd]); return fakeSpawn(0)(); };
  assert.deepEqual(await K.runIngest({ ragRoot: '/r', spawnFn: spy, exists: () => true }), { ok: true });
  assert.deepEqual(calls, [['/r/.venv/bin/python', ['/r/ingest.py'], '/r']]);
  assert.equal((await K.runIngest({ ragRoot: '/r', spawnFn: spy, exists: () => false })).ok, false);
  const bad = await K.runIngest({ ragRoot: '/r', spawnFn: fakeSpawn(2), exists: () => true });
  assert.equal(bad.ok, false); assert.match(bad.reason, /code 2: boom line/);
  assert.match((await K.runIngest({ ragRoot: '/r', spawnFn: fakeSpawn(0, { error: true }), exists: () => true })).reason, /spawn failed/);
  assert.equal(calls.length, 1);                                                                         // a missing setup never starts anything
});

// ---------------------------------------------------------------- the sync
test('the sync appends only new patterns, marks the rest, never rewrites the feed, and runs ingest once', async () => {
  reset();
  const existing = 'NGK-50,Old defect,fixed,kiosk-ui,all,receipts,sym,cause,"src/receipt.js\nsrc/totals.js",fn,steps,test,fix,,2026-10-01';
  const rag = makeRag(existing);
  const before = fs.readFileSync(rag.file, 'utf8');
  store.kbQueue([
    cand('NGK-1', ['src/receipt.js']),                       // a pattern NGK-50 already records
    cand('NGK-50', ['src/totals.js']),                       // the ticket is already in the feed
    cand('NGK-2', ['src/payment.js', 'src/cards.js']),       // new
    cand('NGK-3', ['src/payment.js']),                       // matches NGK-2, which this same run is writing
    cand('NGK-4', ['src/menu.js'], { repo: 'kiosk-menu-service' }),   // new, other repo
  ], '2026-11-13T10:00:00.000Z');
  let ingests = 0;
  const r = await K.syncKb({ ragRoot: rag.root, now: () => NOW, ingest: async () => { ingests++; return { ok: true }; } });
  assert.deepEqual([r.ok, r.written, r.matched, r.exists, r.ingest, ingests], [true, 2, 2, 1, 'ok', 1]);
  const after = fs.readFileSync(rag.file, 'utf8');
  assert.ok(after.startsWith(before));                                                                   // the existing bytes are untouched: only appended
  const feed = parseCsv(after);
  assert.deepEqual(feed.rows.map((x) => x.jira_id), ['NGK-50', 'NGK-2', 'NGK-4']);
  assert.deepEqual(feed.header, HEADER.split(','));                                                      // the feed's own columns, in its order
  const added = feed.rows[1];
  assert.deepEqual([added.repo, added.tags, added.date_logged, added.fingerprint_files], ['kiosk-ui', 'receipts-and-printing, fe', '2026-11-14', 'src/payment.js\nsrc/cards.js']);
  assert.deepEqual(store.kbCounts(), { pending: 0, written: 2, matched: 2, exists: 1 });
  assert.equal(store.kbState().lastRunAt, NOW.toISOString());
  const again = await K.syncKb({ ragRoot: rag.root, now: () => NOW, ingest: async () => { ingests++; return { ok: true }; } });
  assert.deepEqual([again.written, again.ingest, ingests], [0, 'none', 1]);                              // nothing waiting: no write and no ingest
  assert.equal(fs.readFileSync(rag.file, 'utf8'), after);
  reset();
});

test('a feed without a final newline gets one before the new rows, and a quoted comma in a title survives', async () => {
  reset();
  const rag = makeRag('NGK-50,T,fixed,kiosk-ui,all,x,,,src/a.js,,,,,,2026-10-01', { newline: false });
  store.kbQueue([cand('NGK-7', ['src/b.js'], { title: 'NGK-7: fix totals, tips and tax' })], '2026-11-13T10:00:00.000Z');
  await K.syncKb({ ragRoot: rag.root, now: () => NOW, ingest: async () => ({ ok: true }) });
  const feed = parseCsv(fs.readFileSync(rag.file, 'utf8'));
  assert.deepEqual(feed.rows.map((x) => x.jira_id), ['NGK-50', 'NGK-7']);
  assert.match(feed.rows[1].fix_summary, /fix totals, tips and tax/);
  reset();
});

test('when ingest fails the rows stay written, the failure is kept, and the next run tries ingest again even with nothing new', async () => {
  reset();
  const rag = makeRag('');
  store.kbQueue([cand('NGK-2', ['src/payment.js'])], '2026-11-13T10:00:00.000Z');
  const fail = await K.syncKb({ ragRoot: rag.root, now: () => NOW, ingest: async () => ({ ok: false, reason: 'ingest exited with code 1' }) });
  assert.deepEqual([fail.ok, fail.written, fail.ingest, fail.reason], [true, 1, 'failed', 'ingest exited with code 1']);
  assert.equal(store.kbState().ingestPending, true);
  let ingests = 0;
  const retry = await K.syncKb({ ragRoot: rag.root, now: () => new Date('2026-11-15T09:00:00'), ingest: async () => { ingests++; return { ok: true }; } });
  assert.deepEqual([retry.written, retry.ingest, ingests], [0, 'ok', 1]);
  assert.equal(store.kbState().ingestPending, false);
  reset();
});

test('a missing feed or a feed with no header writes nothing and keeps the queue for the next run', async () => {
  reset();
  store.kbQueue([cand('NGK-2', ['src/payment.js'])], '2026-11-13T10:00:00.000Z');
  const none = fs.mkdtempSync(path.join(tmp, 'rag-empty-'));
  let ingests = 0;
  const a = await K.syncKb({ ragRoot: none, now: () => NOW, ingest: async () => { ingests++; return { ok: true }; } });
  assert.deepEqual([a.ok, a.written, a.pending, ingests], [false, 0, 1, 0]); assert.match(a.reason, /not found/);
  assert.equal(fs.existsSync(path.join(none, 'datafeeds')), false);                                      // it never creates the feed or its folder
  const noHeader = makeRag('', { header: '' });
  assert.equal((await K.syncKb({ ragRoot: noHeader.root, now: () => NOW, ingest: async () => ({ ok: true }) })).ok, false);
  assert.equal(fs.readFileSync(noHeader.file, 'utf8'), '');
  assert.equal(store.kbCounts().pending, 1);
  reset();
});

// ---------------------------------------------------------------- queueing and the service
test('queueing takes the defects that have a PR in the ledger, once each, and counts the ones without', () => {
  reset();
  const ledger = ledgerOf(pr(1, ['NGK-1'], ['src/a.js']), pr(2, ['NGK-2'], ['package-lock.json']));
  const cat = () => 'Receipts and printing';
  const defects = [defect('NGK-1'), defect('NGK-2'), defect('NGK-3')];
  assert.deepEqual(K.queueDefects({ defects, ledger, categorize: cat, now: () => NOW }), { queued: 1, noPr: 2 });     // NGK-2 has only a lock file, NGK-3 no PR
  assert.deepEqual(K.queueDefects({ defects, ledger, categorize: cat, now: () => NOW }), { queued: 0, noPr: 2 });     // queued once
  assert.equal(store.kbCounts().pending, 1);
  reset();
});

test('running the AI analysis queues the defects in view that have a PR; the timer syncs only when due and something waits', async () => {
  reset();
  const rows = [
    { key: 'NGK-1', type: 'Defect', created: '2026-10-01T12:00:00', resolved: '2026-11-11T12:00:00', summary: 'Receipt total wrong', components: ['FE'], clients: ['AA-US'], labels: [], statusCategory: '', updated: null, firstSprintStart: null },
    { key: 'NGK-2', type: 'Story', created: '2026-10-01T12:00:00', resolved: '2026-11-11T12:00:00', summary: 'A story', components: ['FE'], clients: [], labels: [], statusCategory: '', updated: null, firstSprintStart: null },
    { key: 'NGK-3', type: 'Defect', created: '2026-10-01T12:00:00', resolved: '2026-11-11T12:00:00', summary: 'No PR for this one', components: [], clients: [], labels: [], statusCategory: '', updated: null, firstSprintStart: null },
  ];
  store.upsert(rows);
  const ledger = ledgerOf(pr(1, ['NGK-1', 'NGK-2'], ['src/receipt.js']));
  let syncs = 0; let clock = new Date('2026-11-14T06:00:00');
  const GOOD = JSON.stringify({ headline: 'h', focus: [{ title: 't', why: 'w', actions: ['a'], measure: 'm' }], caveats: [] });
  const svc = createTrendsService({ now: () => clock, ledger: () => ledger, claude: async () => ({ ok: true, text: GOOD }), kbSync: async () => { syncs++; return { ok: true }; } });
  svc.defectAnalysis({ months: 6 });
  assert.equal(store.kbCounts().pending, 0);                                                              // looking at the numbers queues nothing
  assert.equal((await svc.defectGuidance({ months: 6 })).ok, true);
  assert.deepEqual(store.kbPending().map((c) => c.key), ['NGK-1']);                                      // the story and the ticket without a PR are not queued
  svc.kbTick(); assert.equal(syncs, 0);                                                                   // 6 AM: before the sync hour
  clock = new Date('2026-11-14T08:00:00'); svc.kbTick();
  await new Promise((r) => setTimeout(r, 10)); assert.equal(syncs, 1);
  store.kbSaveRun({ at: clock.toISOString(), result: {}, ingestPending: false }); store.kbMark('NGK-1', 'written', clock.toISOString());
  clock = new Date('2026-11-15T08:00:00'); svc.kbTick(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(syncs, 1);                                                                                 // a new day but nothing waiting: not a run
  reset();
});

// ---------------------------------------------------------------- routes
const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};
test('the routes: status, sync now with its guard, a failed sync and a busy one', async () => {
  reset();
  store.kbQueue([cand('NGK-2', ['src/payment.js'])], '2026-11-13T10:00:00.000Z');
  let release; const gate = new Promise((r) => { release = r; }); let mode = 'ok';
  const svc = createTrendsService({ now: () => NOW, kbSync: async () => { if (mode === 'wait') await gate; return mode === 'fail' ? { ok: false, reason: 'The defects feed was not found' } : { ok: true, written: 1 }; } });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json()); app.use('/api', createTrendsRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const s = await call(server, 'GET', '/api/trends/kb/status');
    assert.equal(s.status, 200); assert.deepEqual([s.json.data.pending, s.json.data.hour, s.json.data.disabled], [1, 7, false]);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/kb/sync`, { method: 'POST' })).status, 415);   // JSON only
    const ok = await call(server, 'POST', '/api/trends/kb/sync', {});
    assert.equal(ok.status, 200); assert.equal(ok.json.data.run.written, 1);
    mode = 'fail'; const bad = await call(server, 'POST', '/api/trends/kb/sync', {});
    assert.equal(bad.status, 502); assert.match(bad.json.error, /not found/);
    mode = 'wait'; const first = call(server, 'POST', '/api/trends/kb/sync', {});
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call(server, 'POST', '/api/trends/kb/sync', {})).status, 409);
    release(); assert.equal((await first).status, 200);
  } finally { release?.(); server.close(); }
  reset();
});
