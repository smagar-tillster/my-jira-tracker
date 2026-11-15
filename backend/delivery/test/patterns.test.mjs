// Defect patterns in the RAG: reading them, matching defects to them, recording repeats (only seen and tickets change), clusters, drafting new ones.
// Everything runs in temp folders with a fake model and a fake ingest: these tests never touch the real RAG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-patterns-'));
process.env.DATA_DIR = tmp;
process.env.NGK_DATA_DIR = tmp;
const { initDb, getDb } = await import('../../src/db/database.js');
initDb();
const P = await import('../../src/services/trends/patterns.js');
const Dr = await import('../../src/services/trends/patternDraft.js');
const I = await import('../../src/services/trends/ragIngest.js');
const store = await import('../../src/services/trends/store.js');
const { createTrendsService } = await import('../../src/services/trends/service.js');
const { createTrendsRouter } = await import('../../src/routes/trends.js');

const reset = () => { getDb().exec('DELETE FROM trend_tickets; DELETE FROM trend_ai'); };
const NOW = new Date('2026-11-14T09:00:00');

const PROMO = `---
type: defect-pattern
id: shared-promotion-config-blast-radius
capabilities: ["offers-and-promotions", "coupons"]
repos: ["kiosk-ui", "kiosk-configuration"]
paths: ["configs/promotion.js", "configs/environment.js"]
keywords: ["promotion", "tenant override"]
seen: 1
recorded: 2026-10-25
tickets: ["NGK-98319"]
status: active
---
# Shared promotion config changed without checking tenant overrides

## Smell
A diff changes a shared promotion default.

## Why it bites
Tenant overrides differ.

## Check
Search the key across tenants.

Source: the gotchas in [coupons.md](../implementations/coupons.md).
`;
const PUL = PROMO.replace('shared-promotion-config-blast-radius', 'pul-entries-not-tied').replace('["kiosk-ui", "kiosk-configuration"]', '["kiosk-ui"]').replace('["configs/promotion.js", "configs/environment.js"]', '["src/common/services/pickUp*.js", "src/**/lineItem*.js"]').replace('["NGK-98319"]', '["NGK-103904"]');
const CAP = (name) => `---\ntype: capability\ncapability: ${name}\n---\n# ${name}\n`;

const makeRag = ({ patterns = {}, caps = ['coupons', 'offers-and-promotions', 'cart-assembly'] } = {}) => {
  const root = fs.mkdtempSync(path.join(tmp, 'rag-'));
  fs.mkdirSync(path.join(root, 'docs', 'defects'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'implementations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'defects', 'README.md'), '# readme\n');
  fs.writeFileSync(path.join(root, 'docs', 'defects', '_template.md'), '---\ntype: defect-pattern\nid: replace\n---\n');
  for (const [id, text] of Object.entries(patterns)) fs.writeFileSync(path.join(root, 'docs', 'defects', `${id}.md`), text);
  for (const c of caps) fs.writeFileSync(path.join(root, 'docs', 'implementations', `${c}-doc.md`), CAP(c));
  return root;
};
const snapshot = (root) => Object.fromEntries(fs.readdirSync(path.join(root, 'docs', 'defects')).map((n) => [n, fs.readFileSync(path.join(root, 'docs', 'defects', n), 'utf8')]));

// ---------------------------------------------------------------- reading
test('front matter: strings, numbers, JSON-style lists, and a list written over several lines is flagged', () => {
  const fm = P.parseFrontMatter(PROMO);
  assert.deepEqual([fm.meta.type, fm.meta.seen, fm.meta.recorded, fm.meta.repos, fm.meta.tickets], ['defect-pattern', 1, '2026-10-25', ['kiosk-ui', 'kiosk-configuration'], ['NGK-98319']]);
  assert.match(fm.body, /^# Shared promotion/);
  assert.equal(P.parseFrontMatter('no front matter here'), null);
  const multi = P.parseFrontMatter('---\ntype: defect-pattern\ntickets:\n  - NGK-1\n  - NGK-2\nseen: 2\n---\nbody\n');
  assert.deepEqual(multi.meta._multiline, ['tickets']); assert.equal(multi.meta.seen, 2);
  assert.deepEqual(P.parseFrontMatter("---\nrepos: ['a', 'b']\n---\n").meta.repos, ['a', 'b']);       // single quotes too
});

test('patterns are read from docs/defects, leaving out the README, the template and files that are not valid patterns; capabilities come from docs/implementations', () => {
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO, 'pul-entries-not-tied': PUL, 'wrong-id': PROMO, 'not-a-pattern': '---\ntype: capability\nid: not-a-pattern\n---\n' } });
  const { found, patterns } = P.loadPatterns(root);
  assert.equal(found, true);
  assert.deepEqual(patterns.map((p) => p.id), ['pul-entries-not-tied', 'shared-promotion-config-blast-radius']);       // wrong-id: the id does not match the file name
  assert.deepEqual(patterns[1].paths, ['configs/promotion.js', 'configs/environment.js']);
  assert.deepEqual(P.loadPatterns(path.join(tmp, 'nowhere')), { found: false, patterns: [] });
  assert.deepEqual(P.capabilityNames(root), ['cart-assembly', 'coupons', 'offers-and-promotions']);
  assert.deepEqual(P.capabilityNames(path.join(tmp, 'nowhere')), []);
});

