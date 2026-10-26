// Run with: npm test   (node's built-in runner; no extra dependency)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Keep drafts out of the real data folder, and set it before anything imports paths.mjs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-test-'));
process.env.NGK_DATA_DIR = tmp;

const { reviewTierOf, tierFromView, partitionByTier, REVIEW_TIER } = await import('../lib/reviewtier.mjs');
const { normalizeDraft } = await import('../lib/reviews.mjs');

const A = {
  complexIfRuntimeLines: 400, complexIfFiles: 15, complexPathPattern: 'payment|cardholder|auth|security|token|oauth|encrypt',
  simpleMaxFiles: 3, simpleMaxLines: 30, simpleNonRuntimeMaxLines: 800,
};
const f = (name, add = 5, del = 1) => ({ name, add, del });

test('tier names map from the triage names', () => {
  assert.deepEqual(REVIEW_TIER, { simple: 'skip', standard: 'light', complex: 'deep' });
});

test('docs, CI, tests, styles and translations only are skipped', () => {
  assert.equal(reviewTierOf({ files: [f('README.md', 40, 2), f('.github/workflows/ci.yml')] }, A).tier, 'skip');
  assert.equal(reviewTierOf({ files: [f('src/app/x.spec.js', 200, 0), f('themes/a/styles/x.scss', 50, 3)] }, A).tier, 'skip');
  assert.equal(reviewTierOf({ files: [f('tenants/a/i18n/en-US.json', 100, 0)] }, A).tier, 'skip');
});

test('a tiny code change is skipped, an ordinary one is light', () => {
  assert.equal(reviewTierOf({ files: [f('src/common/services/a.js', 10, 5)] }, A).tier, 'skip');
  assert.equal(reviewTierOf({ files: [f('src/common/services/a.js', 60, 10), f('src/common/services/b.js', 30, 2)] }, A).tier, 'light');
});

test('a sensitive path, a large runtime change, many files or a referenced PR make it deep', () => {
  assert.equal(reviewTierOf({ files: [f('src/common/services/paymentService.js', 20, 5)] }, A).tier, 'deep');
  assert.equal(reviewTierOf({ files: [f('src/common/services/a.js', 450, 20)] }, A).tier, 'deep');
  assert.equal(reviewTierOf({ files: Array.from({ length: 16 }, (_, i) => f(`src/c/f${i}.js`, 20, 1)) }, A).tier, 'deep');
  assert.equal(reviewTierOf({ files: [f('src/common/services/a.js', 60, 10)], refs: [{ slug: 'Tillster/kiosk-ui', number: 9 }] }, A).tier, 'deep');
});

test('tests and fixtures do not make a PR large', () => {
  const r = reviewTierOf({ files: [f('src/common/services/a.js', 40, 5), f('src/test/a.spec.js', 900, 0)] }, A);
  assert.equal(r.tier, 'light');
});

test('tierFromView reads gh pr view output and finds referenced PRs in the body', () => {
  const view = { title: 'NGK-1 fix', body: 'follows up Tillster/kiosk-ui#77', files: [{ path: 'src/a.js', additions: 20, deletions: 2 }] };
  const t = tierFromView(view, 'Tillster/kiosk-ui', 99, A);
  assert.equal(t.tier, 'deep');
  assert.match(t.why, /references 1 other PR/);
  assert.equal(tierFromView({ title: 't', body: '', files: [{ path: 'docs/a.md', additions: 3, deletions: 0 }] }, 'Tillster/kiosk-ui', 1, A).tier, 'skip');
});

test('partitionByTier separates skipped PRs and keeps the order', () => {
  const items = [{ n: 1, tier: 'light' }, { n: 2, tier: 'skip' }, { n: 3, tier: 'deep' }];
  const { keep, skipped } = partitionByTier(items);
  assert.deepEqual(keep.map((i) => i.n), [1, 3]);
  assert.deepEqual(skipped.map((i) => i.n), [2]);
  assert.equal(partitionByTier(items, []).skipped.length, 0);
});

test('normalizeDraft keeps tier and patterns, and drops an unknown tier', () => {
  const base = { repo: 'kiosk-ui', number: 5, headSha: 'abcdef1234', body: 'Looks fine.' };
  const ok = normalizeDraft({ ...base, tier: 'deep', patterns: ['shared-promotion-config-blast-radius'] });
  assert.equal(ok.draft.tier, 'deep');
  assert.deepEqual(ok.draft.patterns, ['shared-promotion-config-blast-radius']);
  assert.equal(normalizeDraft({ ...base, tier: 'skip' }).draft.tier, null); // skipped PRs never get a draft
  assert.equal(normalizeDraft(base).draft.tier, null);
  assert.deepEqual(normalizeDraft(base).draft.patterns, []);
});

