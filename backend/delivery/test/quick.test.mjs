// Quick Analysis: schedule, new-ticket detection, FE team and suggestions, priority, model-answer checks, a whole run, and the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-quick-'));
process.env.DATA_DIR = tmp;
process.env.NGK_DATA_DIR = tmp;
const { initDb, getDb } = await import('../../src/db/database.js');
initDb();
const R = await import('../../src/services/quick/rules.js');
const A = await import('../../src/services/quick/ai.js');
const store = await import('../../src/services/quick/store.js');
const { runQuickAnalysis, view } = await import('../../src/services/quick/runner.js');
const { createQuickService } = await import('../../src/services/quick/service.js');
const { createQuickRouter } = await import('../../src/routes/quick.js');
const { bucketOf: frontBucket } = await import('../../../frontend/src/utils/statusBuckets.ts');

const reset = () => { for (const t of ['qa_known', 'qa_new', 'qa_analysis', 'qa_state']) getDb().exec(`DELETE FROM ${t}`); };
const at = (s) => new Date(`${s}`);   // local time, like the schedule

// ---------------------------------------------------------------- schedule
test('working time: 7:00 up to but not including 18:00, Monday to Friday', () => {
  assert.equal(R.isWorkingTime(at('2026-11-10T07:00:00')), true);    // Tuesday
  assert.equal(R.isWorkingTime(at('2026-11-10T06:59:59')), false);
  assert.equal(R.isWorkingTime(at('2026-11-10T17:59:59')), true);
  assert.equal(R.isWorkingTime(at('2026-11-10T18:00:00')), false);
  assert.equal(R.isWorkingTime(at('2026-11-14T10:00:00')), false);   // Saturday
  assert.equal(R.isWorkingTime(at('2026-11-15T10:00:00')), false);   // Sunday
  assert.equal(R.isWorkingTime(at('2026-11-14T10:00:00'), { ...R.DEFAULT_SCHEDULE, weekdaysOnly: false }), true);
});

test('a run is due every 15 minutes inside working hours, and at once when there was none', () => {
  const now = at('2026-11-10T09:30:00');
  assert.equal(R.isDue(now, null), true);
  assert.equal(R.isDue(now, now.getTime() - 14 * 60000), false);
  assert.equal(R.isDue(now, now.getTime() - 15 * 60000), true);
  assert.equal(R.isDue(at('2026-11-10T19:00:00'), null), false);
  assert.equal(R.isDue(at('2026-11-14T09:30:00'), null), false);
});

test('the next run is 15 minutes after the last, or the next morning, or Monday', () => {
  const next = (nowS, lastS) => R.nextRunAt(at(nowS), lastS ? at(lastS).getTime() : null).toISOString();
  assert.equal(next('2026-11-10T09:10:00', '2026-11-10T09:00:00'), at('2026-11-10T09:15:00').toISOString());
  assert.equal(next('2026-11-10T09:40:00', '2026-11-10T09:00:00'), at('2026-11-10T09:40:00').toISOString());    // overdue: now
  assert.equal(next('2026-11-10T05:00:00', null), at('2026-11-10T07:00:00').toISOString());                   // before hours
  assert.equal(next('2026-11-10T17:50:00', '2026-11-10T17:45:00'), at('2026-11-11T07:00:00').toISOString());   // 18:00 is out: tomorrow
  assert.equal(next('2026-11-13T17:50:00', '2026-11-13T17:45:00'), at('2026-11-16T07:00:00').toISOString());   // Friday evening: Monday
  assert.equal(next('2026-11-14T12:00:00', null), at('2026-11-16T07:00:00').toISOString());                    // Saturday: Monday
});

// ---------------------------------------------------------------- tickets
test('status buckets here agree with the frontend rule', () => {
  const rows = [['Blocked', 'In Progress'], ['Waiting for Client', 'To Do'], ['To Do', 'To Do'], ['Backlog', 'To Do'], ['In Development', 'In Progress'], ['Code Review', 'In Progress'],
    ['Returned by QA', 'In Progress'], ['Ready for QA', 'In Progress'], ['In UAT', 'In Progress'], ['Released', 'Done'], ['Shipped', 'Done'], ['Blocked by QA', 'In Progress'], ['', undefined]];
  for (const [status, statusCategory] of rows) assert.equal(R.bucketOf({ status, statusCategory }), frontBucket({ status, statusCategory }), status);
});