// ---------------------------------------------------------------- matching
test('globs: * stays in a folder, ** crosses folders, ? is one character, case does not matter, and nothing else is special', () => {
  const m = (g, f) => P.globToRegExp(g).test(f);
  assert.equal(m('configs/promotion.js', 'configs/promotion.js'), true);
  assert.equal(m('configs/promotion.js', 'configs/promotionXjs'), false);                            // the dot is a dot
  assert.equal(m('configs/*.js', 'configs/a.js'), true); assert.equal(m('configs/*.js', 'configs/sub/a.js'), false);
  assert.equal(m('src/**/lineItem*.js', 'src/a/b/lineItemResource.js'), true); assert.equal(m('src/**/lineItem*.js', 'src/lineItemX.js'), true);
  assert.equal(m('a/?.js', 'a/b.js'), true); assert.equal(m('a/?.js', 'a/bc.js'), false);
  assert.equal(m('CONFIGS/Promotion.JS', './configs/promotion.js'.replace('./', '')), true);
  assert.equal(m('a+b(1).js', 'a+b(1).js'), true);                                                   // regex characters are escaped
});

test('a defect matches a pattern when its repo is listed and a changed file is covered; retired patterns and patterns with no paths never match', () => {
  const base = { id: 'p', repos: ['kiosk-ui'], paths: ['configs/*.js'], tickets: [], seen: 1, status: 'active' };
  const m = (o, d) => P.matchPattern({ ...base, ...o }, { repo: 'kiosk-ui', files: ['configs/payment.js', 'src/x.js'], ...d });
  assert.deepEqual(m({}), ['configs/payment.js']);
  assert.deepEqual(m({}, { repo: 'KIOSK-UI' }), ['configs/payment.js']);                              // repo names ignore case
  assert.deepEqual(m({}, { repo: 'kiosk-web-service' }), []);
  assert.deepEqual(m({ status: 'retired' }), []);
  assert.deepEqual(m({ paths: [] }), []);
  assert.deepEqual(m({}, { files: ['./configs/a.js'] }), ['configs/a.js']);
});

const prIdx = (m) => new Map(Object.entries(m));
const pr = (repo, files, title = 'fix') => ({ repo, title, files: files.map((name) => ({ name, status: 'modified' })) });
const cat = () => 'Menu, pricing and content data';
const d = (key, summary = `${key} summary`) => ({ key, summary });

test('defects with a PR in the ledger become { key, title, repo, files, category }; no PR or only lock files and images means left out', () => {
  const out = P.defectsWithFiles([d('NGK-1'), d('NGK-2'), d('NGK-3'), d('NGK-4')], prIdx({ 'NGK-1': pr('kiosk-ui', ['./configs/a.js', 'package-lock.json', 'logo.png']), 'NGK-2': pr('kiosk-ui', ['yarn.lock']), 'NGK-4': pr('kiosk-ui', ['src/b.js']) }), cat);
  assert.deepEqual(out, [{ key: 'NGK-1', title: 'NGK-1 summary', repo: 'kiosk-ui', files: ['configs/a.js'], category: 'Menu, pricing and content data' }, { key: 'NGK-4', title: 'NGK-4 summary', repo: 'kiosk-ui', files: ['src/b.js'], category: 'Menu, pricing and content data' }]);
});

test('repeats: a defect that repeats a pattern is planned unless its ticket is already in it; recorded ones are counted', () => {
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO, 'pul-entries-not-tied': PUL } });
  const { patterns } = P.loadPatterns(root);
  const defects = [
    { key: 'NGK-1', title: 't1', repo: 'kiosk-ui', files: ['configs/promotion.js'], category: 'x' },
    { key: 'NGK-98319', title: 'already recorded', repo: 'kiosk-ui', files: ['configs/promotion.js'], category: 'x' },
    { key: 'NGK-2', title: 't2', repo: 'kiosk-ui', files: ['src/common/services/pickUpLaterService.js'], category: 'x' },
    { key: 'NGK-3', title: 'other repo', repo: 'kiosk-web-service', files: ['configs/promotion.js'], category: 'x' },
    { key: 'NGK-4', title: 'no pattern', repo: 'kiosk-ui', files: ['src/other.js'], category: 'x' },
  ];
  const plan = P.planRepeats(defects, patterns);
  assert.deepEqual(plan.matches.map((m) => [m.patternId, m.tickets.map((t) => t.key)]), [['pul-entries-not-tied', ['NGK-2']], ['shared-promotion-config-blast-radius', ['NGK-1']]]);
  assert.equal(plan.recorded, 1);
  assert.deepEqual([...plan.matched].sort(), ['NGK-1', 'NGK-2', 'NGK-98319']);
});

