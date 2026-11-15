// Trends defect analysis: the rules over the local copy, the checked and cached model guidance (with a fake model), and the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-defects-'));
process.env.DATA_DIR = tmp;
process.env.NGK_DATA_DIR = tmp;
const { initDb, getDb } = await import('../../src/db/database.js');
initDb();
const D = await import('../../src/services/trends/defects.js');
const G = await import('../../src/services/trends/guidance.js');
const store = await import('../../src/services/trends/store.js');
const { createTrendsService, scopeText } = await import('../../src/services/trends/service.js');
const { createTrendsRouter } = await import('../../src/routes/trends.js');

const reset = () => { getDb().exec('DELETE FROM trend_tickets; DELETE FROM trend_sync; DELETE FROM trend_ai'); };
const NOW = new Date('2026-11-13T12:00:00');
let n = 0;
const T = (type, resolved, o = {}) => ({ key: `X-${++n}`, type, created: '2026-05-01T12:00:00', resolved, summary: 'a ticket', clients: [], labels: [], component: null, components: [], assignee: null, ...o });
const Dfx = (resolved, summary, o = {}) => T('Defect', resolved, { summary, ...o });

// ---------------------------------------------------------------- rules
test('a defect is put in the first category whose words its title, labels or component contain, else "Other or unclear"', () => {
  const c = (summary, o = {}) => D.categorize({ summary, labels: [], component: null, ...o });
  assert.equal(c('Card declined but no retry offered'), 'Payment and payterminal');
  assert.equal(c('Receipt total does not match the order'), 'Receipts and printing');
  assert.equal(c('Missing image on modifier'), 'Menu, pricing and content data');
  assert.equal(c('Something odd happens'), 'Other or unclear');
  assert.equal(c('Odd thing', { labels: ['loyalty'] }), 'Loyalty, coupons and offers');           // labels count
  assert.equal(c('Odd thing', { component: 'Payterminal' }), 'Payment and payterminal');          // so does the component
  assert.equal(c('Payment receipt printing fails'), 'Payment and payterminal');                   // first match wins
});

test('days to fix is whole days created to resolved, empty when a date is missing or the order is impossible; the median handles odd, even and empty', () => {
  assert.equal(D.daysToFix({ created: '2026-05-01T12:00:00', resolved: '2026-05-04T11:00:00' }), 3);
  assert.equal(D.daysToFix({ created: '2026-05-01T12:00:00', resolved: null }), null);
  assert.equal(D.daysToFix({ created: '2026-05-05T12:00:00', resolved: '2026-05-01T12:00:00' }), null);
  assert.equal(D.median([5, 1, 3]), 3); assert.equal(D.median([1, 2, 3, 4]), 2.5); assert.equal(D.median([]), null);
});

test('the analysis counts only defect types done in the months shown, with the share of all done tickets', () => {
  const rows = [
    Dfx('2026-09-10T12:00:00', 'Receipt total wrong'), Dfx('2026-10-10T12:00:00', 'Receipt total wrong'), T('UAT Defect', '2026-11-02T12:00:00', { summary: 'Missing image' }),
    T('Product Defect', '2026-07-02T12:00:00', { summary: 'Slow screen' }), T('Story', '2026-09-12T12:00:00'), T('Story', '2026-10-12T12:00:00'), T('Task', '2026-10-13T12:00:00'),
    Dfx('2026-04-10T12:00:00', 'Old one'),                                                          // before the 6 months
  ];
  const f = D.analyzeDefects({ rows, months: 6, now: NOW });
  assert.equal(f.tiles.defects, 4);
  assert.equal(f.tiles.ticketsDone, 7);
  assert.equal(f.tiles.shareOfDone, 57);
  assert.equal(f.tiles.uat, 1); assert.equal(f.tiles.uatShare, 25);
  assert.equal(f.tiles.fixedInWeekShare, 0);                                                          // created May 1: all took longer than a week
  assert.deepEqual(f.months, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(f.perMonth, [0, 1, 0, 1, 1, 1]);
  assert.deepEqual(D.analyzeDefects({ rows, months: 3, now: NOW }).perMonth, [1, 1, 1]);
  assert.equal(D.analyzeDefects({ rows: [], now: NOW }).tiles.shareOfDone, 0);                       // no division by zero
});

test('categories are sorted by size with their share, example tickets and how the monthly rate changed between the halves', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(Dfx('2026-06-10T12:00:00', 'Card payment issue'));           // earlier half (Jun to Aug): 6 payment defects
  for (let i = 0; i < 12; i++) rows.push(Dfx('2026-10-10T12:00:00', 'Card payment issue'));          // recent half (Sep to Nov): 12
  for (let i = 0; i < 3; i++) rows.push(Dfx('2026-10-11T12:00:00', 'Missing image'));                // too few earlier to give a change
  const f = D.analyzeDefects({ rows, months: 6, now: NOW });
  assert.deepEqual(f.categories.map((c) => [c.name, c.count, c.share]), [['Payment and payterminal', 18, 86], ['Menu, pricing and content data', 3, 14]]);
  assert.equal(f.categories[0].changePct, 100);                                                       // 2 a month to 4 a month
  assert.equal(f.categories[1].changePct, null);                                                      // earlier half has under 5: no percentage
  assert.equal(f.categories[0].examples.length, 3);
  assert.ok(f.categories[0].advice.length > 20);
});