test('FE means a component named FE, not one that contains the letters', () => {
  for (const c of ['FE', 'fe', 'FE Team', 'kiosk-FE', 'FE/Config']) assert.equal(R.isFE({ components: ['Menu', c] }), true, c);
  for (const c of ['Feature', 'Safe', 'Menu', 'GTM', 'PROD/config.json', 'Defense']) assert.equal(R.isFE({ components: [c] }), false, c);
  assert.equal(R.isFE({}), false);
});

test('new tickets are the ones not seen before; the first run only counts what was created in the last 2 days', () => {
  const now = at('2026-11-10T09:00:00');
  const sprint = [{ key: 'NGK-1', created: '2026-10-01T10:00:00.000-0700' }, { key: 'NGK-2', created: '2026-11-09T10:00:00.000-0700' }, { key: 'NGK-3', created: '2026-11-10T08:00:00.000-0700' }];
  assert.deepEqual(R.findNewKeys({ currentIssues: sprint, knownKeys: new Set(), now }), { baseline: true, newKeys: ['NGK-2', 'NGK-3'] });
  assert.deepEqual(R.findNewKeys({ currentIssues: sprint, knownKeys: new Set(['NGK-1', 'NGK-2']), now }), { baseline: false, newKeys: ['NGK-3'] });
  assert.deepEqual(R.findNewKeys({ currentIssues: sprint, knownKeys: new Set(['NGK-1', 'NGK-2', 'NGK-3']), now }).newKeys, []);
});

const T = (o) => ({ key: 'NGK-1', summary: 's', status: 'In Development', statusCategory: 'In Progress', assignee: 'Unassigned', client: '', components: [], dueDate: null, releaseDate: 'NA', ...o });

test('team workload counts aligned and blocked tickets per FE member, with their clients and components', () => {
  const sprint = [T({ key: 'A-1', assignee: 'Ana', client: 'BK-US', components: ['FE', 'Menu'] }), T({ key: 'A-2', assignee: 'Ana', client: 'BK-US' }), T({ key: 'A-3', assignee: 'Ana', status: 'Blocked' }),
    T({ key: 'A-4', assignee: 'Ana', status: 'Released', statusCategory: 'Done' }), T({ key: 'B-1', assignee: 'Ben', client: 'KFC-MX' }), T({ key: 'X-1', assignee: 'Not FE' })];
  const w = R.teamWorkload(sprint, ['Ben', 'Ana']);
  assert.deepEqual(w.map((x) => x.name), ['Ana', 'Ben']);                 // sorted by name
  assert.equal(w[0].aligned, 2); assert.equal(w[0].blocked, 1);           // done ones count for nothing
  assert.deepEqual(w[0].clients, { 'BK-US': 2 });
  assert.deepEqual(w[0].components, { Menu: 1 });                         // FE itself is not listed
  assert.equal(w[1].aligned, 1);
});

test('the suggestion is the lightest load, helped by related work, and never the current assignee', () => {
  const sprint = [
    ...[1, 2, 3].map((n) => T({ key: `A-${n}`, assignee: 'Ana', client: 'BK-US' })),
    ...[1, 2].map((n) => T({ key: `B-${n}`, assignee: 'Ben', client: 'KFC-MX' })),
    ...[1, 2, 3, 4].map((n) => T({ key: `C-${n}`, assignee: 'Cy', client: 'PLK-US' })),
  ];
  const w = R.teamWorkload(sprint, ['Ana', 'Ben', 'Cy']);
  const plain = R.suggestAssignee(T({ client: 'NEW-CLIENT' }), w);
  assert.equal(plain.name, 'Ben');
  assert.match(plain.why, /2 aligned tickets \(the fewest on the team\)/);
  assert.deepEqual(plain.alternatives.map((a) => a.name), ['Ana', 'Cy']);
  // Ana holds 3 for BK-US, which is worth up to 3 tickets, so she now outranks Ben (2) for a BK-US ticket
  const related = R.suggestAssignee(T({ client: 'BK-US' }), w);
  assert.equal(related.name, 'Ana');
  assert.match(related.why, /already holds work for BK-US/);
  assert.equal(R.suggestAssignee(T({ client: 'BK-US' }), w, { exclude: ['Ana', 'Ben'] }).name, 'Cy');
  assert.equal(R.suggestAssignee(T(), w, { exclude: ['Ana', 'Ben', 'Cy'] }), null);
  assert.equal(R.suggestAssignee(T(), []), null);
});