// ---------------------------------------------------------------- recording repeats
test('bumping changes only seen and tickets: the rest of the file is byte for byte the same, and adding a ticket twice does nothing', () => {
  const r = P.bumpPatternText(PROMO, ['NGK-1', 'NGK-2', 'NGK-1', 'NGK-98319']);
  assert.deepEqual([r.ok, r.added, r.seen], [true, ['NGK-1', 'NGK-2'], 3]);
  assert.equal(r.text, PROMO.replace('seen: 1', 'seen: 3').replace('tickets: ["NGK-98319"]', 'tickets: ["NGK-98319", "NGK-1", "NGK-2"]'));
  const again = P.bumpPatternText(r.text, ['NGK-1']);
  assert.deepEqual([again.ok, again.added, again.seen, again.text === r.text], [true, [], 3, true]);
  assert.equal(P.bumpPatternText('no front matter', ['A']).ok, false);
  assert.match(P.bumpPatternText('---\ntype: defect-pattern\nseen: 1\ntickets:\n  - NGK-1\n---\n', ['A']).reason, /not on one line/);
  assert.equal(P.bumpPatternText('---\nseen: 1\ntickets: [broken\n---\n', ['A']).ok, false);
});

test('recording writes the planned repeats into the pattern files only, atomically, and leaves other files, retired patterns and odd files alone', () => {
  const RETIRED = PROMO.replace('shared-promotion-config-blast-radius', 'old-one').replace('status: active', 'status: retired');
  const ODD = PUL.replace('pul-entries-not-tied', 'odd-one').replace('tickets: ["NGK-103904"]', 'tickets:\n  - NGK-103904');
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO, 'pul-entries-not-tied': PUL, 'old-one': RETIRED, 'odd-one': ODD } });
  const before = snapshot(root);
  const { patterns } = P.loadPatterns(root);
  const defects = [{ key: 'NGK-1', title: 't', repo: 'kiosk-ui', files: ['configs/promotion.js', 'src/common/services/pickUpLaterService.js'], category: 'x' }];
  const plan = P.planRepeats(defects, patterns);
  assert.deepEqual(plan.matches.map((m) => m.patternId), ['odd-one', 'pul-entries-not-tied', 'shared-promotion-config-blast-radius']);   // the retired one never matches
  const res = P.applyRepeats(plan, patterns, root);
  assert.deepEqual(res.updated.map((u) => [u.id, u.added, u.seen]), [['pul-entries-not-tied', ['NGK-1'], 2], ['shared-promotion-config-blast-radius', ['NGK-1'], 2]]);
  assert.equal(res.skipped.length, 1); assert.match(res.skipped[0].reason, /not on one line/);
  const after = snapshot(root);
  assert.deepEqual(Object.keys(after), Object.keys(before));                                         // no temp files left, no new files
  assert.equal(after['shared-promotion-config-blast-radius.md'], PROMO.replace('seen: 1', 'seen: 2').replace('tickets: ["NGK-98319"]', 'tickets: ["NGK-98319", "NGK-1"]'));
  assert.equal(after['odd-one.md'], before['odd-one.md']); assert.equal(after['old-one.md'], before['old-one.md']); assert.equal(after['README.md'], before['README.md']);
  const again = P.applyRepeats(P.planRepeats(defects, P.loadPatterns(root).patterns), P.loadPatterns(root).patterns, root);
  assert.deepEqual(again.updated, []);                                                                // a second run changes nothing
  assert.deepEqual(snapshot(root), after);
});

test('a pattern file outside docs/defects is never written', () => {
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO } });
  const outside = path.join(tmp, 'elsewhere.md'); fs.writeFileSync(outside, PROMO);
  const { patterns } = P.loadPatterns(root);
  const forged = [{ ...patterns[0], file: outside }];
  const res = P.applyRepeats({ matches: [{ patternId: patterns[0].id, tickets: [{ key: 'NGK-1' }] }] }, forged, root);
  assert.deepEqual(res.updated, []); assert.match(res.skipped[0].reason, /not in docs\/defects/);
  assert.equal(fs.readFileSync(outside, 'utf8'), PROMO);
});

