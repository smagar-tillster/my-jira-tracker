// Initiate Code Review: prompt, model choice, parsing, anchoring, the pipeline with a fake `claude`, the job queue and the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-gen-'));
process.env.NGK_DATA_DIR = tmp;

const gen = await import('../lib/reviewgen.mjs');
const { getReview, listReviews } = await import('../lib/reviews.mjs');

const PATCH = '@@ -1,2 +1,3 @@\n a\n+b\n c';
const FILES = [{ filename: 'src/a.js', status: 'modified', additions: 1, deletions: 0, patch: PATCH }];
const head = (sha = 'abcdef1234', state = 'OPEN') => ({ state, headRefOid: sha, baseRefName: 'main', title: 'NGK-1 change', url: 'https://x/pr/1', author: { login: 'dev' } });
const packet = (tier = 'light', sha) => async () => ({ text: '<!-- headSha -->\npacket text', p: { files: [{ name: 'src/a.js' }], keys: ['NGK-1'] }, head: head(sha), tier: { tier } });
const answer = (o = {}) => JSON.stringify({
  body: '### Summary\nSmall change.\n\n**Result:** 1 issue.', inline: [{ path: 'src/a.js', line: 2, side: 'RIGHT', severity: 'issue', body: '**Issue:** b is unchecked.' }],
  summary: { changes: 'c', impact: 'i', risks: 'r', tests: 't' }, risk: 'low', patterns: ['p-one', 'invented'], components: ['FE'], flags: { confidence: 'high' }, internalNotes: ['docs need an update'], ...o,
});
const okClaude = (text, seen = []) => async (a) => { seen.push(a); return { ok: true, text }; };
const noHelper = async () => null;
const helperWith = async () => ({ capabilities: [{ capability: 'cart' }], shared_files: [], defect_patterns: [{ id: 'p-one', matched: ['src/a.js'], doc: 'defects/does-not-exist.md' }] });
const gh = async () => { throw new Error('no network in tests'); };

test('prompt carries the depth rules and the model follows the tier', () => {
  assert.match(gen.buildPrompt('light'), /At most 4 line comments/);
  assert.match(gen.buildPrompt('deep'), /At most 10 line comments/);
  assert.ok(!gen.buildPrompt('deep').includes('{{DEPTH}}'));
  assert.equal(gen.chooseModel('light', { models: { light: 'haiku', deep: 'sonnet' } }), 'haiku');
  assert.equal(gen.chooseModel('deep', { models: { light: 'haiku', deep: 'sonnet' } }), 'sonnet');
});