test('priority: due tomorrow or earlier is high, within 3 days or blocked is medium, otherwise low; the earlier of due and release counts', () => {
  const today = at('2026-11-10T12:00:00');
  assert.equal(R.priorityOf(T({ dueDate: '2026-11-05' }), today), 'high');
  assert.equal(R.priorityOf(T({ dueDate: '2026-11-11' }), today), 'high');
  assert.equal(R.priorityOf(T({ dueDate: '2026-11-12' }), today), 'medium');
  assert.equal(R.priorityOf(T({ dueDate: '2026-11-13' }), today), 'medium');
  assert.equal(R.priorityOf(T({ dueDate: '2026-11-14' }), today), 'low');
  assert.equal(R.priorityOf(T({ dueDate: '2026-11-20', releaseDate: '2026-11-10' }), today), 'high');
  assert.equal(R.priorityOf(T({ status: 'Blocked' }), today), 'medium');
  assert.equal(R.priorityOf(T(), today), 'low');
});

test('the fallback grouping is by client, most urgent group first, with a next step', () => {
  const today = at('2026-11-10T12:00:00');
  const g = R.fallbackGroups([T({ key: 'A-1', client: 'BK-US', dueDate: '2026-11-09' }), T({ key: 'A-2', client: 'BK-US' }), T({ key: 'B-1', client: 'KFC-MX', status: 'Blocked' }), T({ key: 'C-1', client: '' })], today);
  assert.deepEqual(g.map((x) => [x.title, x.priority]), [['BK-US', 'high'], ['KFC-MX', 'medium'], ['No client', 'low']]);
  assert.match(g[0].action, /A-1/);
  assert.deepEqual(g[0].keys, ['A-1', 'A-2']);                       // dated first
  assert.match(g[1].action, /blocks B-1/);
});

// ---------------------------------------------------------------- model answers
test('a size answer is kept only for tickets that were asked about, with a valid size', () => {
  const m = A.parseSizeAnswer({ tickets: [{ key: 'NGK-1', size: 'm', sizeWhy: 'two screens', analysis: 'Change the banner.', areas: ['Menu Banner', 'cart'] }, { key: 'NGK-9', size: 'S' }, { key: 'NGK-2', size: 'HUGE' }, { key: 'NGK-1', size: 'XL' }] }, ['NGK-1', 'NGK-2']);
  assert.deepEqual([...m.keys()], ['NGK-1', 'NGK-2']);
  assert.equal(m.get('NGK-1').size, 'M');                             // the first answer for a key wins
  assert.deepEqual(m.get('NGK-1').areas, ['menu-banner', 'cart']);
  assert.equal(m.get('NGK-2').size, null);
  assert.equal(A.parseSizeAnswer(null, ['NGK-1']).size, 0);
});

test('what goes to the model is scrubbed of secrets and card numbers', () => {
  const input = A.buildSizeInput([{ key: 'NGK-1', summary: 's', description: 'key AKIAABCDEFGHIJKLMNOP and card 4111 1111 1111 1111', issueType: 'Story', status: 'To Do' }]);
  assert.ok(!input.includes('AKIA') && !input.includes('4111'));
});