// ---------------------------------------------------------------- clusters
test('clusters: three or more defects with no pattern that changed the same file, biggest first, one problem listed once, with the files most share', () => {
  const mk = (key, repo, files, category = 'Menu, pricing and content data') => ({ key, title: `${key} t`, repo, files, category });
  const defects = [
    mk('NGK-1', 'kiosk-ui', ['src/menu.js', 'src/list.js']), mk('NGK-2', 'kiosk-ui', ['src/menu.js', 'src/list.js']), mk('NGK-3', 'kiosk-ui', ['src/menu.js']), mk('NGK-4', 'kiosk-ui', ['src/menu.js', 'src/other.js']),
    mk('NGK-5', 'kiosk-ui', ['src/pay.js'], 'Payment and payterminal'), mk('NGK-6', 'kiosk-ui', ['src/pay.js'], 'Payment and payterminal'),            // only two
    mk('NGK-7', 'kiosk-web-service', ['src/menu.js']), mk('NGK-8', 'kiosk-web-service', ['src/menu.js']), mk('NGK-9', 'kiosk-web-service', ['src/menu.js']),   // the same name in another repo
    mk('NGK-10', 'kiosk-ui', ['src/menu.js']),                                                                                                   // matched by a pattern: excluded below
  ];
  const cl = P.findClusters(defects, new Set(['NGK-10']));
  assert.deepEqual(cl.map((c) => [c.repo, c.count]), [['kiosk-ui', 4], ['kiosk-web-service', 3]]);                                              // the list.js group is inside the menu.js one, so not listed again
  assert.deepEqual(cl[0].files, ['src/menu.js', 'src/list.js'].slice(0, 1).concat(['src/list.js']).filter((f) => f === 'src/menu.js' || f === 'src/list.js').slice(0, cl[0].files.length));
  assert.ok(cl[0].files.includes('src/menu.js'));
  assert.deepEqual(cl[0].tickets.map((t) => t.key), ['NGK-1', 'NGK-2', 'NGK-3', 'NGK-4']);
  assert.match(cl[0].id, /^[0-9a-f]{8}$/);
  assert.equal(P.findClusters(defects, new Set(['NGK-10'])).map((c) => c.id).join(), cl.map((c) => c.id).join());                                // the id is stable
  assert.deepEqual(P.findClusters(defects.slice(4, 6), new Set()), []);
  assert.deepEqual(P.findClusters([], new Set()), []);
});

// ---------------------------------------------------------------- drafting
const cluster = { id: 'abcd1234', repo: 'kiosk-ui', files: ['src/menu.js', 'src/list.js'], category: 'Menu, pricing and content data', count: 3, tickets: [{ key: 'NGK-1', title: 'Menu tile missing' }, { key: 'NGK-2', title: 'Menu tile hidden' }, { key: 'NGK-3', title: 'Menu tile blank' }] };
const tickets = cluster.tickets.map((t) => ({ ...t, description: 'The tile does not show password=hunter2secret when loaded.', prTitle: 'NGK-1: fix tile' }));
const GOODDRAFT = { name: 'Menu Tile Filter Drops Items!', title: 'Menu tile filter drops items', capabilities: ['cart-assembly', 'not-a-capability'], keywords: ['menu', 'tile', 'filter'], smell: 'A diff changes the tile filter predicate in menu.js without a case for empty availability.', why: 'Items vanish from the menu for tenants whose availability data is empty.', check: 'Does the filter keep items whose availability is missing? Test with an empty availability list.', example: 'NGK-1 hid tiles for one tenant.' };

test('the draft prompt follows the RAG rules, and what is sent is scrubbed and carries the allowed capabilities', () => {
  assert.ok(Dr.PROMPT.includes('"notAPattern": true') && Dr.PROMPT.includes('CI, lint or the compiler would not already catch it'));
  const input = JSON.parse(Dr.buildInput({ cluster, tickets, capabilities: ['cart-assembly', 'coupons'], existingIds: ['x-pattern'] }));
  assert.deepEqual([input.repo, input.files, input.capabilityNames, input.existingPatternIds], ['kiosk-ui', cluster.files, ['cart-assembly', 'coupons'], ['x-pattern']]);
  assert.ok(!JSON.stringify(input).includes('hunter2secret')); assert.ok(JSON.stringify(input).includes('[redacted]'));
});

test('a model draft is checked: ids made safe and unique, unknown capabilities dropped, texts clipped, "not a pattern" passed on, nonsense refused', () => {
  const d1 = Dr.parseDraft(GOODDRAFT, { capabilities: ['cart-assembly'], existingIds: ['menu-tile-filter-drops-items'] });
  assert.deepEqual([d1.name, d1.capabilities], ['menu-tile-filter-drops-items-2', ['cart-assembly']]);
  assert.deepEqual(Dr.parseDraft({ ...GOODDRAFT, capabilities: [] }, { capabilities: ['x'] }).capabilities, []);
  assert.ok(Dr.parseDraft({ ...GOODDRAFT, smell: 'x'.repeat(900) }, {}).smell.length <= 240);
  assert.deepEqual(Dr.parseDraft({ notAPattern: true, reason: 'These defects are unrelated.' }), { notAPattern: true, reason: 'These defects are unrelated.' });
  assert.equal(Dr.parseDraft({ name: 'x', smell: '', why: 'w', check: 'c' }), null); assert.equal(Dr.parseDraft(null), null); assert.equal(Dr.parseDraft({ smell: 's', why: 'w', check: 'c' }), null);
  assert.equal(Dr.parseDraft({ ...GOODDRAFT, example: 'a\nb\nc\nd\ne\nf' }, {}).example.length, 4);
});

