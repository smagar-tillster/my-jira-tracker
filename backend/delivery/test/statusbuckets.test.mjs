// Status buckets used by the Tasks List view (frontend/src/utils/statusBuckets.ts): Blocked / Aligned / Done, pill colors, group order.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { bucketOf, countBuckets, orderGroups, BUCKET_PILL } = await import('../../../frontend/src/utils/statusBuckets.ts');

const s = (status, statusCategory) => ({ status, statusCategory });

test('every status seen in the live data lands in the agreed bucket', () => {
  const blocked = ['Blocked', 'Waiting for Client', 'Waiting for Clarification'];
  const aligned = ['To Do', 'Backlog', 'In Development', 'In Progress', 'Code Review', 'Returned by QA', 'Ready to build', 'Triage'];
  const done = ['Ready for QA', 'In QA', 'Passed QA', 'In UAT', 'Released'];
  for (const n of blocked) assert.equal(bucketOf(s(n, 'In Progress')), 'blocked', n);
  for (const n of aligned) assert.equal(bucketOf(s(n, 'In Progress')), 'aligned', n);
  for (const n of done) assert.equal(bucketOf(s(n, 'In Progress')), 'done', n);
});

test('Ready for QA counts as done even though Jira keeps it In Progress', () => {
  assert.equal(bucketOf(s('Ready for QA', 'In Progress')), 'done');
  assert.equal(bucketOf(s('ready for qa', 'In Progress')), 'done');
});

test('a status the list does not know follows Jira: Done category is done, anything else is aligned', () => {
  assert.equal(bucketOf(s('Shipped to Customers', 'Done')), 'done');
  assert.equal(bucketOf(s('Shipped to Customers', 'In Progress')), 'aligned');
  assert.equal(bucketOf(s('Brand New Status', 'To Do')), 'aligned');
  assert.equal(bucketOf(s('', undefined)), 'aligned');
});

test('"Waiting ..." is blocked whatever follows, but a status that merely contains the word is not', () => {
  assert.equal(bucketOf(s('Waiting for Legal', 'To Do')), 'blocked');
  assert.equal(bucketOf(s('Blocked by QA', 'In Progress')), 'aligned'); // only the exact status Blocked, or Waiting*, is blocked
});

test('every ticket is counted in exactly one bucket', () => {
  const issues = [s('Blocked'), s('Waiting for Client'), s('To Do'), s('Code Review'), s('Backlog'), s('Ready for QA'), s('Released'), s('In UAT')];
  const c = countBuckets(issues);
  assert.deepEqual(c, { blocked: 2, aligned: 3, done: 3 });
  assert.equal(c.blocked + c.aligned + c.done, issues.length);
});

test('pill colors: blocked gray, aligned orange, done green', () => {
  assert.match(BUCKET_PILL.blocked, /gray/);
  assert.match(BUCKET_PILL.aligned, /orange/);
  assert.match(BUCKET_PILL.done, /green/);
});

const groups = () => new Map([
  ['Priya', [s('Blocked'), s('Waiting for Client'), ...Array.from({ length: 7 }, () => s('In Development')), s('Released')]],
  ['Tomas', [s('Blocked'), s('Blocked'), s('Blocked'), s('To Do'), s('To Do'), s('Code Review')]],
  ['Lena', [s('To Do'), s('Backlog'), s('Code Review'), s('Released')]],
  ['Unassigned', []],
  ['Aiko', Array.from({ length: 5 }, () => s('In Development'))],
  ['Marcus', [s('Blocked'), ...Array.from({ length: 5 }, () => s('To Do'))]],
]);

test('assignees are ordered fewest aligned first, ties A to Z, Unassigned last', () => {
  const order = [...orderGroups(groups(), 'aligned-asc').keys()];
  // aligned: Lena 3, Tomas 3, Aiko 5, Marcus 5, Priya 7, Unassigned 0 (still last)
  assert.deepEqual(order, ['Lena', 'Tomas', 'Aiko', 'Marcus', 'Priya', 'Unassigned']);
});

test('most aligned first keeps ties A to Z and Unassigned last', () => {
  assert.deepEqual([...orderGroups(groups(), 'aligned-desc').keys()], ['Priya', 'Aiko', 'Marcus', 'Lena', 'Tomas', 'Unassigned']);
});

test('name order is A to Z with Unassigned last', () => {
  assert.deepEqual([...orderGroups(groups(), 'name').keys()], ['Aiko', 'Lena', 'Marcus', 'Priya', 'Tomas', 'Unassigned']);
});

test('ordering keeps the issues inside each group and does not change the input', () => {
  const g = groups();
  const before = [...g.keys()];
  const out = orderGroups(g, 'aligned-asc');
  assert.deepEqual([...g.keys()], before);
  assert.equal(out.get('Priya'), g.get('Priya'));
});