test('model groups are checked: unknown keys dropped, duplicates kept once, forgotten keys placed, priority never below the dates', () => {
  const today = at('2026-11-10T12:00:00');
  const tickets = [T({ key: 'A-1', dueDate: '2026-11-09' }), T({ key: 'A-2' }), T({ key: 'A-3' }), T({ key: 'A-4', status: 'Blocked' })];
  const g = A.resolveGroups({ groups: [
    { title: 'Banner work', priority: 'low', why: 'w', action: 'a', keys: ['a-1', 'NOPE-1', 'A-2'] },     // contains an overdue ticket: cannot stay low
    { title: 'More', priority: 'whatever', keys: ['A-2', 'A-3'] },                                       // A-2 is already placed
  ] }, tickets, today);
  // ordered by priority: the group with the overdue ticket first, then the one holding the blocked ticket (medium), then the rest
  assert.deepEqual(g.map((x) => [x.title, x.priority, x.keys]), [['Banner work', 'high', ['A-1', 'A-2']], ['Everything else', 'medium', ['A-4']], ['More', 'low', ['A-3']]]);
  assert.equal(A.resolveGroups({ groups: [] }, tickets, today), null);
  assert.equal(A.resolveGroups({ groups: [{ title: 'x', keys: ['ZZ-1'] }] }, tickets, today), null);
  assert.equal(A.resolveGroups('nope', tickets, today), null);
});

// ---------------------------------------------------------------- a whole run
const J = (o) => ({ id: o.key, issueType: 'Story', description: '', url: `https://j/${o.key}`, created: '2026-10-01T10:00:00.000-0700', updated: '2026-11-09T10:00:00.000-0700', ...T(o), ...o });
const NOW = at('2026-11-10T09:00:00');
const sizeAnswer = (keys) => JSON.stringify({ tickets: keys.map((key) => ({ key, size: 'M', sizeWhy: 'two screens', analysis: `Analysis of ${key}.`, areas: ['menu'] })) });
const fakeClaude = (log, { groups } = {}) => async ({ prompt, input }) => {
  const isSize = prompt.startsWith('You help a front-end');
  log.push(isSize ? 'size' : 'group');
  if (isSize) return { ok: true, text: sizeAnswer(JSON.parse(input).map((t) => t.key)) };
  const keys = JSON.parse(input).tickets.map((t) => t.key);
  return { ok: true, text: JSON.stringify({ groups: groups || [{ title: 'Everything mine', priority: 'low', why: 'w', action: 'do it', keys }] }) };
};

const sprintBase = () => [
  J({ key: 'S-1', assignee: 'Ana', client: 'BK-US', created: '2026-10-01T10:00:00.000-0700' }),
  J({ key: 'S-2', assignee: 'Ben', client: 'KFC-MX', created: '2026-10-01T10:00:00.000-0700' }),
  J({ key: 'S-3', assignee: 'Unassigned', client: 'BK-US', components: ['FE'], summary: 'New FE ticket', created: '2026-11-09T10:00:00.000-0700' }),   // new: created in the last 2 days
  J({ key: 'S-4', assignee: 'Unassigned', client: 'BK-US', components: ['Menu'], created: '2026-11-09T11:00:00.000-0700' }),                           // new, not FE
];
const mineBase = () => [
  J({ key: 'M-1', assignee: 'Me', client: 'BK-US', components: ['FE'], dueDate: '2026-11-09' }),
  J({ key: 'M-2', assignee: 'Me', client: 'BK-US' }),
  J({ key: 'M-3', assignee: 'Me', status: 'Released', statusCategory: 'Done' }),
];
const go = (over = {}) => runQuickAnalysis({ fetchSprint: async () => sprintBase(), fetchMine: async () => mineBase(), feMembers: ['Ana', 'Ben'], claude: fakeClaude([]), now: () => NOW, ...over });

test('a first run: baseline, new tickets, FE candidates with size and a suggestion, and my tickets in groups', async () => {
  reset();
  const log = [];
  const { ok, report } = await go({ claude: fakeClaude(log) });
  assert.equal(ok, true);
  assert.equal(report.baseline, true);
  assert.deepEqual(report.newTickets.map((t) => t.key).sort(), ['S-3', 'S-4']);        // the two created recently, not the old ones
  assert.ok(report.notes.some((n) => /First run/.test(n)));
  assert.deepEqual(report.feCandidates.map((c) => [c.key, c.origin]), [['S-3', 'new'], ['M-1', 'mine']]);   // new FE first, then my own FE ticket
  const s3 = report.feCandidates[0];
  assert.equal(s3.size, 'M'); assert.equal(s3.analysis, 'Analysis of S-3.');
  assert.equal(s3.suggestion.name, 'Ana');                                              // BK-US work: Ana holds a BK-US ticket, Ben's load is the same
  assert.deepEqual(report.feTeam.map((m) => [m.name, m.aligned]), [['Ana', 1], ['Ben', 1]]);
  assert.equal(report.myTickets.source, 'ai');
  assert.deepEqual(report.myTickets.groups.map((g) => [g.title, g.priority, g.tickets.map((t) => t.key)]), [['Everything mine', 'high', ['M-1', 'M-2']]]);   // M-3 is done; priority raised by M-1's overdue date
  assert.deepEqual(log.filter((l) => l === 'size').length, 1);                         // one batch
  assert.equal(log.filter((l) => l === 'group').length, 1);
  assert.equal(store.getState().lastStatus, 'ok');
});