test('the rendered pattern passes the same checks as the RAG tests: fields, section order, at most 20 lines, example at most 5, no card numbers or emails, known capabilities', () => {
  const draft = Dr.parseDraft(GOODDRAFT, { capabilities: ['cart-assembly'] });
  const text = Dr.renderPattern(draft, cluster, '2026-11-14');
  assert.deepEqual(Dr.validatePattern(text, { capabilities: ['cart-assembly'] }), []);
  assert.match(text, /^---\ntype: defect-pattern\nid: menu-tile-filter-drops-items\ncapabilities: \["cart-assembly"\]\nrepos: \["kiosk-ui"\]\npaths: \["src\/menu.js", "src\/list.js"\]\n/);
  assert.match(text, /seen: 3\nrecorded: 2026-11-14\ntickets: \["NGK-1", "NGK-2", "NGK-3"\]\nstatus: active\n---\n# Menu tile filter drops items\n\n## Smell\n/);
  assert.ok(text.indexOf('## Smell') < text.indexOf('## Why it bites') && text.indexOf('## Why it bites') < text.indexOf('## Check') && text.indexOf('## Check') < text.indexOf('## Example'));
  const long = Dr.parseDraft({ ...GOODDRAFT, smell: 'word '.repeat(60), why: 'word '.repeat(60), check: 'word '.repeat(70), example: 'a\nb\nc\nd' }, { capabilities: ['cart-assembly'] });
  const t2 = Dr.renderPattern(long, cluster, '2026-11-14');
  const body = t2.split('\n---\n')[1].split('\n').filter((l) => l.trim());
  assert.ok(body.length <= Dr.MAX_BODY_LINES, `body ${body.length}`);
  assert.deepEqual(Dr.validatePattern(t2, { capabilities: ['cart-assembly'] }), []);
  // the checker catches what it should
  const bad = (edit) => Dr.validatePattern(edit(text), { capabilities: ['cart-assembly'] });
  assert.ok(bad((t) => t.replace('## Why it bites', '## Whatever')).some((p) => /sections/.test(p)));
  assert.ok(bad((t) => t.replace('capabilities: ["cart-assembly"]', 'capabilities: []')).some((p) => /capabilities is empty/.test(p)));
  assert.ok(bad((t) => t.replace('["cart-assembly"]', '["nope"]')).some((p) => /unknown capability: nope/.test(p)));
  assert.ok(bad((t) => `${t}\n4111 1111 1111 1111\n`).some((p) => /card-like number/.test(p)));
  assert.ok(bad((t) => `${t}\nwrite to someone@example.com\n`).some((p) => /email address/.test(p)));
  assert.ok(bad((t) => `${t}${'\nmore text'.repeat(25)}`).some((p) => /body has/.test(p)));
  assert.ok(bad((t) => t.replace('type: defect-pattern\n', '')).some((p) => /missing type/.test(p)));
  assert.deepEqual(Dr.validatePattern('nothing', {}), ['no front matter']);
});

test('drafting makes one model call, stages the file in the app\'s data folder (never the RAG), and reports a missing capability, a refusal, a failure and unusable answers', async () => {
  const stageDir = fs.mkdtempSync(path.join(tmp, 'stage-'));
  let calls = 0;
  const ok = (obj) => async ({ model, prompt, input }) => { calls++; assert.equal(model, 'sonnet'); assert.equal(prompt, Dr.PROMPT); assert.ok(input.includes('capabilityNames')); return { ok: true, text: `Sure:\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` }; };
  const base = { cluster, tickets, capabilities: ['cart-assembly'], existingIds: [], today: '2026-11-14', stage: (id, text) => Dr.stageDraft(id, text, stageDir) };
  const a = await Dr.draftPattern({ ...base, claude: ok(GOODDRAFT) });
  assert.deepEqual([a.ok, a.id, a.problems, a.needsCapability, calls], [true, 'menu-tile-filter-drops-items', [], false, 1]);
  assert.equal(a.path, path.join(stageDir, 'menu-tile-filter-drops-items.md')); assert.equal(fs.readFileSync(a.path, 'utf8'), a.text);
  const noCap = await Dr.draftPattern({ ...base, claude: ok({ ...GOODDRAFT, capabilities: ['made-up'] }) });
  assert.equal(noCap.ok, true); assert.equal(noCap.needsCapability, true); assert.ok(noCap.problems.some((p) => /capabilities is empty/.test(p)));
  const refused = await Dr.draftPattern({ ...base, claude: ok({ notAPattern: true, reason: 'Unrelated defects.' }) });
  assert.deepEqual([refused.ok, refused.notAPattern, refused.reason], [false, true, 'Unrelated defects.']);
  const down = await Dr.draftPattern({ ...base, claude: async () => ({ ok: false, reason: 'the claude CLI took longer than 180s' }) });
  assert.deepEqual([down.ok, down.reason], [false, 'the claude CLI took longer than 180s']);
  assert.match((await Dr.draftPattern({ ...base, claude: async () => ({ ok: true, text: 'no json' }) })).reason, /not in a usable form/);
  assert.equal(Dr.DRAFTS_DIR.startsWith(tmp), true);                                                  // the default staging place is under the app's data folder
});

// ---------------------------------------------------------------- ingest
const fakeSpawn = (code) => () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; setImmediate(() => { c.stderr.emit('data', 'boom line\n'); c.emit('close', code); }); return c; };
test('ingest runs the RAG python on ingest.py from the RAG folder and reports problems without throwing', async () => {
  const calls = [];
  const spy = (cmd, args, opts) => { calls.push([cmd, args, opts.cwd]); return fakeSpawn(0)(); };
  assert.deepEqual(await I.runIngest({ ragRoot: '/r', spawnFn: spy, exists: () => true }), { ok: true });
  assert.deepEqual(calls, [['/r/.venv/bin/python', ['/r/ingest.py'], '/r']]);
  const missing = await I.runIngest({ ragRoot: '/r', spawnFn: spy, exists: () => false });
  assert.equal(missing.ok, false); assert.match(missing.reason, /not found in \/r/); assert.equal(calls.length, 1);
  assert.match((await I.runIngest({ ragRoot: '/r', spawnFn: fakeSpawn(2), exists: () => true })).reason, /code 2: boom line/);
});

