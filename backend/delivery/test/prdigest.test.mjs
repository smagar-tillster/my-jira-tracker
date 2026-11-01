// The "what is happening in the stack" digest (backend/delivery/lib/prdigest.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, defaultRange, STALE_DAYS } from '../lib/prdigest.mjs';

const NOW = Date.parse('2026-11-01T12:00:00');
const pr = (o) => ({ id: `${o.repo}#${o.number}`, url: `https://x/${o.number}`, line1: `PR ${o.number}`, tenants: [], keys: [], defectFix: false, shippedState: 'none', ...o });
const merged = [
  pr({ repo: 'kiosk-ui', number: 1, day: '2026-10-28', tenants: ['BK-US'], shippedState: 'prod' }),
  pr({ repo: 'kiosk-ui', number: 2, day: '2026-10-29', tenants: ['BK-US', 'KFC-MX'], defectFix: true, shippedState: 'none' }),
  pr({ repo: 'kiosk-web-service', number: 3, day: '2026-10-30', tenants: [], shippedState: 'uat' }),
  pr({ repo: 'kiosk-web-service', number: 4, day: '2026-10-31', defectFix: true, shippedState: 'planned', tenants: ['KFC-MX'] }),
  pr({ repo: 'kiosk-ui', number: 5, day: '2026-10-01', tenants: ['OLD'], shippedState: 'prod' }),   // outside the range
];
const open = [
  pr({ repo: 'kiosk-ui', number: 10, createdAt: '2026-10-01T10:00:00', isDraft: false, reviewDecision: 'REVIEW_REQUIRED' }),
  pr({ repo: 'kiosk-ui', number: 11, createdAt: '2026-10-30T10:00:00', isDraft: true }),
  pr({ repo: 'kiosk-menu-service', number: 12, createdAt: '2026-10-29T10:00:00', isDraft: false, reviewDecision: 'APPROVED', defectFix: true, dependsOn: [{ tone: 'warn', text: 'needs menu#9' }] }),
];

test('the default range is the seven days ending today', () => {
  assert.deepEqual(defaultRange('2026-11-01'), { from: '2026-10-26', to: '2026-11-01' });
});

test('merged PRs are counted by repo and tenant, only inside the range, a PR for two tenants counting under each', () => {
  const d = buildDigest({ prs: merged, openPrs: [], from: '2026-10-26', to: '2026-11-01', now: NOW });
  assert.equal(d.merged.total, 4);
  assert.deepEqual(d.merged.byRepo.map((r) => [r.name, r.count]), [['kiosk-ui', 2], ['kiosk-web-service', 2]]);
  assert.deepEqual(d.merged.byTenant.map((r) => [r.name, r.count]), [['BK-US', 2], ['KFC-MX', 2], ['(no tenant)', 1]]);
  assert.deepEqual(d.merged.shipped, { prod: 1, uat: 1, planned: 1, none: 1 });
  assert.deepEqual(d.merged.defectFixes.map((p) => p.id), ['kiosk-ui#2', 'kiosk-web-service#4']);
});

test('the headline and attention list come from the numbers, and say nothing when there is nothing', () => {
  const d = buildDigest({ prs: merged, openPrs: open, from: '2026-10-26', to: '2026-11-01', now: NOW });
  assert.match(d.headline, /4 PRs merged in 2 repos for 2 tenants; 2 defect fixes; 1 reached PROD, 1 UAT, 1 planned, 1 not in a release yet/);
  const texts = d.attention.map((a) => a.text);
  assert.ok(texts.some((t) => /1 defect fix merged but not in any release yet/.test(t)));
  assert.ok(texts.some((t) => /1 merged PR not in a release dated on or after the merge \(oldest merged 2026-10-29\)/.test(t)));
  assert.ok(texts.some((t) => /2 open PRs fixing a defect|1 open PR fixing a defect/.test(t)));
  assert.ok(texts.some((t) => new RegExp(`1 open PR older than ${STALE_DAYS} days, not a draft`).test(t)));
  assert.ok(texts.some((t) => /1 open PR waiting on another PR or ticket/.test(t)));
  const empty = buildDigest({ prs: [], openPrs: [], from: '2026-10-26', to: '2026-11-01', now: NOW });
  assert.equal(empty.headline, 'No PRs merged in this range.');
  assert.deepEqual(empty.attention, []);
});

test('open PRs: drafts are not counted as waiting or stale, and stale ones carry their age, oldest first', () => {
  const d = buildDigest({ prs: [], openPrs: open, from: '2026-10-26', to: '2026-11-01', now: NOW });
  assert.equal(d.open.total, 3);
  assert.equal(d.open.drafts, 1);
  assert.equal(d.open.waitingForReview, 1);     // #10 needs review; #12 is approved; #11 is a draft
  assert.deepEqual(d.open.stale.map((p) => [p.id, p.ageDays]), [['kiosk-ui#10', 31]]);
  assert.equal(d.open.blocked, 1);
  assert.equal(d.open.defectFixes, 1);
});

test('every attention item names the PRs behind it', () => {
  const d = buildDigest({ prs: merged, openPrs: open, from: '2026-10-26', to: '2026-11-01', now: NOW });
  for (const a of d.attention) { assert.ok(a.prs.length > 0); assert.ok(a.prs.every((p) => p.id && p.url)); }
});