test('a second run with nothing changed makes no model call at all', async () => {
  const log = [];
  const { report } = await go({ claude: fakeClaude(log), now: () => new Date(NOW.getTime() + 15 * 60000) });
  assert.deepEqual(log, []);                                                            // analysis and grouping are both cached
  assert.equal(report.baseline, false);
  assert.deepEqual(report.newTickets.map((t) => t.key).sort(), ['S-3', 'S-4']);        // still unread, so still listed
  assert.equal(report.feCandidates.length, 2);
  assert.equal(report.myTickets.source, 'ai');
});

test('a ticket marked read is skipped from then on, and drops out of the FE candidates; a new one is analyzed alone', async () => {
  assert.equal(store.setRead('S-3', true, NOW.toISOString()), true);
  const log = [];
  const sprint = [...sprintBase(), J({ key: 'S-5', assignee: 'Unassigned', client: 'KFC-MX', components: ['FE'], created: '2026-11-10T08:00:00.000-0700' })];
  const { report } = await go({ fetchSprint: async () => sprint, claude: fakeClaude(log), now: () => new Date(NOW.getTime() + 30 * 60000) });
  assert.deepEqual(report.newTickets.map((t) => [t.key, t.read]).sort(), [['S-3', true], ['S-4', false], ['S-5', false]]);
  assert.equal(report.counts.newUnread, 2);
  assert.deepEqual(report.feCandidates.map((c) => c.key), ['S-5', 'M-1']);             // S-3 is read: gone from the new FE ones
  assert.deepEqual(log, ['size']);                                                      // only S-5 needed analysis; grouping unchanged
  // S-3 is now just one of my own tickets only if assigned to me; it is not, so it is in no list but the read one
});

test('when the model fails the run still finishes, with plain analysis, rule-based groups and a note', async () => {
  reset();
  const { ok, report } = await go({ claude: async () => ({ ok: false, reason: 'not logged in' }) });
  assert.equal(ok, true);
  assert.equal(report.feCandidates[0].size, null);
  assert.equal(report.myTickets.source, 'rules');
  assert.equal(report.myTickets.groups[0].title, 'BK-US');
  assert.ok(report.notes.some((n) => /could not be written/.test(n) && /not logged in/.test(n)));
  assert.ok(report.notes.some((n) => /grouped by client and date only/.test(n)));
  assert.equal(store.getState().groupHash, null);                                       // a rule fallback is not cached: the model is tried again next time
});

test('with no FE team set there is no suggestion and the page is told why; a Jira failure marks the run failed', async () => {
  reset();
  const { report } = await go({ feMembers: [] });
  assert.equal(report.feCandidates[0].suggestion, null);
  assert.ok(report.notes.some((n) => /No FE team members/.test(n)));
  const bad = await go({ fetchMine: async () => { throw new Error('Jira said no'); } });
  assert.deepEqual(bad, { ok: false, error: 'Jira said no' });
  const s = store.getState();
  assert.equal(s.lastStatus, 'failed'); assert.equal(s.lastError, 'Jira said no');
  assert.ok(s.report);                                                                  // the previous report is kept
});

test('view() keeps only what the page needs and scrubs the description', () => {
  const v = view(J({ key: 'V-1', description: 'token AKIAABCDEFGHIJKLMNOP here', assignee: 'Unassigned' }));
  assert.equal(v.assignee, ''); assert.ok(!v.description.includes('AKIA')); assert.equal(v.bucket, 'aligned');
});