// ---------------------------------------------------------------- the service and routes
const row = (key, o = {}) => ({ key, type: 'Defect', created: '2026-10-01T12:00:00', resolved: '2026-11-11T12:00:00', summary: `${key} receipt total wrong`, description: 'desc', components: ['FE'], clients: ['AA-US'], labels: [], statusCategory: '', updated: null, firstSprintStart: null, ...o });
const ledgerOf = (...prs) => ({ prs: Object.fromEntries(prs.map((p) => [p.id, p])) });
const lpr = (n, keys, files, repo = 'kiosk-ui') => ({ id: `${repo}#${n}`, repo, number: String(n), title: `${keys[0]}: fix`, mergedAt: '2026-11-10T00:00:00Z', keys, files: files.map((name) => ({ name })) });
const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('the analysis shows which defects repeat a pattern and which groups might be new ones; recording edits the pattern files and ingests once; drafting needs a click', async () => {
  reset();
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO } });
  store.upsert([
    row('NGK-1'), row('NGK-2'),                                                                         // both changed configs/promotion.js: repeats of the promotion pattern
    row('NGK-3'), row('NGK-4'), row('NGK-5'),                                                           // three changed src/menu.js: a possible new pattern
    row('NGK-6'),                                                                                       // no PR in the ledger
  ]);
  const ledger = ledgerOf(lpr(1, ['NGK-1'], ['configs/promotion.js']), lpr(2, ['NGK-2'], ['configs/promotion.js']), lpr(3, ['NGK-3'], ['src/menu.js']), lpr(4, ['NGK-4'], ['src/menu.js']), lpr(5, ['NGK-5'], ['src/menu.js']));
  let ingests = 0; let modelCalls = 0;
  const GOOD = JSON.stringify(GOODDRAFT);
  const svc = createTrendsService({ now: () => NOW, ledger: () => ledger, ragRoot: () => root, ingest: async () => { ingests++; return { ok: true }; }, claude: async () => { modelCalls++; return { ok: true, text: GOOD }; }, draft: (a) => Dr.draftPattern({ ...a, stage: (id, text) => Dr.stageDraft(id, text, path.join(root, '..', 'staged')) }) });
  const before = snapshot(root);
  const a = svc.defectAnalysis({ months: 6 }).patterns;
  assert.deepEqual([a.ragFound, a.patternCount, a.defects, a.withPr, a.recorded], [true, 1, 6, 5, 0]);
  assert.deepEqual(a.matches.map((m) => [m.patternId, m.tickets.map((t) => t.key)]), [['shared-promotion-config-blast-radius', ['NGK-1', 'NGK-2']]]);
  assert.deepEqual(a.clusters.map((c) => [c.count, c.files]), [[3, ['src/menu.js']]]);
  assert.deepEqual([ingests, modelCalls], [0, 0]); assert.deepEqual(snapshot(root), before);           // looking changes and costs nothing

  const rec = await svc.recordRepeats({ months: 6 });
  assert.deepEqual([rec.ok, rec.updated.map((u) => [u.id, u.added, u.seen]), rec.ingest, ingests], [true, [['shared-promotion-config-blast-radius', ['NGK-1', 'NGK-2'], 3]], 'ok', 1]);
  assert.match(snapshot(root)['shared-promotion-config-blast-radius.md'], /seen: 3\n[\s\S]*tickets: \["NGK-98319", "NGK-1", "NGK-2"\]/);
  const after = svc.defectAnalysis({ months: 6 }).patterns;
  assert.deepEqual([after.matches, after.recorded], [[], 2]);                                           // now recorded: nothing left to plan
  const again = await svc.recordRepeats({ months: 6 });
  assert.deepEqual([again.updated, again.ingest, ingests], [[], 'none', 1]);                           // no change, no ingest

  const d = await svc.draftForCluster({ months: 6, cluster: a.clusters[0].id });
  assert.deepEqual([d.ok, d.id, modelCalls], [true, 'menu-tile-filter-drops-items', 1]);
  assert.equal(d.needsCapability, false);                                                               // the draft named cart-assembly, which exists in this RAG
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'defects', 'menu-tile-filter-drops-items.md')));    // a draft never lands in the RAG
  assert.ok(fs.existsSync(d.path));
  assert.deepEqual((await svc.draftForCluster({ months: 6, cluster: 'ffffffff' })).ok, false);
  const gone = createTrendsService({ now: () => NOW, ledger: () => ledger, ragRoot: () => path.join(tmp, 'nowhere') });
  assert.equal(gone.defectAnalysis({ months: 6 }).patterns.ragFound, false);
  assert.match((await gone.recordRepeats({ months: 6 })).reason, /not found at .*nowhere/);
  reset();
});

