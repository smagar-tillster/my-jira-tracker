// What a PR in the ledger means and where it shipped (backend/delivery/lib/prmeaning.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDefectType, isDefectFix, meaningOf, shippedFor } from '../lib/prmeaning.mjs';

test('a defect fix is decided by the Jira ticket type, never by the title', () => {
  for (const t of ['Defect', 'defect', 'Bug', 'Incident', ' Bug ']) assert.equal(isDefectType(t), true, t);
  for (const t of ['Story', 'Task', 'Release', 'Sub-task', '', undefined, null]) assert.equal(isDefectType(t), false, String(t));
  assert.equal(isDefectFix([{ key: 'NGK-1', type: 'Story' }, { key: 'NGK-2', type: 'Defect' }]), true);
  assert.equal(isDefectFix([{ key: 'NGK-1', type: 'Story' }]), false);
  assert.equal(isDefectFix([{ key: 'NGK-1' }]), false);            // older ledger entries have no type yet
  assert.equal(isDefectFix(undefined), false);
});

test('meaning prefers the AI-assisted reading, then the PR description, then the ticket, then the title, and says which', () => {
  const base = { line1: 'Use previous caltotal cache', line2: '', tickets: [], analysis: null };
  assert.deepEqual(meaningOf({ ...base, analysis: { ai: true, summary: 'Reuses the cached cart total on round-up.' } }), { text: 'Reuses the cached cart total on round-up.', source: 'analysis' });
  // a rules-only entry is mechanical (file counts), so it does not replace the title-based meaning
  assert.equal(meaningOf({ ...base, analysis: { ai: false, summary: 'Small change (1 file)' } }).source, 'title');
  assert.deepEqual(meaningOf({ ...base, line2: 'Avoids a second price call' }), { text: 'Use previous caltotal cache — Avoids a second price call', source: 'pr-description' });
  assert.deepEqual(meaningOf({ ...base, tickets: [{ key: 'NGK-9', summary: 'Round up update is slow' }] }), { text: 'Use previous caltotal cache — Ticket: Round up update is slow', source: 'ticket' });
  assert.deepEqual(meaningOf(base), { text: 'Use previous caltotal cache', source: 'title' });
});

test('meaning does not repeat the title when the description or ticket only restates it', () => {
  const r = { line1: 'Fix banner on small screens', line2: 'fix banner on small screens!', tickets: [{ key: 'NGK-1', summary: 'Fix Banner on small screens' }] };
  assert.deepEqual(meaningOf(r), { text: 'Fix banner on small screens', source: 'title' });
});

test('meaning stays short', () => {
  const m = meaningOf({ line1: 'x', line2: 'y'.repeat(600), tickets: [] });
  assert.ok(m.text.length <= 240 && m.text.endsWith('…'));
});

const ledger = { releases: {
  'NGK-500': { key: 'NGK-500', tenant: 'BK-US', env: 'UAT/LAB', date: '2026-10-20', done: true, status: 'Released', tickets: [{ key: 'NGK-1' }, { key: 'NGK-2' }] },
  'NGK-501': { key: 'NGK-501', tenant: 'BK-US', env: 'PROD', date: '2026-10-22', done: true, status: 'Released', tickets: [{ key: 'NGK-1' }] },
  'NGK-502': { key: 'NGK-502', tenant: 'KFC-MX', env: 'UAT/LAB', date: '2026-10-28', done: false, status: 'In QA', tickets: [{ key: 'NGK-3' }] },
} };

test('shipped lists every release carrying the ticket, newest first, and reports the furthest state', () => {
  const a = shippedFor(ledger, ['NGK-1']);
  assert.deepEqual(a.shipped.map((r) => r.key), ['NGK-501', 'NGK-500']);
  assert.equal(a.shippedState, 'prod');
  assert.equal(shippedFor(ledger, ['NGK-2']).shippedState, 'uat');
  const c = shippedFor(ledger, ['NGK-3']);
  assert.equal(c.shippedState, 'planned');
  assert.equal(c.shipped[0].released, false);
  assert.deepEqual(shippedFor(ledger, ['NGK-99']), { shipped: [], shippedState: 'none' });
  assert.deepEqual(shippedFor(ledger, []), { shipped: [], shippedState: 'none' });
  assert.deepEqual(shippedFor({}, ['NGK-1']), { shipped: [], shippedState: 'none' });
});

test('a PR with several tickets gets each release once', () => {
  const r = shippedFor(ledger, ['NGK-1', 'NGK-2']);
  assert.equal(r.shipped.filter((x) => x.key === 'NGK-500').length, 1);
  assert.equal(r.shipped.length, 2);
});