test('client rates are defects per 100 done tickets, only for clients with enough done tickets; a ticket with two clients counts for both', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(T('Story', '2026-10-05T12:00:00', { clients: ['AA'] }));
  for (let i = 0; i < 10; i++) rows.push(Dfx('2026-10-06T12:00:00', 'Odd', { clients: ['AA'] }));    // AA: 10 defects of 30 done
  for (let i = 0; i < 20; i++) rows.push(T('Story', '2026-10-05T12:00:00', { clients: ['BB'] }));
  rows.push(Dfx('2026-10-06T12:00:00', 'Odd', { clients: ['BB', 'AA'] }));                           // counts for BB and for AA
  for (let i = 0; i < 5; i++) rows.push(Dfx('2026-10-06T12:00:00', 'Odd', { clients: ['CC'] }));     // CC: too few done tickets
  const f = D.analyzeDefects({ rows, months: 6, now: NOW });
  assert.deepEqual(f.clients.map((c) => c.name), ['AA', 'BB']);                                       // CC left out (5 done)
  assert.deepEqual(f.clients[0], { name: 'AA', defects: 11, done: 31, per100: 35.5, times: f.clients[0].times });
  assert.equal(f.clients[1].per100, 4.8);                                                              // 1 of 21
  assert.equal(f.averagePer100, round1((16 / 56) * 100));
  function round1(x) { return Math.round(x * 10) / 10; }
});

test('the page filters narrow the analysis, except the Type filter, which it ignores and says so', () => {
  const rows = [Dfx('2026-10-10T12:00:00', 'Odd', { clients: ['AA'], assignee: 'Ann' }), Dfx('2026-10-11T12:00:00', 'Odd', { clients: ['BB'], assignee: 'Bob' }), T('Story', '2026-10-12T12:00:00', { clients: ['AA'], assignee: 'Ann' })];
  assert.equal(D.analyzeDefects({ rows, filters: { client: ['AA'] }, now: NOW }).tiles.defects, 1);
  assert.equal(D.analyzeDefects({ rows, filters: { client: ['AA'] }, now: NOW }).tiles.ticketsDone, 2);
  assert.equal(D.analyzeDefects({ rows, filters: { feTeam: true }, feMembers: new Set(['Bob']), now: NOW }).tiles.defects, 1);
  const t = D.analyzeDefects({ rows, filters: { type: ['Story'] }, now: NOW });
  assert.equal(t.tiles.defects, 2); assert.equal(t.typeFilterIgnored, true);
  assert.equal(D.analyzeDefects({ rows, now: NOW }).typeFilterIgnored, false);
});