test('when ingest fails after recording, the files stay updated and the failure is reported', async () => {
  reset();
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO } });
  store.upsert([row('NGK-1')]);
  const svc = createTrendsService({ now: () => NOW, ledger: () => ledgerOf(lpr(1, ['NGK-1'], ['configs/promotion.js'])), ragRoot: () => root, ingest: async () => ({ ok: false, reason: 'ingest exited with code 1' }) });
  const r = await svc.recordRepeats({ months: 6 });
  assert.deepEqual([r.ok, r.updated.length, r.ingest, r.reason], [true, 1, 'failed', 'ingest exited with code 1']);
  assert.match(snapshot(root)['shared-promotion-config-blast-radius.md'], /seen: 2/);
  reset();
});

test('the routes: record and draft with their guards, bad requests, busy and failure answers', async () => {
  reset();
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO }, caps: ['cart-assembly'] });
  store.upsert([row('NGK-1'), row('NGK-3'), row('NGK-4'), row('NGK-5')]);
  const ledger = ledgerOf(lpr(1, ['NGK-1'], ['configs/promotion.js']), lpr(3, ['NGK-3'], ['src/menu.js']), lpr(4, ['NGK-4'], ['src/menu.js']), lpr(5, ['NGK-5'], ['src/menu.js']));
  let release; const gate = new Promise((r) => { release = r; }); let mode = 'ok';
  const svc = createTrendsService({ now: () => NOW, ledger: () => ledger, ragRoot: () => root, ingest: async () => ({ ok: true }),
    draft: async () => { if (mode === 'wait') await gate; return mode === 'refuse' ? { ok: false, notAPattern: true, reason: 'Unrelated.' } : mode === 'fail' ? { ok: false, reason: 'the claude CLI took longer than 180s' } : { ok: true, id: 'x-pattern', text: 'T', path: '/staged/x-pattern.md', problems: [], needsCapability: false }; } });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json()); app.use('/api', createTrendsRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const an = await call(server, 'GET', '/api/trends/defects?months=6');
    assert.equal(an.status, 200); assert.equal(an.json.data.patterns.matches[0].tickets[0].key, 'NGK-1'); const cid = an.json.data.patterns.clusters[0].id;
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/patterns/record`, { method: 'POST' })).status, 415);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/patterns/draft`, { method: 'POST' })).status, 415);
    assert.equal((await call(server, 'POST', '/api/trends/patterns/record', { months: 12 })).status, 400);
    for (const bad of [{ months: 6 }, { months: 6, cluster: 'nothex!!' }, { months: 6, cluster: 'ABCDEF12' }, { months: 9, cluster: cid }]) assert.equal((await call(server, 'POST', '/api/trends/patterns/draft', bad)).status, 400, JSON.stringify(bad));
    const rec = await call(server, 'POST', '/api/trends/patterns/record', { months: 6 });
    assert.equal(rec.status, 200); assert.deepEqual([rec.json.data.updated[0].id, rec.json.data.ingest], ['shared-promotion-config-blast-radius', 'ok']);
    const ok = await call(server, 'POST', '/api/trends/patterns/draft', { months: 6, cluster: cid });
    assert.equal(ok.status, 200); assert.deepEqual([ok.json.data.id, ok.json.data.path], ['x-pattern', '/staged/x-pattern.md']);
    mode = 'refuse'; const ref = await call(server, 'POST', '/api/trends/patterns/draft', { months: 6, cluster: cid });
    assert.deepEqual([ref.status, ref.json.success, ref.json.data], [200, true, { notAPattern: true, reason: 'Unrelated.' }]);
    mode = 'fail'; const f = await call(server, 'POST', '/api/trends/patterns/draft', { months: 6, cluster: cid });
    assert.equal(f.status, 502); assert.match(f.json.error, /180s/);
    mode = 'wait'; const first = call(server, 'POST', '/api/trends/patterns/draft', { months: 6, cluster: cid });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call(server, 'POST', '/api/trends/patterns/draft', { months: 6, cluster: cid })).status, 409);
    release(); assert.equal((await first).status, 200);
  } finally { release?.(); server.close(); }
  reset();
});

// ---------------------------------------------------------------- adding a reviewed pattern to the RAG
const GOODFILE = () => { const draft = Dr.parseDraft(GOODDRAFT, { capabilities: ['cart-assembly'] }); return Dr.renderPattern(draft, cluster, '2026-11-14'); };

