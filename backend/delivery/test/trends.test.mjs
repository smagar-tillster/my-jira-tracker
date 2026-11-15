// Trends: counting tickets by month and type, client or assignee, the manual read from Jira, and the routes.
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
const R = (key, type, o = {}) => ({ key, type, created: '2026-01-15T12:00:00.000', resolved: null, firstSprintStart: null, assignee: null, clients: [], ...o });

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
  R('A-1', 'Story', { firstSprintStart: '2026-09-10T12:00:00', created: '2026-08-20T12:00:00', resolved: '2026-09-25T12:00:00', assignee: 'Ann', clients: ['BK'] }),
  R('A-2', 'Story', { firstSprintStart: '2026-09-20T12:00:00', created: '2026-09-01T12:00:00', resolved: '2026-10-05T12:00:00', assignee: 'Bob', clients: ['BK', 'PLK'] }),
  R('A-3', 'Defect', { firstSprintStart: '2026-10-05T12:00:00', created: '2026-10-01T12:00:00', resolved: '2026-10-09T12:00:00', assignee: 'Ann', clients: ['PLK'] }),
  R('A-4', 'Defect', { firstSprintStart: '2026-10-19T12:00:00', created: '2026-10-15T12:00:00', assignee: null, clients: [] }),
  R('A-5', 'Task', { firstSprintStart: '2026-11-02T12:00:00', created: '2026-10-30T12:00:00', assignee: 'Bob', clients: ['BK'] }),
  R('A-6', 'Story', { firstSprintStart: '2026-12-07T12:00:00', created: '2026-11-05T12:00:00' }),   // its sprint has not started
  R('A-7', 'Epic', { firstSprintStart: null, created: '2026-11-01T12:00:00' }),                       // no sprint start
  R('A-8', 'Story', { firstSprintStart: '2025-01-10T12:00:00', created: '2025-01-02T12:00:00', resolved: '2025-02-01T12:00:00' }),   // long ago
];

