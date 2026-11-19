// 8 AM Pacific daily report (backend/src/services/dailySchedule.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { clockIn, isDue, createDailySchedule } = await import('../../src/services/dailySchedule.js');
const cfg = { hour: 8, timezone: 'America/Los_Angeles', disabled: false };

test('clockIn reads the Pacific clock in winter (PST) and summer (PDT)', () => {
  assert.deepEqual(clockIn(new Date('2026-11-19T16:00:00Z'), cfg.timezone), { day: '2026-11-19', hour: 8 }); // PST = UTC-8
  assert.deepEqual(clockIn(new Date('2026-07-19T15:00:00Z'), cfg.timezone), { day: '2026-07-19', hour: 8 }); // PDT = UTC-7
  assert.deepEqual(clockIn(new Date('2026-11-19T07:59:00Z'), cfg.timezone), { day: '2026-11-18', hour: 23 }); // still yesterday in California
});

test('due from 8 AM Pacific, once per Pacific day', () => {
  assert.equal(isDue(new Date('2026-11-19T15:59:00Z'), null, cfg), false); // 7:59 AM
  assert.equal(isDue(new Date('2026-11-19T16:00:00Z'), null, cfg), true); // 8:00 AM
  assert.equal(isDue(new Date('2026-11-19T23:00:00Z'), null, cfg), true); // 3 PM, missed the morning: catch up
  assert.equal(isDue(new Date('2026-11-19T16:00:00Z'), '2026-11-19', cfg), false); // already ran today
  assert.equal(isDue(new Date('2026-11-20T16:00:00Z'), '2026-11-19', cfg), true); // next day
  assert.equal(isDue(new Date('2026-11-19T16:00:00Z'), null, { ...cfg, disabled: true }), false);
});

test('tick runs once, remembers the day across restarts, and retries when a report is already running', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-'));
  const stateFile = path.join(dir, 'state.json');
  let at = new Date('2026-11-19T16:00:00Z');
  let busy = true, runs = 0;
  const make = () => createDailySchedule({ run: () => { if (busy) return false; runs++; return true; }, stateFile, now: () => at, config: () => cfg });
  const s = make();
  assert.equal(s.tick(), false); // another report running: not recorded
  busy = false;
  assert.equal(s.tick(), true);
  assert.equal(s.tick(), false); // same day
  assert.equal(make().tick(), false); // restart, same day
  at = new Date('2026-11-20T16:00:00Z');
  assert.equal(make().tick(), true);
  assert.equal(runs, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