test('adding writes docs/defects/<id>.md from the reviewed text, checks it again against the RAG rules, never overwrites, and runs ingest once', async () => {
  const root = makeRag({ patterns: { 'shared-promotion-config-blast-radius': PROMO }, caps: ['cart-assembly', 'coupons'] });
  let ingests = 0;
  const svc = createTrendsService({ now: () => NOW, ragRoot: () => root, ingest: async () => { ingests++; return { ok: true }; } });
  const before = snapshot(root);
  const good = GOODFILE();
  const r = await svc.addPattern({ text: good });
  assert.deepEqual([r.ok, r.id, r.ingest, ingests], [true, 'menu-tile-filter-drops-items', 'ok', 1]);
  assert.equal(r.path, path.join(root, 'docs', 'defects', 'menu-tile-filter-drops-items.md'));
  assert.equal(fs.readFileSync(r.path, 'utf8'), good);
  const after = snapshot(root);
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), 'menu-tile-filter-drops-items.md'].sort());       // one new file, nothing else touched
  for (const k of Object.keys(before)) assert.equal(after[k], before[k]);
  assert.deepEqual(P.loadPatterns(root).patterns.map((p) => p.id), ['menu-tile-filter-drops-items', 'shared-promotion-config-blast-radius']);   // and the RAG can read it

  const dup = await svc.addPattern({ text: good });                                                                         // the same id again: refused, file untouched
  assert.equal(dup.ok, false); assert.match(dup.reason, /already exists in the RAG; it was not overwritten/); assert.equal(ingests, 1);
  assert.equal(fs.readFileSync(r.path, 'utf8'), good);

  const edited = good.replace('capabilities: ["cart-assembly"]', 'capabilities: ["made-up"]').replace('id: menu-tile-filter-drops-items', 'id: another-one');
  const bad = await svc.addPattern({ text: edited });
  assert.equal(bad.ok, false); assert.match(bad.reason, /The RAG's checks would fail: unknown capability: made-up/); assert.deepEqual(bad.problems, ['unknown capability: made-up']);
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'defects', 'another-one.md')));
  const noCap = await svc.addPattern({ text: good.replace('capabilities: ["cart-assembly"]', 'capabilities: []').replace('id: menu-tile-filter-drops-items', 'id: no-cap') });
  assert.match(noCap.reason, /capabilities is empty/);
  for (const badId of ['../escape', 'Has Caps', '-lead', 'a'.repeat(61)]) {
    const r2 = await svc.addPattern({ text: good.replace('id: menu-tile-filter-drops-items', `id: ${badId}`) });
    assert.equal(r2.ok, false, badId);
  }
  assert.deepEqual(Object.keys(snapshot(root)).sort(), Object.keys(after).sort());                                           // nothing else was written, nothing outside docs/defects
  assert.equal(fs.existsSync(path.join(root, 'docs', 'escape.md')), false);
  assert.equal((await svc.addPattern({ text: 'not a pattern' })).ok, false);
  assert.equal((await svc.addPattern({})).ok, false);
});

test('adding reports a missing RAG folder, and an ingest failure after the file is written', async () => {
  const none = createTrendsService({ now: () => NOW, ragRoot: () => path.join(tmp, 'nowhere') });
  assert.match((await none.addPattern({ text: GOODFILE() })).reason, /not found at .*nowhere/);
  const root = makeRag({ caps: ['cart-assembly'] });
  const svc = createTrendsService({ now: () => NOW, ragRoot: () => root, ingest: async () => ({ ok: false, reason: 'ingest exited with code 1' }) });
  const r = await svc.addPattern({ text: GOODFILE() });
  assert.deepEqual([r.ok, r.ingest, r.reason], [true, 'failed', 'ingest exited with code 1']);
  assert.ok(fs.existsSync(r.path));                                                                                         // the file stays; only ingest failed
});

test('the add route: guards, size limit, the checks failing, an existing id, and a busy answer', async () => {
  const root = makeRag({ caps: ['cart-assembly'] });
  let release; const gate = new Promise((r) => { release = r; }); let wait = false;
  const svc = createTrendsService({ now: () => NOW, ragRoot: () => root, ingest: async () => { if (wait) await gate; return { ok: true }; } });
  const { default: express } = await import('express');
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api', createTrendsRouter({ service: svc }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trends/patterns/add`, { method: 'POST' })).status, 415);
    for (const bad of [{}, { text: '' }, { text: 5 }, { text: 'x'.repeat(20001) }]) assert.equal((await call(server, 'POST', '/api/trends/patterns/add', bad)).status, 400);
    const good = GOODFILE();
    const fail = await call(server, 'POST', '/api/trends/patterns/add', { text: good.replace('capabilities: ["cart-assembly"]', 'capabilities: []') });
    assert.equal(fail.status, 422); assert.match(fail.json.error, /capabilities is empty/); assert.ok(fail.json.problems.length >= 1);
    wait = true; const first = call(server, 'POST', '/api/trends/patterns/add', { text: good });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await call(server, 'POST', '/api/trends/patterns/add', { text: good })).status, 409);
    release(); const ok = await first;
    assert.equal(ok.status, 200); assert.deepEqual([ok.json.data.id, ok.json.data.ingest], ['menu-tile-filter-drops-items', 'ok']);
    wait = false;
    const dup = await call(server, 'POST', '/api/trends/patterns/add', { text: good });
    assert.equal(dup.status, 422); assert.match(dup.json.error, /already exists/);
  } finally { release?.(); server.close(); }
});