// ---- the queue route, with a fake `gh` and an empty data folder
test('GET /reviews/queue returns worthwhile PRs with a tier and lists skipped ones with the reason', async () => {
  const { default: express } = await import('express');
  const { createReviewsRouter } = await import('../../src/routes/reviews.js');
  const prs = [
    { number: 1, title: 'Fix typo in docs', url: 'u1', author: { login: 'a' }, isDraft: false, headRefOid: 'a1', updatedAt: '2026-10-01', baseRefName: 'main' },
    { number: 2, title: 'NGK-5 change cart price', url: 'u2', author: { login: 'b' }, isDraft: false, headRefOid: 'b2', updatedAt: '2026-10-02', baseRefName: 'main' },
    { number: 3, title: 'WIP', url: 'u3', author: { login: 'c' }, isDraft: true, headRefOid: 'c3', updatedAt: '2026-10-03', baseRefName: 'main' },
    { number: 4, title: 'bump', url: 'u4', author: { login: 'renovate[bot]' }, isDraft: false, headRefOid: 'd4', updatedAt: '2026-10-04', baseRefName: 'main' },
    { number: 5, title: 'Payment tweak', url: 'u5', author: { login: 'e' }, isDraft: false, headRefOid: 'e5', updatedAt: '2026-10-05', baseRefName: 'main' },
  ];
  const files = {
    1: [{ path: 'README.md', additions: 3, deletions: 0 }],
    2: [{ path: 'src/common/services/cart.js', additions: 60, deletions: 10 }, { path: 'src/common/services/line.js', additions: 30, deletions: 2 }],
    5: [{ path: 'src/common/services/paymentService.js', additions: 12, deletions: 1 }],
  };
  const calls = [];
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'pr' && args[1] === 'list') return prs;
    if (args[0] === 'pr' && args[1] === 'view') return { title: 'x', body: '', files: files[Number(args[2])] || [] };
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  const app = express();
  app.use('/api', createReviewsRouter({ gh }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/reviews/queue`;
  try {
    const body = await (await fetch(base)).json();
    assert.deepEqual(body.data.map((i) => [i.number, i.tier]), [[2, 'light'], [5, 'deep']]);
    assert.equal(body.skipped.length, 1);
    assert.equal(body.skipped[0].number, 1);
    assert.match(body.skipped[0].why, /docs|only|tiny/i);
    // a draft and a bot PR never reach the tier lookup
    assert.ok(!calls.some((c) => c.includes('view 3 ') || c.includes('view 4 ')));

    const all = await (await fetch(`${base}?all=1`)).json();
    assert.deepEqual(all.data.map((i) => i.number), [1, 2, 5]);
    assert.equal(all.skipped.length, 0);
  } finally {
    server.close();
  }
});

test('GET /reviews/queue holds back PRs touched in the last 30 minutes, and ?all=1 skips the wait', async () => {
  const { default: express } = await import('express');
  const { createReviewsRouter } = await import('../../src/routes/reviews.js');
  const NOW = Date.parse('2026-10-26T12:00:00Z');
  const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
  const pr = (number, minutesAgo) => ({ number, title: `PR ${number}`, url: `u${number}`, author: { login: 'a' }, isDraft: false, headRefOid: `h${number}`, updatedAt: iso(minutesAgo), baseRefName: 'main' });
  const prs = [pr(10, 5), pr(11, 29), pr(12, 31), pr(13, 600)];
  const viewed = [];
  const gh = async (args) => {
    if (args[1] === 'list') return prs;
    viewed.push(Number(args[2]));
    return { title: 'x', body: '', files: [{ path: 'src/common/services/a.js', additions: 60, deletions: 10 }, { path: 'src/common/services/b.js', additions: 30, deletions: 2 }] };
  };
  const app = express();
  app.use('/api', createReviewsRouter({ gh, now: () => NOW }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/reviews/queue`;
  try {
    const body = await (await fetch(base)).json();
    assert.deepEqual(body.data.map((i) => i.number), [13, 12]); // oldest first; 10 and 11 are too fresh
    assert.deepEqual(body.settling.map((i) => i.number).sort(), [10, 11]);
    assert.ok(!viewed.includes(10) && !viewed.includes(11)); // no file lookups spent on PRs that must wait

    const all = await (await fetch(`${base}?all=1`)).json();
    assert.deepEqual(all.data.map((i) => i.number), [13, 12, 11, 10]);
    assert.deepEqual(all.settling, []);
  } finally {
    server.close();
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