// ---------------------------------------------------------------- service and routes
const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('the scheduler runs when due, never twice at once, and not outside working hours', async () => {
  reset();
  let clock = at('2026-11-10T09:00:00'); let runs = 0; let release;
  const svc = createQuickService({ run: () => { runs++; return new Promise((r) => { release = r; }); }, deps: () => ({}), now: () => clock, cfgOf: () => ({ schedule: R.DEFAULT_SCHEDULE, disabled: false }) });
  svc.tick(); assert.equal(runs, 1); assert.equal(svc.isRunning(), true);
  svc.tick(); assert.equal(runs, 1);                                    // one at a time
  release(); await new Promise((r) => setTimeout(r, 5)); assert.equal(svc.isRunning(), false);
  store.startRun(clock.toISOString());                                  // a run began at 09:00
  clock = at('2026-11-10T09:10:00'); svc.tick(); assert.equal(runs, 1);  // 10 minutes: not yet
  clock = at('2026-11-10T09:16:00'); svc.tick(); assert.equal(runs, 2); release();
  await new Promise((r) => setTimeout(r, 5));
  store.startRun(at('2026-11-10T17:00:00').toISOString());
  clock = at('2026-11-10T18:30:00'); svc.tick(); assert.equal(runs, 2);  // after hours
  const off = createQuickService({ run: () => { runs++; return Promise.resolve(); }, deps: () => ({}), now: () => at('2026-11-12T10:00:00'), cfgOf: () => ({ schedule: R.DEFAULT_SCHEDULE, disabled: true }) });
  off.tick(); assert.equal(runs, 2);                                    // switched off in config
});

test('the routes: report, Run now, marking read, and the bell count that clears once the page is opened', async () => {
  reset();
  let openGate; const gate = new Promise((r) => { openGate = r; });          // holds the run open so a second request can be refused
  const svc = createQuickService({ run: async (d) => { await gate; return runQuickAnalysis({ ...d, fetchSprint: async () => sprintBase(), fetchMine: async () => mineBase(), feMembers: ['Ana', 'Ben'], claude: fakeClaude([]) }); }, deps: (now) => ({ now }), now: () => NOW, cfgOf: () => ({ schedule: R.DEFAULT_SCHEDULE, disabled: false, models: { size: 'h', group: 's' }, batch: 10, timeoutMs: 1000, readKeepDays: 14 }) });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json()); app.use('/api', createQuickRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const before = await call(server, 'GET', '/api/quick/report');
    assert.equal(before.json.data.report, null);
    assert.equal(before.json.data.status.reportReady, false);
    const started = await call(server, 'POST', '/api/quick/run');
    assert.equal(started.status, 202);
    const again = await call(server, 'POST', '/api/quick/run');
    assert.equal(again.status, 409);                                    // already running
    assert.equal((await call(server, 'GET', '/api/quick/status')).json.data.running, true);
    openGate();
    for (let i = 0; i < 100 && svc.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
    const after = await call(server, 'GET', '/api/quick/status');
    assert.equal(after.json.data.reportReady, true);
    assert.equal(after.json.data.unviewedNew, 2);                       // the bell shows the new tickets found since the page was last opened
    assert.equal(after.json.data.unreadNew, 2);
    assert.ok(after.json.data.nextRunAt);
    assert.equal((await call(server, 'PUT', '/api/quick/new/S-3/read', { read: true })).status, 200);
    const rep = (await call(server, 'GET', '/api/quick/report')).json.data.report;
    assert.equal(rep.newTickets.find((t) => t.key === 'S-3').read, true);
    assert.equal(rep.counts.newUnread, 1);
    assert.ok(!rep.feCandidates.some((c) => c.key === 'S-3'));          // the read ticket left the FE list at once
    assert.equal((await call(server, 'PUT', '/api/quick/new/S-3/read', { read: false })).status, 200);   // and can be marked unread again
    assert.equal((await call(server, 'PUT', '/api/quick/new/NOPE-1/read', { read: true })).status, 404);
    assert.equal((await call(server, 'PUT', '/api/quick/new/not-a-key/read', { read: true })).status, 400);
    const viewed = await call(server, 'POST', '/api/quick/viewed');
    assert.equal(viewed.json.data.unviewedNew, 0);                      // opening the page clears the bell
  } finally { server.close(); }
});