test('repeats are two-word phrases in 3 or more defects, without client codes, and a cluster is listed once', () => {
  const ds = [
    ...['BK-US', 'PLK-US', 'BK-ES'].map((c) => Dfx('2026-10-10T12:00:00', `${c} receipt total mismatch after refund`, { clients: [c] })),
    Dfx('2026-10-10T12:00:00', 'receipt total mismatch on kiosk', { clients: ['BK-US'] }),
    Dfx('2026-10-10T12:00:00', 'unrelated thing one'), Dfx('2026-10-10T12:00:00', 'another unrelated thing'),
  ];
  const r = D.findRepeats(ds, ['BK-US', 'PLK-US', 'BK-ES']);
  assert.equal(r[0].phrase, 'receipt total'); assert.equal(r[0].count, 4); assert.equal(r[0].clients, 3);
  assert.equal(r.filter((x) => x.phrase.includes('mismatch')).length, 0);                             // "total mismatch" is the same cluster, not listed again
  assert.equal(r.some((x) => /bk|plk/.test(x.phrase)), false);                                        // client codes are not patterns
  assert.deepEqual(D.findRepeats(ds.slice(0, 2), []), []);                                           // 2 tickets are not a repeat
});

test('each category has a one-line meaning, its top 3 tenants, 3 sample tickets, the repeats that belong to it, and "Other or unclear" is always last', () => {
  const rows = [];
  const mk = (summary, client, i) => Dfx(`2026-10-${String(10 + (i % 15)).padStart(2, '0')}T12:00:00`, summary, { clients: [client] });
  ['AA', 'AA', 'AA', 'BB', 'BB', 'CC', 'DD'].forEach((c, i) => rows.push(mk('Receipt total mismatch on kiosk', c, i)));    // 7 receipt defects: AA 3, BB 2, CC 1, DD 1
  for (let i = 0; i < 9; i++) rows.push(mk('Something odd', 'EE', i));                                                              // 9 that match nothing: more than receipts
  const f = D.analyzeDefects({ rows, months: 6, now: NOW });
  assert.deepEqual(f.categories.map((c) => c.name), ['Receipts and printing', 'Other or unclear']);                                // Other is last although it is bigger
  const r = f.categories[0];
  assert.match(r.meaning, /Receipts that are wrong/);
  assert.deepEqual(r.tenants, [{ name: 'AA', count: 3 }, { name: 'BB', count: 2 }, { name: 'CC', count: 1 }]);                     // top 3, ties by name
  assert.equal(r.examples.length, 3);
  assert.ok(r.examples.every((e) => /^X-\d+$/.test(e.key)));
  assert.deepEqual(r.repeats.map((x) => [x.phrase, x.count]), [['receipt total', 7]]);                                              // the repeat sits with the category its defects are in
  assert.deepEqual(f.categories[1].repeats, []);
  assert.ok(f.categories[1].meaning.length > 20);
  assert.deepEqual(f.topClients, [{ name: 'EE', count: 9 }, { name: 'AA', count: 3 }, { name: 'BB', count: 2 }]);                 // overall top 3 by defect count
  assert.ok(D.CATEGORIES.every((c) => c.meaning && c.advice));                                                                      // every category is defined the same way
  assert.equal(new Set(D.CATEGORIES.map((c) => c.name)).size, D.CATEGORIES.length);
});

// ---------------------------------------------------------------- guidance
const factsFor = (summaries) => D.analyzeDefects({ rows: summaries.map((s) => Dfx('2026-10-10T12:00:00', s, { clients: ['AA'] })), now: NOW });
const GOOD = JSON.stringify({ headline: 'Payments lead.', focus: [{ title: 'Payment and payterminal', why: '98 defects, 22%.', actions: ['Add decline tests', 'Add timeout tests'], measure: 'Payment defects per month', extra: 'dropped' }], caveats: ['Titles only.', 'Second caveat is dropped.'] });

test('the default model is sonnet, and the analysis is only ever asked for by a click: reading it never calls the model', async () => {
  assert.equal(G.MODEL, 'sonnet');
  reset();
  let calls = 0;
  const svc = createTrendsService({ now: () => NOW, claude: async () => { calls++; return { ok: true, text: GOOD }; } });
  store.upsert([Dfx('2026-10-10T12:00:00', 'Receipt total wrong', { clients: ['AA'] })].map((r) => ({ ...r, statusCategory: '', updated: null, firstSprintStart: null })));
  svc.defectAnalysis({ months: 6 }); svc.defectAnalysis({ months: 3 }); svc.sprintTickets({}); svc.status();
  assert.equal(calls, 0);
  await svc.defectGuidance({ months: 6 });
  assert.equal(calls, 1);
  reset();
});