test('parseModelJson tolerates fences and surrounding text, and rejects the rest', () => {
  assert.deepEqual(gen.parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(gen.parseModelJson('Here you go: {"a":{"b":2}} done'), { a: { b: 2 } });
  assert.equal(gen.parseModelJson('no json'), null);
  assert.equal(gen.parseModelJson('{broken'), null);
  assert.equal(gen.parseModelJson('[1,2]'), null);
});

test('hunkRanges lists the new-file ranges of each hunk', () => {
  assert.deepEqual(gen.hunkRanges('@@ -1,2 +1,3 @@\n a\n@@ -10 +12,2 @@\n x'), [[1, 3], [12, 13]]);
  assert.deepEqual(gen.hunkRanges('@@ -5,3 +5,0 @@\n-x'), []); // pure deletion
});

test('contextFor numbers the unchanged lines around a hunk and skips changed ones', async () => {
  const content = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
  const calls = [];
  const fakeGh = async (args) => { calls.push(args.join(' ')); return { encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') }; };
  const out = await gen.contextFor({
    prFiles: [{ filename: 'src/a.js', status: 'modified', additions: 3, deletions: 0, patch: '@@ -10,2 +10,3 @@\n x' },
      { filename: 'README.md', status: 'modified', additions: 9, deletions: 0, patch: '@@ -1 +1,2 @@\n y' }],
    gh: fakeGh, slug: 'T/r', sha: 'abc', around: 3,
  });
  assert.equal(calls.length, 1); // only the source file is fetched
  assert.match(calls[0], /contents\/src\/a\.js\?ref=abc/);
  assert.match(out, /^7 +line7$/m);
  assert.match(out, /^14 +line14$/m);
  assert.ok(!/^10 +line10$/m.test(out)); // changed lines are already in the patch
});

test('cleanInline drops a startLine that is not before line, and comments with no usable anchor or text', () => {
  const out = gen.cleanInline([
    { path: 'a.js', line: 5, startLine: 5, side: 'RIGHT', body: 'same line' },
    { path: 'a.js', line: '7', startLine: '3', side: 'RIGHT', body: 'range' },
    { path: 'a.js', line: 9, startLine: 12, body: 'backwards' },
    { path: '', line: 2, body: 'no path' },
    { path: 'a.js', line: 0, body: 'no line' },
    { path: 'a.js', line: 4, body: '   ' },
  ]);
  assert.deepEqual(out.map((c) => [c.line, c.startLine]), [[5, undefined], [7, 3], [9, undefined]]);
  assert.deepEqual(gen.cleanInline(undefined), []);
});

test('a model answer with startLine equal to line still saves a draft', async () => {
  const bad = answer({ inline: [{ path: 'src/a.js', line: 2, startLine: 2, side: 'RIGHT', severity: 'issue', body: '**Issue:** x.' }] });
  const r = await gen.generateReview({ repo: 'kiosk-ui', number: 106, gh, buildPacket: packet('light', 'f1e1234567'), prFiles: async () => FILES, claude: okClaude(bad), helper: noHelper });
  assert.equal(r.state, 'done', r.message);
  assert.equal(getReview('kiosk-ui', 106, 'f1e1234567').inline.length, 1);
});

test('a comment that is not on a diff line is moved into the overview, not lost', () => {
  const draft = { body: 'Overview', inline: [
    { path: 'src/a.js', line: 2, side: 'RIGHT', severity: 'issue', body: 'on the diff' },
    { path: 'src/a.js', line: 99, side: 'RIGHT', severity: 'suggestion', body: 'off the diff' },
  ] };
  const { draft: d, moved } = gen.settleAnchors(draft, FILES);
  assert.equal(moved, 1);
  assert.equal(d.inline.length, 1);
  assert.ok(d.inline[0].diffContext.length);
  assert.match(d.body, /### Also noticed\n- `src\/a\.js:99` off the diff/);
});

test('generateReview saves a draft: tier model, known patterns only, internal notes kept apart from the body', async () => {
  const seen = [];
  const r = await gen.generateReview({ repo: 'kiosk-ui', number: 101, gh, buildPacket: packet('light'), prFiles: async () => FILES, claude: okClaude(answer(), seen), helper: helperWith });
  assert.equal(r.state, 'done', r.message);
  assert.equal(seen[0].model, 'haiku');
  assert.match(seen[0].input, /packet text/);
  const d = getReview('kiosk-ui', 101, 'abcdef1234');
  assert.equal(d.status, 'draft');
  assert.equal(d.event, 'COMMENT');
  assert.equal(d.tier, 'light');
  assert.deepEqual(d.patterns, ['p-one']); // "invented" was not provided to the model
  assert.equal(d.inline.length, 1);
  assert.ok(d.internalNotes.includes('docs need an update'));
  assert.ok(!/docs need an update|knowledge base/i.test(d.body));
});

test('a deep PR uses the deep model and the surrounding code', async () => {
  const seen = []; const ctxCalls = [];
  const ghFile = async (args) => { ctxCalls.push(args.join(' ')); const c = ['a', 'b', 'c'].join('\n'); return { encoding: 'base64', size: 5, content: Buffer.from(c).toString('base64') }; };
  const r = await gen.generateReview({ repo: 'kiosk-ui', number: 102, gh: ghFile, buildPacket: packet('deep', 'deadbee1234'), prFiles: async () => FILES, claude: okClaude(answer({ inline: [] }), seen), helper: noHelper });
  assert.equal(r.state, 'done', r.message);
  assert.equal(seen[0].model, 'sonnet');
  assert.ok(ctxCalls.some((c) => c.includes('contents/src/a.js')));
  const d = getReview('kiosk-ui', 102, 'deadbee1234');
  assert.equal(d.tier, 'deep');
  assert.ok(d.internalNotes.some((n) => /helper unavailable/i.test(n)));
});

test('an existing draft is not generated again, and the model is not called', async () => {
  let calls = 0;
  const claude = async () => { calls++; return { ok: true, text: answer() }; };
  const r = await gen.generateReview({ repo: 'kiosk-ui', number: 101, gh, buildPacket: packet('light'), prFiles: async () => FILES, claude, helper: noHelper });
  assert.equal(r.state, 'exists');
  assert.equal(calls, 0);
});

test('when the claude CLI is unusable the request is queued for a Claude session', async () => {
  const r = await gen.generateReview({ repo: 'kiosk-ui', number: 103, gh, buildPacket: packet('light', 'cafe1234567'), prFiles: async () => FILES, claude: async () => ({ ok: false, reason: 'not logged in', text: '' }), helper: noHelper });
  assert.equal(r.state, 'queued');
  assert.ok(!/claude|\bAI\b/i.test(r.message)); // shown in the UI
  const req = JSON.parse(fs.readFileSync(path.join(gen.REQUESTS_DIR, 'kiosk-ui__103.json'), 'utf8'));
  assert.match(req.hint, /pr-review kiosk-ui#103/);
  assert.equal(getReview('kiosk-ui', 103, 'cafe1234567'), null);
});

test('garbage from the model fails without saving, and a closed PR or unknown repo is refused', async () => {
  const bad = await gen.generateReview({ repo: 'kiosk-ui', number: 104, gh, buildPacket: packet('light', 'bad1234567'), prFiles: async () => FILES, claude: okClaude('sorry, I cannot'), helper: noHelper });
  assert.equal(bad.state, 'failed');
  assert.equal(getReview('kiosk-ui', 104, 'bad1234567'), null);
  const closed = await gen.generateReview({ repo: 'kiosk-ui', number: 105, gh, buildPacket: async () => ({ text: '', p: { files: [], keys: [] }, head: head('c10sed1234', 'MERGED'), tier: { tier: 'light' } }), prFiles: async () => FILES, claude: okClaude(answer()), helper: noHelper });
  assert.equal(closed.state, 'failed');
  assert.match(closed.message, /merged/);
  assert.equal((await gen.generateReview({ repo: 'nope', number: 1, gh, buildPacket: packet(), prFiles: async () => [] })).state, 'failed');
});

test('the job runner runs at most maxParallel at once, keeps order and ignores duplicates', async () => {
  let active = 0; let peak = 0; const order = [];
  const release = [];
  const runner = gen.createJobRunner({
    maxParallel: 2,
    work: ({ n }) => new Promise((resolve) => { active++; peak = Math.max(peak, active); order.push(n); release.push(() => { active--; resolve({ state: 'done', message: `ok ${n}` }); }); }),
  });
  for (const n of [1, 2, 3, 4]) runner.enqueue(`r#${n}`, { n });
  assert.equal(runner.enqueue('r#1', { n: 1 }).state, 'running'); // duplicate while running: same job
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [1, 2]);
  assert.deepEqual(Object.values(runner.status()).map((j) => j.state), ['running', 'running', 'waiting', 'waiting']);
  release.shift()(); release.shift()();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [1, 2, 3, 4]);
  while (release.length) release.shift()();
  await runner.whenIdle();
  assert.equal(peak, 2);
  assert.ok(Object.values(runner.status()).every((j) => j.state === 'done' && j.message.startsWith('ok')));
});

test('a job that throws is marked failed and does not block the queue', async () => {
  const runner = gen.createJobRunner({ maxParallel: 1, work: async ({ n }) => { if (n === 1) throw new Error('boom'); return { state: 'done', message: 'fine' }; } });
  runner.enqueue('r#1', { n: 1 }); runner.enqueue('r#2', { n: 2 });
  await runner.whenIdle();
  const s = runner.status();
  assert.equal(s['r#1'].state, 'failed');
  assert.equal(s['r#1'].message, 'boom');
  assert.equal(s['r#2'].state, 'done');
});

// ---- routes
test('POST /reviews/generate validates, queues several PRs and GET status reports each one', async () => {
  const { default: express } = await import('express');
  const { createReviewsRouter } = await import('../../src/routes/reviews.js');
  const ghFake = async (args) => {
    const a = args.join(' ');
    if (a.startsWith('pr view')) return { title: 'NGK-9 x', body: '', headRefName: 'f', headRefOid: `${args[2]}0000000`, isDraft: false, state: 'OPEN', url: 'u', author: { login: 'd' }, baseRefName: 'main', commits: [], additions: 3, deletions: 0, changedFiles: 1, files: [{ path: 'src/a.js', additions: 3, deletions: 0 }] };
    if (a.includes('/pulls/') && a.includes('/files')) return [{ filename: 'src/a.js', status: 'modified', additions: 3, deletions: 0, patch: PATCH }];
    throw new Error(`unexpected gh call: ${a}`);
  };
  const router = createReviewsRouter({ gh: ghFake, claude: okClaude(answer({ patterns: [] })), helper: noHelper });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/reviews`;
  const post = (body) => fetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ prs: [{ repo: 'nope', number: 1 }] })).status, 400);
    assert.equal((await post({ prs: [{ repo: 'kiosk-ui', number: -3 }] })).status, 400);
    assert.equal((await post({ prs: Array.from({ length: 21 }, (_, i) => ({ repo: 'kiosk-ui', number: i + 1 })) })).status, 400);
    assert.equal((await fetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);

    const res = await post({ prs: [{ repo: 'kiosk-ui', number: 201 }, { repo: 'kiosk-ui', number: 202 }, { repo: 'kiosk-ui', number: 201 }] });
    assert.equal(res.status, 202);
    assert.deepEqual(Object.keys((await res.json()).data), ['kiosk-ui#201', 'kiosk-ui#202']);
    await router.generateRunner.whenIdle();
    const status = (await (await fetch(`${base}/generate/status`)).json()).data;
    assert.equal(status['kiosk-ui#201'].state, 'done', status['kiosk-ui#201'].message);
    assert.equal(status['kiosk-ui#202'].state, 'done', status['kiosk-ui#202'].message);
    assert.ok(listReviews().some((r) => r.number === 201) && listReviews().some((r) => r.number === 202));

    // asking again for the same commit reports it already exists
    await post({ prs: [{ repo: 'kiosk-ui', number: 201 }] });
    await router.generateRunner.whenIdle();
    assert.equal((await (await fetch(`${base}/generate/status`)).json()).data['kiosk-ui#201'].state, 'exists');
  } finally {
    server.close();
  }
});
