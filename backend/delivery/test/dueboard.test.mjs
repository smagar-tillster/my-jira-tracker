// Which column of the Due-date board a ticket lands in (frontend/src/utils/dueBoard.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { columnFor, weekEnd, buildBoard, chipTone, BOARD_COLUMNS, DEFAULT_TONES } = await import('../../../frontend/src/utils/dueBoard.ts');

const d = (s) => new Date(`${s}T00:00:00`);
const TUE = d('2026-11-10');   // a Tuesday

test('the week runs to Sunday: this week is today through the coming Sunday', () => {
  assert.equal(weekEnd(TUE).getDate(), 15);                       // Sun Nov 15
  assert.equal(weekEnd(d('2026-11-15')).getDate(), 15);           // on a Sunday the week ends today
  assert.equal(weekEnd(d('2026-11-09')).getDate(), 15);           // Monday
});

test('columns: overdue before today, this week to Sunday, next week to the Sunday after, later beyond', () => {
  const col = (s) => columnFor(d(s), TUE);
  assert.equal(col('2026-11-06'), 'overdue');
  assert.equal(col('2026-11-09'), 'overdue');
  assert.equal(col('2026-11-10'), 'thisWeek');   // today is not overdue
  assert.equal(col('2026-11-13'), 'thisWeek');
  assert.equal(col('2026-11-15'), 'thisWeek');   // Sunday
  assert.equal(col('2026-11-16'), 'nextWeek');   // Monday
  assert.equal(col('2026-11-19'), 'nextWeek');
  assert.equal(col('2026-11-22'), 'nextWeek');
  assert.equal(col('2026-11-23'), 'later');
  assert.equal(col('2026-12-24'), 'later');
});

test('the time of day does not move a date between columns', () => {
  assert.equal(columnFor(new Date('2026-11-09T23:59:59'), new Date('2026-11-10T00:00:01')), 'overdue');
  assert.equal(columnFor(new Date('2026-11-10T23:59:59'), new Date('2026-11-10T00:00:01')), 'thisWeek');
});

const items = [
  { k: 'NGK-3', date: d('2026-11-12') },
  { k: 'NGK-2', date: d('2026-11-12') },
  { k: 'NGK-10', date: d('2026-11-12') },
  { k: 'NGK-1', date: d('2026-11-06') },
  { k: 'NGK-9', date: d('2026-11-05') },     // done tickets are not special here: the chip filter decides whether they show
  { k: 'NGK-8', date: d('2026-11-11') },
  { k: 'NGK-7', date: null },
  { k: 'NGK-6', date: d('2026-12-01') },
];
const board = () => buildBoard(items, TUE, (t) => t.date, (t) => t.k);

test('the board has the four columns in order and counts the tickets without a date', () => {
  const b = board();
  assert.deepEqual(b.columns.map((c) => c.id), BOARD_COLUMNS.map((c) => c.id));
  assert.equal(b.noDate, 1);
  assert.deepEqual(b.columns.find((c) => c.id === 'overdue').items.map((t) => t.k), ['NGK-9', 'NGK-1']);   // oldest first
  assert.deepEqual(b.columns.find((c) => c.id === 'later').items.map((t) => t.k), ['NGK-6']);
});

test('inside a column tickets are ordered by date, then by key with numbers compared as numbers', () => {
  const week = board().columns.find((c) => c.id === 'thisWeek').items.map((t) => t.k);
  assert.deepEqual(week, ['NGK-8', 'NGK-2', 'NGK-3', 'NGK-10']);
});

test('the chip filters start with everything on except Done', () => {
  assert.deepEqual([...DEFAULT_TONES].sort(), ['aligned', 'blocked', 'overdue']);
  assert.ok(!DEFAULT_TONES.includes('done'));
});

test('the date chip is red when late, otherwise it follows the status bucket', () => {
  assert.equal(chipTone(d('2026-11-09'), TUE, 'aligned'), 'overdue');
  assert.equal(chipTone(d('2026-11-09'), TUE, 'blocked'), 'overdue');
  assert.equal(chipTone(d('2026-11-09'), TUE, 'done'), 'done');       // done is never late
  assert.equal(chipTone(d('2026-11-10'), TUE, 'aligned'), 'aligned');  // due today is not late yet
  assert.equal(chipTone(d('2026-11-18'), TUE, 'blocked'), 'blocked');
});