test('what is sent to the model has no secrets or card numbers, no people, and the scope as counts only', () => {
  const facts = factsFor(['Login fails password=hunter2secret for kiosk', 'Card 4242 4242 4242 4242 charged twice', 'Odd']);   // the card is a processor test number used as a fixture
  const input = G.buildInput(facts, scopeText({ feTeam: true, client: ['A', 'B'], assignee: ['Smith, Ann'] }));
  assert.ok(!input.includes('hunter2secret')); assert.ok(!input.includes('4242 4242 4242 4242'));
  assert.ok(input.includes('[redacted]'));
  assert.ok(!input.includes('Smith'));
  assert.equal(scopeText({ feTeam: true, client: ['A', 'B'], assignee: ['Smith, Ann'] }), 'FE team only; 2 clients selected; 1 assignee selected');
  assert.equal(scopeText({}), 'all done tickets');
  assert.ok(G.PROMPT.includes('Do not name any person'));
});

test('a model answer is checked: unknown keys dropped, texts clipped, at most 4 focus items, and no usable focus means no answer', () => {
  const p = G.parseGuidance(JSON.parse(GOOD));
  assert.deepEqual(Object.keys(p), ['headline', 'focus', 'caveats']);
  assert.deepEqual(Object.keys(p.focus[0]), ['title', 'why', 'actions', 'measure']);
  const many = { focus: Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, why: 'w', actions: ['a'], measure: 'm' })) };
  assert.equal(G.parseGuidance(many).focus.length, 3); assert.equal(G.MAX_FOCUS, 3);
  assert.equal(G.parseGuidance({ focus: [{ title: 'x'.repeat(500), why: 'w', actions: ['a'], measure: 'm' }] }).focus[0].title.length <= 60, true);
  assert.equal(G.parseGuidance({ focus: [{ title: 'x', why: 'w', actions: ['a'.repeat(900), 'b', 'c', 'd'], measure: 'm' }] }).focus[0].actions.length, 2);
  assert.equal(G.parseGuidance(JSON.parse(GOOD)).caveats.length, 1);                                  // short on purpose: one caveat
  assert.equal(G.parseGuidance({ focus: [{ title: '', why: 'w', actions: ['a'] }, { title: 't', why: 'w', actions: [] }] }), null);
  assert.equal(G.parseGuidance(null), null); assert.equal(G.parseGuidance({ focus: 'nope' }), null);
});

test('the guidance is asked once per set of numbers: the second ask is served from the saved answer, force asks again, a different scope is a different answer', async () => {
  reset();
  let calls = 0;
  const claude = async ({ model, input }) => { calls++; assert.ok(input.includes('"categories"')); assert.ok(['haiku', 'sonnet'].includes(model)); return { ok: true, text: `Here you go:\n\`\`\`json\n${GOOD}\n\`\`\`` }; };
  const facts = factsFor(['Receipt total wrong', 'Card declined']);
  const a = await G.generateGuidance({ facts, scope: 'all done tickets', claude, now: () => new Date('2026-11-13T20:00:00Z') });
  assert.deepEqual([a.ok, a.cached, calls], [true, false, 1]);
  assert.equal(a.at, '2026-11-13T20:00:00.000Z');
  const b = await G.generateGuidance({ facts, scope: 'all done tickets', claude });
  assert.deepEqual([b.ok, b.cached, calls], [true, true, 1]);
  assert.equal(b.focus[0].title, 'Payment and payterminal');
  assert.equal((await G.generateGuidance({ facts, scope: 'all done tickets', claude, force: true })).cached, false); assert.equal(calls, 2);
  assert.equal((await G.generateGuidance({ facts, scope: 'FE team only', claude })).cached, false); assert.equal(calls, 3);
  assert.equal(G.cachedGuidance(facts, 'nothing asked for this')?.focus, undefined);
  assert.equal((await G.generateGuidance({ facts, scope: 'all done tickets', claude, model: 'haiku' })).cached, false); assert.equal(calls, 4);   // another model is another answer
  reset();
});