test('tickets are counted in the month of their first sprint, once each, with every month shown and zero-filled', () => {
  const a = A.aggregate({ rows: rows(), basis: 'sprint', group: 'type', months: 6, now: NOW });
  assert.deepEqual(a.months, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(a.counts.Story, [0, 0, 0, 2, 0, 0]);
  assert.deepEqual(a.counts.Defect, [0, 0, 0, 0, 2, 0]);
  assert.deepEqual(a.counts.Task, [0, 0, 0, 0, 0, 1]);
  assert.deepEqual(a.totals, [0, 0, 0, 2, 2, 1]);
  assert.deepEqual([a.future, a.noDate, a.before, a.inRange, a.tickets, a.matching], [1, 1, 1, 5, 8, 8]);
  assert.deepEqual(a.totals, a.months.map((_, i) => Object.values(a.counts).reduce((n, c) => n + c[i], 0)));   // by type the columns add up
});

test('3 months is the last three; there is no "all" any more', () => {
  const a = A.aggregate({ rows: rows(), months: 3, now: NOW });
  assert.deepEqual(a.months, ['2026-09', '2026-10', '2026-11']);
  assert.equal(a.before, 1 + 0);                                  // A-8 only: A-1..A-5 start in Sep to Nov
  assert.equal(A.aggregate({ rows: [], now: NOW }).months.length, 6);   // the default
});

test('the first and last instants of a month fall in that month (this machine\'s time), and the month before the range is not shown', () => {
  const edge = [R('E-1', 'Story', { resolved: '2026-06-01T00:00:00' }), R('E-2', 'Story', { resolved: '2026-05-31T23:59:59' }), R('E-3', 'Story', { resolved: '2026-11-13T23:59:59' }), R('E-4', 'Story', { resolved: '2026-06-30T23:59:59' }), R('E-5', 'Story', { resolved: '2026-07-01T00:00:00' })];
  const a = A.aggregate({ rows: edge, basis: 'resolved', months: 6, now: NOW });
  assert.deepEqual(a.months[0], '2026-06');
  assert.deepEqual(a.totals, [2, 1, 0, 0, 0, 1]);                      // June: E-1, E-4; July: E-5; November: E-3
  assert.equal(a.before, 1);                                           // E-2 is May 31: read for safety, not shown
  assert.equal(A.aggregate({ rows: edge, basis: 'resolved', months: 3, now: NOW }).before, 4);   // a 3-month range starts in September
});

test('the same tickets can be counted by created month or resolved month instead', () => {
  const c = A.aggregate({ rows: rows(), basis: 'created', group: 'type', months: 6, now: NOW });
  assert.deepEqual(c.counts.Story, [0, 0, 1, 1, 0, 1]);
  const r = A.aggregate({ rows: rows(), basis: 'resolved', group: 'type', months: 6, now: NOW });
  assert.deepEqual(r.counts.Story, [0, 0, 0, 1, 1, 0]);
  assert.deepEqual(r.counts.Defect, [0, 0, 0, 0, 1, 0]);
  assert.equal(r.noDate, 4);
  assert.throws(() => A.aggregate({ rows: [], basis: 'nonsense', now: NOW }), /basis must be one of/);
  assert.throws(() => A.aggregate({ rows: [], group: 'nonsense', now: NOW }), /group must be one of/);
});

test('grouped by client a ticket counts under each of its clients, and one with none is "No client"; the month totals stay distinct tickets', () => {
  const a = A.aggregate({ rows: rows(), group: 'client', months: 6, now: NOW });
  assert.deepEqual(a.counts.BK, [0, 0, 0, 2, 0, 1]);             // A-1, A-2 in Sep; A-5 in Nov
  assert.deepEqual(a.counts.PLK, [0, 0, 0, 1, 1, 0]);            // A-2 in Sep; A-3 in Oct
  assert.deepEqual(a.counts['No client'], [0, 0, 0, 0, 1, 0]);   // A-4
  assert.deepEqual(a.totals, [0, 0, 0, 2, 2, 1]);                // A-2 is one ticket although it is under two clients
  assert.deepEqual(a.series.map((s) => s.name), ['BK', 'PLK', 'No client']);   // ranked by tickets in the months shown: 3, 2, 1
});

test('with no split there is one line, All tickets, which is the month totals', () => {
  const a = A.aggregate({ rows: rows(), months: 6, now: NOW });
  assert.equal(a.group, 'all');
  assert.deepEqual(a.series.map((s) => s.name), ['All tickets']);
  assert.deepEqual(a.counts['All tickets'], a.totals);
});

test('the tile numbers: stories, defects and the top client, over the tickets in view only', () => {
  const a = A.aggregate({ rows: rows(), months: 6, now: NOW });
  assert.deepEqual(a.summary, { stories: 2, defects: 2, topClient: { name: 'BK', count: 3 } });   // A-1, A-2 (Story), A-3, A-4 (Defect); A-6, A-8 are not in view
  assert.deepEqual(A.aggregate({ rows: rows(), months: 6, filters: { assignee: 'Ann' }, now: NOW }).summary, { stories: 1, defects: 1, topClient: { name: 'BK', count: 1 } });   // PLK ties and sorts after BK
  assert.equal(A.aggregate({ rows: [], now: NOW }).summary.topClient, null);
});

test('grouped by assignee, nobody is "Unassigned"', () => {
  const a = A.aggregate({ rows: rows(), group: 'assignee', months: 6, now: NOW });
  assert.deepEqual(a.counts.Ann, [0, 0, 0, 1, 1, 0]);
  assert.deepEqual(a.counts.Bob, [0, 0, 0, 1, 0, 1]);
  assert.deepEqual(a.counts.Unassigned, [0, 0, 0, 0, 1, 0]);
});

test('filters narrow the tickets; FE team keeps the members only; menus list every value', () => {
  const fe = new Set(['Ann']);
  const byType = (filters) => A.aggregate({ rows: rows(), group: 'type', months: 6, filters, feMembers: fe, now: NOW });
  assert.deepEqual(byType({ feTeam: true }).counts, { Story: [0, 0, 0, 1, 0, 0], Defect: [0, 0, 0, 0, 1, 0] });
  assert.deepEqual(byType({ client: 'PLK' }).totals, [0, 0, 0, 1, 1, 0]);
  assert.deepEqual(byType({ assignee: 'Unassigned' }).totals, [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(byType({ type: 'Defect', feTeam: true }).totals, [0, 0, 0, 0, 1, 0]);
  const none = byType({ client: 'Nobody' });
  assert.deepEqual([none.series.length, none.matching, none.inRange], [0, 0, 0]);
  const all = byType({});
  assert.deepEqual(all.options.clients, ['BK', 'No client', 'PLK']);
  assert.deepEqual(all.options.assignees, ['Ann', 'Bob', 'Unassigned']);
  assert.deepEqual(all.options.types, ['Defect', 'Epic', 'Story', 'Task']);
  assert.equal(byType({ feTeam: true }).options.clients.length, 3);       // menus do not shrink with the filters
});

test('a filter can hold several values: a ticket matches any of them, and the filters still all have to match', () => {
  const by = (filters) => A.aggregate({ rows: rows(), basis: 'sprint', months: 6, filters, now: NOW }).totals;
  assert.deepEqual(by({ client: ['PLK', 'No client'] }), [0, 0, 0, 1, 2, 0]);               // A-2 (BK and PLK) and A-3 (PLK) plus A-4 (none)
  assert.deepEqual(by({ assignee: ['Ann', 'Bob'] }), [0, 0, 0, 2, 1, 1]);
  assert.deepEqual(by({ assignee: ['Ann', 'Bob'], type: ['Defect', 'Task'] }), [0, 0, 0, 0, 1, 1]);   // A-3 (Ann, Defect) and A-5 (Bob, Task)
  assert.deepEqual(by({ client: 'BK' }), by({ client: ['BK'] }));                              // one value or a list of one
  assert.deepEqual(by({ client: [], type: [''] }), by({}));                                    // empty lists mean no filter
  assert.deepEqual(by({ client: ['Nobody', 'Nobody else'] }), [0, 0, 0, 0, 0, 0]);
});

test('series are ranked by their tickets in view, and only those with tickets in view are listed', () => {
  const rk = (o) => A.aggregate({ rows: rows(), group: 'type', now: NOW, ...o }).series.map((t) => `${t.name}:${t.rank}:${t.total}`).join(' ');
  assert.equal(rk({}), 'Defect:1:2 Story:2:2 Task:3:1');                       // A-6 (future), A-7 (no date) and A-8 (old) are not in view
  assert.equal(rk({ basis: 'created', months: 3 }), 'Defect:1:2 Story:2:2 Epic:3:1 Task:4:1');   // A-7 (Epic) was created in November
  assert.equal(rk({ filters: { client: 'BK' } }), 'Story:1:2 Task:2:1');         // ranks close up when a filter removes series
  assert.equal(A.aggregate({ rows: rows(), months: 3, now: NOW }).series.every((s) => s.total === A.aggregate({ rows: rows(), months: 3, now: NOW }).counts[s.name].reduce((a, b) => a + b, 0)), true);
});

// ---------------------------------------------------------------- reading Jira
const issue = (key, type, o = {}) => ({ key, fields: { issuetype: { name: type }, created: '2026-01-15T12:00:00.000-0800', resolutiondate: null, status: { statusCategory: { name: 'To Do' } }, updated: '2026-11-01T12:00:00.000-0800', assignee: null, customfield_16047: [], customfield_10007: [], ...o } });

test('a Jira ticket becomes a row: earliest valid sprint start, assignee, distinct clients, safe defaults', () => {
  const r = S.toRow(issue('N-1', 'Story', { assignee: { displayName: 'Ann' }, customfield_16047: [{ value: 'BK' }, { value: 'BK' }, { value: 'PLK' }, {}], customfield_10007: [{ id: 2, startDate: '2026-10-20T08:00:00.000Z' }, { id: 1, startDate: '2026-10-06T08:00:00.000Z' }, { id: 3 }, { id: 4, startDate: 'garbage' }] }));
  assert.equal(r.firstSprintStart, '2026-10-06T08:00:00.000Z');
  assert.equal(r.assignee, 'Ann'); assert.deepEqual(r.clients, ['BK', 'PLK']);
  const bare = S.toRow({ key: 'N-2', fields: {} });
  assert.deepEqual({ type: bare.type, assignee: bare.assignee, clients: bare.clients, firstSprintStart: bare.firstSprintStart }, { type: 'Unknown', assignee: null, clients: [], firstSprintStart: null });
  assert.equal(S.toRow(issue('N-3', 'Story', { customfield_10007: null, customfield_16047: null })).firstSprintStart, null);
});

test('the search asks only for done NGK Sprint tickets resolved in the last 6 months, and only the fields the trends use', () => {
  assert.equal(S.buildJql({ project: 'NGK' }), 'project = NGK AND sprint in ("NGK Sprint") AND type NOT IN (Release, "Test Case Execution-Smoke/Sanity/Regression", Epic) AND issuetype not in subTaskIssueTypes() AND statusCategory = Done AND resolved >= startOfMonth(-6) ORDER BY created ASC');   // 6 months shown, read one month further
  assert.match(S.buildJql({ project: 'NGK', months: 3 }), /resolved >= startOfMonth\(-3\)/);
  assert.ok(!/openSprints/i.test(S.buildJql()));                    // past sprints count too
  assert.deepEqual(S.FIELDS, ['issuetype', 'created', 'resolutiondate', 'status', 'updated', 'assignee', 'customfield_16047', 'customfield_10007', 'summary', 'description', 'components', 'labels', 'priority']);
});

test('a read replaces the copy with what Jira returned, assignee and clients included', async () => {
  reset();
  const asked = [];
  const search = (data) => async (jql) => { asked.push(jql); return data; };
  const first = await S.runTrendsSync({ searchJira: search([issue('N-1', 'Story', { assignee: { displayName: 'Ann' }, customfield_16047: [{ value: 'BK' }] }), issue('N-2', 'Defect')]), now: () => new Date('2026-11-13T10:00:00Z') });
  assert.deepEqual([first.ok, first.read, first.total], [true, 2, 2]);
  assert.deepEqual(store.allRows().find((r) => r.key === 'N-1').clients, ['BK']);
  assert.equal(store.allRows().find((r) => r.key === 'N-1').assignee, 'Ann');
  const second = await S.runTrendsSync({ searchJira: search([issue('N-2', 'Story'), issue('N-4', 'Epic')]), now: () => new Date('2026-11-13T12:00:00Z') });
  assert.equal(second.total, 2);
  assert.deepEqual(store.allRows().map((r) => `${r.key}:${r.type}`).sort(), ['N-2:Story', 'N-4:Epic']);   // N-1 dropped, N-2 updated
  assert.equal(store.getSync().lastSyncAt, '2026-11-13T12:00:00.000Z');
  reset();
});

test('a failed read is reported, keeps the old data and does not move the mark', async () => {
  reset();
  await S.runTrendsSync({ searchJira: async () => [issue('N-1', 'Story')], now: () => new Date('2026-11-13T10:00:00Z') });
  const before = store.getSync();
  const bad = await S.runTrendsSync({ searchJira: async () => { throw new Error('Jira said no'); }, now: () => new Date('2026-11-13T12:00:00Z') });
  assert.deepEqual(bad, { ok: false, error: 'Jira said no' });
  const after = store.getSync();
  assert.equal(after.lastStatus, 'failed'); assert.equal(after.lastError, 'Jira said no'); assert.equal(after.lastSyncAt, before.lastSyncAt);
  assert.equal(store.count(), 1);
  reset();
});

test('an old table without the assignee and clients columns is upgraded by initDb', () => {
  const db = getDb();
  db.exec('DROP TABLE trend_tickets; CREATE TABLE trend_tickets (issue_key TEXT PRIMARY KEY, type TEXT NOT NULL, created TEXT, resolved TEXT, status_category TEXT, first_sprint_start TEXT, updated TEXT)');
  db.exec("INSERT INTO trend_tickets (issue_key, type) VALUES ('OLD-1', 'Story')");
  initDb();
  assert.deepEqual(store.allRows().map((r) => [r.key, r.assignee, r.clients]), [['OLD-1', null, []]]);
  reset();
});

// ---------------------------------------------------------------- service and routes
const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('nothing reads Jira on its own: the service has no timer, and a read is one at a time', async () => {
  reset();
  let runs = 0; let release;
  const svc = createTrendsService({ sync: () => { runs++; return new Promise((r) => { release = r; }); }, now: () => NOW });
  assert.equal(svc.start, undefined); assert.equal(svc.tick, undefined);
  assert.equal(runs, 0);
  assert.equal(svc.refresh(), true); assert.equal(svc.refresh(), false); assert.equal(runs, 1);
  release(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(svc.isRunning(), false);
  reset();
});

test('the routes: counts with group and filters, bad requests, and Refresh with its guard', async () => {
  reset();
  store.upsert(rows().map((r) => ({ ...r, statusCategory: '', updated: null })));
  store.finishSync({ status: 'ok', durationMs: 5, at: '2026-11-13T10:00:00.000Z', full: true, count: 8 });
  let openGate; const gate = new Promise((r) => { openGate = r; });
  const svc = createTrendsService({ sync: async () => { await gate; return { ok: true }; }, now: () => NOW, feMembers: () => new Set(['Ann']) });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json()); app.use('/api', createTrendsRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const ok = await call(server, 'GET', '/api/trends/sprint-tickets?basis=sprint&months=6&group=type');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.months.length, 6);
    assert.deepEqual(ok.json.data.counts.Story, [0, 0, 0, 2, 0, 0]);
    assert.equal(ok.json.data.status.tickets, 8);
    const def = await call(server, 'GET', '/api/trends/sprint-tickets');
    assert.deepEqual([def.json.data.basis, def.json.data.group, def.json.data.months.length], ['resolved', 'all', 6]);
    const byClient = await call(server, 'GET', '/api/trends/sprint-tickets?basis=sprint&group=client');
    assert.deepEqual(byClient.json.data.counts.BK, [0, 0, 0, 2, 0, 1]);
    const fe = await call(server, 'GET', '/api/trends/sprint-tickets?group=assignee&feTeam=1');
    assert.deepEqual(fe.json.data.series.map((s) => s.name), ['Ann']);
    const filtered = await call(server, 'GET', `/api/trends/sprint-tickets?basis=sprint&client=${encodeURIComponent('No client')}&type=Defect`);
    assert.deepEqual(filtered.json.data.totals, [0, 0, 0, 0, 1, 0]);
    const several = await call(server, 'GET', `/api/trends/sprint-tickets?basis=sprint&client=BK&client=PLK&assignee=Ann&assignee=Bob`);   // repeated values
    assert.deepEqual(several.json.data.totals, [0, 0, 0, 2, 1, 1]);
    for (const bad of ['?basis=nope', '?months=12', '?months=all', '?months=abc', '?group=nope']) assert.equal((await call(server, 'GET', `/api/trends/sprint-tickets${bad}`)).status, 400, bad);

    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/refresh`, { method: 'POST' })).status, 415);   // JSON only
    assert.equal((await call(server, 'POST', '/api/trends/refresh', {})).status, 202);
    assert.equal((await call(server, 'POST', '/api/trends/refresh', {})).status, 409);
    assert.equal((await call(server, 'GET', '/api/trends/status')).json.data.running, true);
    openGate();
    for (let i = 0; i < 100 && svc.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await call(server, 'GET', '/api/trends/status')).json.data.running, false);
  } finally { server.close(); }
  reset();
});
