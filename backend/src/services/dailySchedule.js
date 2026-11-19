import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Runs the Release & PRs report by itself once a day at 8 AM Pacific (config.json "dailyReport": hour, timezone, disabled).
// Pacific time follows daylight saving, so "8 AM PST" stays 8 AM on the clock in California all year.
// The date of the last run is kept in a small file, so a restart never runs the same day twice. A server that was off
// at 8 AM runs the report when it comes back up the same day.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(HERE, '../../delivery/config.json');
const DEFAULTS = { hour: 8, timezone: 'America/Los_Angeles', disabled: false };

export const dailyConfig = (file = CONFIG) => {
  try { return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(file, 'utf8')).dailyReport || {}) }; } catch { return { ...DEFAULTS }; }
};

/** The date (YYYY-MM-DD) and hour (0-23) on the clock in `timezone` at `at`. */
export const clockIn = (at, timezone) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

/** True when today's run is due: it is `hour` or later in `timezone` and no run has been started for today's date. */
export const isDue = (at, lastDay, cfg) => {
  if (cfg.disabled) return false;
  const { day, hour } = clockIn(at, cfg.timezone);
  return hour >= cfg.hour && lastDay !== day;
};

export const createDailySchedule = ({ run, stateFile, now = () => new Date(), tickMs = 60_000, config = dailyConfig }) => {
  let timer = null;
  const lastDay = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastDay || null; } catch { return null; } };
  const remember = (day) => {
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ lastDay: day, at: now().toISOString() })); } catch (e) { console.error('dailySchedule: could not save state:', e.message); }
  };
  const tick = () => {
    const cfg = config();
    if (!isDue(now(), lastDay(), cfg)) return false;
    if (!run()) return false; // another report is running: try again next minute
    remember(clockIn(now(), cfg.timezone).day);
    console.log(`[${now().toISOString()}] dailySchedule: started the Release & PRs report`);
    return true;
  };
  return {
    tick,
    start: () => { if (timer) return; timer = setInterval(tick, tickMs); timer.unref?.(); setTimeout(tick, 10_000).unref?.(); },
    stop: () => { clearInterval(timer); timer = null; },
  };
};