test('when the model fails, answers badly, or there are no defects, the result says why and nothing is saved', async () => {
  reset();
  const facts = factsFor(['Receipt total wrong']);
  const down = await G.generateGuidance({ facts, claude: async () => ({ ok: false, reason: 'the claude CLI took longer than 180s' }) });
  assert.deepEqual([down.ok, down.reason], [false, 'the claude CLI took longer than 180s']);
  const junk = await G.generateGuidance({ facts, claude: async () => ({ ok: true, text: 'I think you should test more.' }) });
  assert.equal(junk.ok, false); assert.match(junk.reason, /not in a usable form/);
  let asked = false;
  const none = await G.generateGuidance({ facts: D.analyzeDefects({ rows: [], now: NOW }), claude: async () => { asked = true; return { ok: true, text: GOOD }; } });
  assert.equal(none.ok, false); assert.equal(asked, false);                                           // no defects: no call
  assert.equal(G.cachedGuidance(facts, ''), null);
  reset();
});

// ---------------------------------------------------------------- routes
const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('the routes: the analysis never calls the model, the guidance does (once per numbers) with its guard, and bad requests are refused', async () => {
  reset();
  store.upsert([Dfx('2026-10-10T12:00:00', 'Receipt total wrong', { clients: ['AA'], assignee: 'Ann' }), T('Story', '2026-10-12T12:00:00', { clients: ['AA'], assignee: 'Ann' })].map((r) => ({ ...r, statusCategory: '', updated: null, firstSprintStart: null })));
  let calls = 0; let release; const gate = new Promise((r) => { release = r; });
  const claude = async () => { calls++; await gate; return { ok: true, text: GOOD }; };
  const svc = createTrendsService({ now: () => NOW, claude, feMembers: () => new Set(['Ann']) });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json()); app.use('/api', createTrendsRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const a = await call(server, 'GET', '/api/trends/defects?months=6');
    assert.equal(a.status, 200);
    assert.equal(a.json.data.facts.tiles.defects, 1); assert.equal(a.json.data.guidance, null); assert.equal(calls, 0);
    assert.equal(a.json.data.scope, 'all done tickets'); assert.equal(a.json.data.ruleFocus, undefined);
    assert.match(a.json.data.facts.categories[0].examples[0].url, /\/browse\/X-\d+$/);               // each sample ticket comes with its Jira link
    assert.equal((await call(server, 'GET', '/api/trends/defects?months=6&client=Nobody')).json.data.facts.tiles.defects, 0);
    assert.equal((await call(server, 'GET', '/api/trends/defects?months=12')).status, 400);
    assert.equal((await call(server, 'POST', '/api/trends/defects/guidance', { months: 12 })).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/defects/guidance`, { method: 'POST' })).status, 415);   // JSON only

    const first = call(server, 'POST', '/api/trends/defects/guidance', { months: 6 });
    for (let i = 0; i < 100 && !svc.isGuiding(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await call(server, 'POST', '/api/trends/defects/guidance', { months: 6 })).status, 409);                                  // one at a time
    release();
    const done = await first;
    assert.equal(done.status, 200); assert.equal(done.json.data.cached, false); assert.equal(done.json.data.focus[0].title, 'Payment and payterminal');
    assert.equal((await call(server, 'GET', '/api/trends/defects?months=6')).json.data.guidance.cached, true);                              // now saved: shown without a call
    assert.equal((await call(server, 'POST', '/api/trends/defects/guidance', { months: 6 })).json.data.cached, true); assert.equal(calls, 1);
    assert.equal((await call(server, 'POST', '/api/trends/defects/guidance', { months: 6, client: ['AA'], feTeam: true })).json.data.cached, false); assert.equal(calls, 2);   // other filters: other numbers
  } finally { release?.(); server.close(); }
  reset();
});

// ---------------------------------------------------------------- fix components
test('the category is decided by evidence: title, the component set when the fix was done, the files the fix changed, then description and PR title; a tie goes to the earlier category', () => {
  const c = (row, pr) => D.categorize({ summary: '', labels: [], description: '', components: [], ...row }, pr);
  assert.equal(c({ summary: 'Totals are off', components: ['Receipt.xsl'] }), 'Receipts and printing');                       // the component says what it was about
  assert.equal(c({ summary: 'Something odd', components: ['FE'] }), 'Other or unclear');                                        // where a fix was made says nothing about the topic
  assert.equal(c({ summary: 'Offer missing', components: ['PROD/config.json (AKA "Global Config" - all current PROD stores )'] }), 'Loyalty, coupons and offers');   // a config component does not turn a loyalty defect into a config one
  assert.equal(c({ summary: 'Odd' }, { files: [{ name: 'src/payment/refund.js' }] }), 'Payment and payterminal');                // the PR files decide when the title does not
  assert.equal(c({ summary: 'Odd' }, { files: ['src/payment/refund.js'] }), 'Payment and payterminal');                         // plain file names work too
  assert.equal(c({ summary: 'Odd', description: 'The loyalty reward is not applied' }), 'Loyalty, coupons and offers');           // the description decides when nothing else speaks
  assert.equal(c({ summary: 'Receipt total wrong', description: 'loyalty coupon offer reward' }), 'Receipts and printing');    // the title outweighs the description
  assert.equal(c({ summary: 'Odd', components: ['Skumap'] }, { files: [{ name: 'src/menu/list.js' }] }), 'POS and fiscal integration');   // component (3) beats a file hit (2)
  assert.equal(c({ summary: 'Odd', components: ['Skumap'] }, { files: [{ name: 'src/menu/list.js' }], title: 'NGK-1: sku map pos' }), 'POS and fiscal integration');
  assert.equal(c({ summary: 'Payment receipt printing fails' }), 'Payment and payterminal');                                     // a tie: the earlier category
  assert.equal(c({ summary: 'Odd' }, { files: [{ name: 'package-lock.json' }], title: 'NGK-9: bump' }), 'Other or unclear');      // no evidence
  assert.equal(c({ summary: 'x', labels: ['accessibility'] }), 'Accessibility');
  assert.equal(D.componentHint('FE'), null); assert.equal(D.componentHint('  Device Service '), 'Hardware and device'); assert.equal(D.componentHint(null), null);
});

test('each category says where its defects were fixed (the Jira component, else the PR\'s), the PR ledger coverage is counted, and the PR files can place a defect', () => {
  const rows = [
    Dfx('2026-10-10T12:00:00', 'Receipt total wrong', { components: ['FE'] }), Dfx('2026-10-11T12:00:00', 'Receipt total wrong', { components: ['FE', 'Receipt.xsl'] }),
    Dfx('2026-10-12T12:00:00', 'Receipt total wrong', { components: ['Kiosk Web Service'] }), Dfx('2026-10-13T12:00:00', 'Receipt total wrong', { components: [] }),
    Dfx('2026-10-14T12:00:00', 'Receipt total wrong', { components: [] }),
    Dfx('2026-10-15T12:00:00', 'Odd', { components: [] }),                                                                // no words at all: only the PR files can place it
  ];
  const prs = new Map([[rows[3].key, { component: 'Device Service (DS)', files: [] }], [rows[5].key, { component: 'FE', files: [{ name: 'src/payment/cards.js' }] }]]);
  const f = D.analyzeDefects({ rows, months: 6, prs, now: NOW });
  const receipts = f.categories.find((x) => x.name === 'Receipts and printing');
  assert.deepEqual(receipts.fixedIn, [{ name: 'FE', count: 2, pct: 40 }, { name: 'Device Service (DS)', count: 1, pct: 20 }, { name: 'Kiosk Web Service', count: 1, pct: 20 }]);   // top 3 of 5; the PR's component when Jira has none
  assert.equal(f.categories.find((x) => x.name === 'Payment and payterminal').count, 1);                                  // placed by its PR files
  assert.deepEqual(f.prCoverage, { withPr: 2, defects: 6 });
  assert.equal(D.analyzeDefects({ rows, months: 6, now: NOW }).categories.find((x) => x.name === 'Payment and payterminal'), undefined);   // without the ledger it stays "Other"
  const none = D.analyzeDefects({ rows: [Dfx('2026-10-10T12:00:00', 'Receipt total wrong')], months: 6, now: NOW });
  assert.deepEqual(none.categories[0].fixedIn, [{ name: 'Not set', count: 1, pct: 100 }]);
  const long = D.analyzeDefects({ rows: [Dfx('2026-10-10T12:00:00', 'Receipt total wrong', { components: ['PROD/config.json (AKA "Global Config" - all current PROD stores )'] })], months: 6, now: NOW });
  assert.ok(long.categories[0].fixedIn[0].name.length <= 40);
  assert.equal(f.components, undefined);                                                                                  // there is no analysis view by component any more
});

test('the report can be split and filtered by component, tickets with several components count under each, and the old single-component rows still work', () => {
  const A = null;
  return import('../../src/services/trends/aggregate.js').then((Agg) => {
    const rs = [T('Story', '2026-10-10T12:00:00', { components: ['FE'] }), T('Story', '2026-10-11T12:00:00', { components: ['FE', 'Web Service (WS)'] }), T('Story', '2026-10-12T12:00:00', { components: [] })];
    const a = Agg.aggregate({ rows: rs, basis: 'resolved', group: 'component', months: 6, now: NOW });
    assert.deepEqual(a.series.map((s) => [s.name, s.total]), [['FE', 2], ['No component', 1], ['Web Service (WS)', 1]]);
    assert.deepEqual(a.totals, [0, 0, 0, 0, 3, 0]);                                                          // three tickets, not four
    assert.deepEqual(a.options.components, ['FE', 'No component', 'Web Service (WS)']);
    assert.equal(Agg.aggregate({ rows: rs, basis: 'resolved', months: 6, filters: { component: ['Web Service (WS)', 'No component'] }, now: NOW }).inRange, 2);
    assert.equal(Agg.aggregate({ rows: rs, basis: 'resolved', months: 6, filters: { component: [] }, now: NOW }).inRange, 3);
    return A;
  });
});

test('components are stored in full and read back, and a row saved before the column existed falls back to its single component', () => {
  reset();
  store.upsert([{ ...T('Defect', '2026-10-10T12:00:00', { components: ['FE', 'Web Service (WS)'] }), statusCategory: '', updated: null, firstSprintStart: null }]);
  assert.deepEqual(store.allRows()[0].components, ['FE', 'Web Service (WS)']);
  getDb().exec("UPDATE trend_tickets SET components = NULL, component = 'Menu Service (MS)'");
  assert.deepEqual(store.allRows()[0].components, ['Menu Service (MS)']);
  reset();
});

test('the model is given where each category was fixed, not a component list, and the scope names the component filter', () => {
  const rows = [Dfx('2026-10-10T12:00:00', 'Receipt total wrong', { components: ['FE'], clients: ['AA'] })];
  const f = D.analyzeDefects({ rows, now: NOW });
  const input = JSON.parse(G.buildInput(f, ''));
  assert.deepEqual(input.categories[0].fixedIn, [{ name: 'FE', count: 1, pct: 100 }]);
  assert.equal(input.components, undefined);
  assert.ok(G.PROMPT.includes('fixedIn: where the fixes were made'));
  assert.equal(scopeText({ component: ['FE'] }), 'fix component FE');
  assert.equal(scopeText({ feTeam: true, component: ['FE', 'WS', 'MS', 'DS'] }), 'FE team only; fix component FE, WS, MS and more');
});

test('a Jira description (rich text) is stored as clipped plain text, and a missing one as empty', async () => {
  const S = await import('../../src/services/trends/sync.js');
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The main menu shows' }] }, { type: 'paragraph', content: [{ type: 'text', text: '  no   tiles.' }] }] };
  assert.equal(S.toRow({ key: 'N-1', fields: { description: adf } }).description, 'The main menu shows no tiles.');
  assert.equal(S.toRow({ key: 'N-2', fields: {} }).description, '');
  const big = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(5000) }] }] };
  assert.equal(S.toRow({ key: 'N-3', fields: { description: big } }).description.length, 1500);
  reset();
  store.upsert([{ ...Dfx('2026-10-10T12:00:00', 'Odd'), description: 'The loyalty reward is not applied', statusCategory: '', updated: null, firstSprintStart: null }]);
  assert.equal(store.allRows()[0].description, 'The loyalty reward is not applied');
  reset();
});
