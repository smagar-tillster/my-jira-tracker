// Ticket trend report, List view: the tickets behind the chart, with the same month and filter rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-trendlist-'));
process.env.DATA_DIR = tmp;
process.env.NGK_DATA_DIR = tmp;
const { ticketsInView, resolveMonths } = await import('../../src/services/trends/aggregate.js');

const now = new Date('2026-11-20T12:00:00');
const rows = [
  { key: 'T-1', type: 'Story', resolved: '2026-11-10T10:00:00', clients: ['A'], components: ['FE'], assignee: 'Pat', summary: 'one' },
  { key: 'T-2', type: 'Defect', resolved: '2026-11-18T10:00:00', clients: ['B'], components: [], assignee: '', summary: 'two' },
  { key: 'T-3', type: 'Story', resolved: '2026-09-02T10:00:00', clients: [], components: ['FE'], assignee: 'Sam', summary: 'three' },
  { key: 'T-4', type: 'Story', resolved: '2025-01-02T10:00:00', clients: ['A'], components: [], assignee: 'Pat', summary: 'too old' },
  { key: 'T-5', type: 'Story', resolved: null, clients: ['A'], components: [], assignee: 'Pat', summary: 'not done' },
];

test('lists the tickets counted in the months shown, newest first; old and undated ones are left out', () => {
  const list = ticketsInView({ rows, basis: 'resolved', months: 3, now });
  assert.deepEqual(list.map((t) => t.key), ['T-2', 'T-1', 'T-3']);
  assert.equal(list[0].month, '2026-11');
  assert.equal(list[0].assignee, '');
});

test('the range follows the months choice and the filters narrow the list', () => {
  assert.deepEqual(ticketsInView({ rows, basis: 'resolved', months: 1, now }).map((t) => t.key), ['T-2', 'T-1']);
  assert.deepEqual(ticketsInView({ rows, basis: 'resolved', months: 3, filters: { client: ['A'] }, now }).map((t) => t.key), ['T-1']);
  assert.deepEqual(ticketsInView({ rows, basis: 'resolved', months: 3, filters: { type: ['Defect'] }, now }).map((t) => t.key), ['T-2']);
});

test("'ytd' is January up to the current month; 3 and 6 are themselves", () => {
  assert.equal(resolveMonths('ytd', now), 11);
  assert.equal(resolveMonths('ytd', new Date('2026-01-05T12:00:00')), 1);
  assert.equal(resolveMonths(6, now), 6);
  assert.equal(resolveMonths('3', now), 3);
  assert.deepEqual(ticketsInView({ rows, basis: 'resolved', months: resolveMonths('ytd', now), now }).map((t) => t.key), ['T-2', 'T-1', 'T-3']);
});
