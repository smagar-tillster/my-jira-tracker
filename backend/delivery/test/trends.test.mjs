// Trends: counting tickets by month and type, the sync with Jira, and the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-trends-'));
process.env.DATA_DIR = tmp;
process.env.NGK_DATA_DIR = tmp;
const { initDb, getDb } = await import('../../src/db/database.js');
initDb();
const A = await import('../../src/services/trends/aggregate.js');
const store = await import('../../src/services/trends/store.js');
const S = await import('../../src/services/trends/sync.js');
const { createTrendsService } = await import('../../src/services/trends/service.js');
const { createTrendsRouter } = await import('../../src/routes/trends.js');

const reset = () => { getDb().exec('DELETE FROM trend_tickets; DELETE FROM trend_sync'); };
const NOW = new Date('2026-11-13T12:00:00');
const R = (key, type, o = {}) => ({ key, type, created: '2026-01-15T12:00:00.000', resolved: null, firstSprintStart: null, ...o });

// ---------------------------------------------------------------- months
test('a timestamp belongs to the month it falls in, and junk has none', () => {
  assert.equal(A.monthOf('2026-11-13T12:00:00'), '2026-11');
  assert.equal(A.monthOf('2026-01-01T12:00:00'), '2026-01');
  assert.equal(A.monthOf(''), null); assert.equal(A.monthOf(null), null); assert.equal(A.monthOf('not a date'), null);
  assert.deepEqual(A.monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(A.monthRange('2026-03', '2026-03'), ['2026-03']);
});

// ---------------------------------------------------------------- counting
const rows = () => [
  R('A-1', 'Story', { firstSprintStart: '2026-09-10T12:00:00', created: '2026-08-20T12:00:00', resolved: '2026-09-25T12:00:00' }),
  R('A-2', 'Story', { firstSprintStart: '2026-09-20T12:00:00', created: '2026-09-01T12:00:00', resolved: '2026-10-05T12:00:00' }),
  R('A-3', 'Defect', { firstSprintStart: '2026-10-05T12:00:00', created: '2026-10-01T12:00:00', resolved: '2026-10-09T12:00:00' }),
  R('A-4', 'Defect', { firstSprintStart: '2026-10-19T12:00:00', created: '2026-10-15T12:00:00' }),
  R('A-5', 'Task', { firstSprintStart: '2026-11-02T12:00:00', created: '2026-10-30T12:00:00' }),
  R('A-6', 'Story', { firstSprintStart: '2026-12-07T12:00:00', created: '2026-11-05T12:00:00' }),   // its sprint has not started
  R('A-7', 'Epic', { firstSprintStart: null, created: '2026-11-01T12:00:00' }),                       // no sprint start
  R('A-8', 'Story', { firstSprintStart: '2025-01-10T12:00:00', created: '2025-01-02T12:00:00', resolved: '2025-02-01T12:00:00' }),   // long ago
];

test('tickets are counted in the month of their first sprint, once each, with every month shown and zero-filled', () => {
  const a = A.aggregate({ rows: rows(), basis: 'sprint', months: 6, now: NOW });
  assert.deepEqual(a.months, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(a.counts.Story, [0, 0, 0, 2, 0, 0]);
  assert.deepEqual(a.counts.Defect, [0, 0, 0, 0, 2, 0]);
  assert.deepEqual(a.counts.Task, [0, 0, 0, 0, 0, 1]);
  assert.deepEqual(a.totals, [0, 0, 0, 2, 2, 1]);
  assert.equal(a.future, 1);                 // A-6: its sprint starts in December
  assert.equal(a.noDate, 1);                 // A-7: no sprint start (Epic)
  assert.equal(a.before, 1);                 // A-8: before the 6 months shown
  assert.equal(a.inRange, 5);
  assert.equal(a.tickets, 8);
  assert.deepEqual(a.totals, a.months.map((_, i) => Object.values(a.counts).reduce((n, c) => n + c[i], 0)));   // the columns add up
});

test('the same tickets can be counted by created month or resolved month instead', () => {
  const c = A.aggregate({ rows: rows(), basis: 'created', months: 6, now: NOW });
  assert.deepEqual(c.counts.Story, [0, 0, 1, 1, 0, 1]);                // A-1 Aug, A-2 Sep, A-6 Nov
  assert.equal(c.noDate, 0);
  const r = A.aggregate({ rows: rows(), basis: 'resolved', months: 6, now: NOW });
  assert.deepEqual(r.counts.Story, [0, 0, 0, 1, 1, 0]);                // A-1 Sep, A-2 Oct
  assert.deepEqual(r.counts.Defect, [0, 0, 0, 0, 1, 0]);               // only A-3 is resolved
  assert.equal(r.noDate, 4);                                           // the unresolved ones have no resolved month
});

test('types are ranked once over all tickets, so a type keeps its rank whatever basis or range is chosen', () => {
  const ranks = (o) => A.aggregate({ rows: rows(), now: NOW, ...o }).types.map((t) => `${t.name}:${t.rank}`).join(' ');
  const base = ranks({ basis: 'sprint', months: 12 });
  assert.equal(base, 'Story:1 Defect:2 Epic:3 Task:4');                // Story 4, Defect 2, then ties by name
  assert.equal(ranks({ basis: 'created', months: 6 }), base);
  assert.equal(ranks({ basis: 'resolved', months: 24 }), base);
  assert.equal(ranks({ basis: 'sprint', months: 'all' }), base);
});

test('a range is exactly that many months ending now; "all" starts at the first month with a ticket', () => {
  assert.equal(A.aggregate({ rows: rows(), months: 12, now: NOW }).months.length, 12);
  assert.equal(A.aggregate({ rows: rows(), months: 24, now: NOW }).months.at(-1), '2026-11');
  const all = A.aggregate({ rows: rows(), basis: 'sprint', months: 'all', now: NOW });
  assert.equal(all.months[0], '2025-01'); assert.equal(all.months.at(-1), '2026-11'); assert.equal(all.before, 0);
  assert.equal(all.counts.Story[0], 1);
  assert.deepEqual(A.aggregate({ rows: [], now: NOW }).months, ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.throws(() => A.aggregate({ rows: [], basis: 'nonsense', now: NOW }), /basis must be one of/);
});

// ---------------------------------------------------------------- sync
const issue = (key, type, o = {}) => ({ key, fields: { issuetype: { name: type }, created: '2026-01-15T12:00:00.000-0800', resolutiondate: null, status: { statusCategory: { name: 'To Do' } }, updated: '2026-11-01T12:00:00.000-0800', customfield_10007: [], ...o } });

test('a Jira ticket becomes a row: the earliest valid sprint start, a safe type, nulls for what is missing', () => {
  const r = S.toRow(issue('N-1', 'Story', { customfield_10007: [{ id: 2, startDate: '2026-10-20T08:00:00.000Z' }, { id: 1, startDate: '2026-10-06T08:00:00.000Z' }, { id: 3 }, { id: 4, startDate: 'garbage' }] }));
  assert.equal(r.firstSprintStart, '2026-10-06T08:00:00.000Z');
  assert.equal(r.type, 'Story'); assert.equal(r.resolved, null); assert.equal(r.statusCategory, 'To Do');
  const bare = S.toRow({ key: 'N-2', fields: {} });
  assert.deepEqual({ type: bare.type, created: bare.created, firstSprintStart: bare.firstSprintStart, statusCategory: bare.statusCategory }, { type: 'Unknown', created: null, firstSprintStart: null, statusCategory: '' });
  assert.equal(S.toRow(issue('N-3', 'Story', { customfield_10007: null })).firstSprintStart, null);
});

test('the search asks for every ticket in any sprint, or only what changed since the last sync with a margin', () => {
  assert.equal(S.buildJql({ full: true, project: 'NGK' }), 'project = NGK AND sprint is not EMPTY ORDER BY created ASC');
  const inc = S.buildJql({ full: false, lastSyncAt: '2026-11-13T20:00:00.000Z', project: 'NGK' });
  assert.match(inc, /^project = NGK AND sprint is not EMPTY AND updated >= "\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}" ORDER BY created ASC$/);
  assert.ok(!S.buildJql({ full: true, project: 'NGK' }).includes('updated'));
  assert.deepEqual(S.FIELDS, ['issuetype', 'created', 'resolutiondate', 'status', 'updated', 'customfield_10007']);   // only what the trends use
});

test('the first sync reads everything, later ones only changes, and a full one drops tickets that left every sprint', async () => {
  reset();
  const asked = [];
  const search = (data) => async (jql) => { asked.push(jql); return data; };
  const t = (ms) => () => new Date(ms);
  const T0 = Date.parse('2026-11-13T10:00:00Z');

  const first = await S.runTrendsSync({ searchJira: search([issue('N-1', 'Story'), issue('N-2', 'Defect'), issue('N-3', 'Task')]), now: t(T0) });
  assert.deepEqual([first.ok, first.full, first.read, first.total], [true, true, 3, 3]);
  assert.ok(!asked[0].includes('updated >='));

  const second = await S.runTrendsSync({ searchJira: search([issue('N-2', 'Story'), issue('N-4', 'Epic')]), now: t(T0 + 3600000) });     // N-2 changed type, N-4 is new
  assert.deepEqual([second.full, second.read, second.total], [false, 2, 4]);
  assert.match(asked[1], /updated >= /);
  assert.equal(store.allRows().find((r) => r.key === 'N-2').type, 'Story');                                                              // updated in place
  assert.equal(store.count(), 4);                                                                                                        // nothing was dropped

  const weekLater = await S.runTrendsSync({ searchJira: search([issue('N-1', 'Story'), issue('N-4', 'Epic')]), now: t(T0 + 8 * 86400000) });
  assert.equal(weekLater.full, true);                                                                                                    // a week since the last full read
  assert.deepEqual(store.allRows().map((r) => r.key).sort(), ['N-1', 'N-4']);                                                            // N-2 and N-3 left every sprint

  const forced = await S.runTrendsSync({ searchJira: search([issue('N-1', 'Story')]), force: 'full', now: t(T0 + 8 * 86400000 + 60000) });
  assert.equal(forced.full, true); assert.equal(store.count(), 1);
  reset();
});

test('a failed sync is reported, keeps the old data and does not move the marks', async () => {
  reset();
  await S.runTrendsSync({ searchJira: async () => [issue('N-1', 'Story')], now: () => new Date('2026-11-13T10:00:00Z') });
  const before = store.getSync();
  const bad = await S.runTrendsSync({ searchJira: async () => { throw new Error('Jira said no'); }, now: () => new Date('2026-11-13T12:00:00Z') });
  assert.deepEqual(bad, { ok: false, full: false, error: 'Jira said no' });
  const after = store.getSync();
  assert.equal(after.lastStatus, 'failed'); assert.equal(after.lastError, 'Jira said no');
  assert.equal(after.lastSyncAt, before.lastSyncAt); assert.equal(after.lastFullAt, before.lastFullAt);
  assert.equal(store.count(), 1);
  reset();
});

// ---------------------------------------------------------------- service and routes
const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('the service syncs on its own when nothing was read yet or the last read is 2 hours old, never twice at once', async () => {
  reset();
  let clock = new Date('2026-11-13T10:00:00Z'); let runs = 0; let release;
  const svc = createTrendsService({ sync: () => { runs++; return new Promise((r) => { release = r; }); }, now: () => clock });
  svc.tick(); assert.equal(runs, 1); assert.equal(svc.isRunning(), true);
  svc.tick(); assert.equal(runs, 1);                                          // one at a time
  release(); await new Promise((r) => setTimeout(r, 5));
  store.finishSync({ status: 'ok', durationMs: 1, at: clock.toISOString(), full: true, count: 0 });
  clock = new Date('2026-11-13T11:30:00Z'); svc.tick(); assert.equal(runs, 1);   // 90 minutes: not yet
  clock = new Date('2026-11-13T12:05:00Z'); svc.tick(); assert.equal(runs, 2);   // over 2 hours
  release(); await new Promise((r) => setTimeout(r, 5));
  reset();
});

test('the routes: counts by month and type, a bad request, and Run refresh with its guard', async () => {
  reset();
  store.upsert(rows().map((r) => ({ ...r, statusCategory: '', updated: null })));
  store.finishSync({ status: 'ok', durationMs: 5, at: '2026-11-13T10:00:00.000Z', full: true, count: 8 });
  let openGate; const gate = new Promise((r) => { openGate = r; });
  const svc = createTrendsService({ sync: async () => { await gate; return { ok: true }; }, now: () => NOW });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json()); app.use('/api', createTrendsRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const ok = await call(server, 'GET', '/api/trends/sprint-tickets?basis=sprint&months=6');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.data.months.length, 6);
    assert.deepEqual(ok.json.data.counts.Story, [0, 0, 0, 2, 0, 0]);
    assert.equal(ok.json.data.status.tickets, 8);
    const def = await call(server, 'GET', '/api/trends/sprint-tickets');                  // defaults: sprint basis, 12 months
    assert.equal(def.json.data.basis, 'sprint'); assert.equal(def.json.data.months.length, 12);
    assert.equal((await call(server, 'GET', '/api/trends/sprint-tickets?months=all')).json.data.months[0], '2025-01');
    for (const bad of ['?basis=nope', '?months=7', '?months=abc']) assert.equal((await call(server, 'GET', `/api/trends/sprint-tickets${bad}`)).status, 400, bad);

    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/refresh`, { method: 'POST' })).status, 415);   // JSON only
    assert.equal((await call(server, 'POST', '/api/trends/refresh', {})).status, 202);
    assert.equal((await call(server, 'POST', '/api/trends/refresh', {})).status, 409);                                              // already running
    assert.equal((await call(server, 'GET', '/api/trends/status')).json.data.running, true);
    openGate();
    for (let i = 0; i < 100 && svc.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await call(server, 'GET', '/api/trends/status')).json.data.running, false);
  } finally { server.close(); }
  reset();
});
