// Trends as a running service: a background sync of the sprint tickets (one at a time), and the monthly counts built from the local copy.
import * as store from './store.js';
import { runTrendsSync } from './sync.js';
import { aggregate, BASES } from './aggregate.js';

export const MONTH_CHOICES = [6, 12, 24, 'all'];
const REFRESH_EVERY_MS = 2 * 3600000;       // changes are read every 2 hours
const CHECK_EVERY_MS = 10 * 60000;

export const createTrendsService = ({ sync = runTrendsSync, now = () => new Date(), tickMs = CHECK_EVERY_MS } = {}) => {
  let running = false;
  let timer = null;
  let first = null;

  /** Starts a sync unless one is going. `force` is 'auto' (read what changed, or everything when due), or 'full'. Returns true when started. */
  const refresh = (force = 'auto') => {
    if (running) return false;
    running = true;
    let p;
    try { p = Promise.resolve(sync({ force, now })); } catch (e) { p = Promise.reject(e); }
    p.catch((e) => console.error('Trends sync failed:', e?.message || e)).finally(() => { running = false; });
    return true;
  };

  const status = () => {
    const s = store.getSync();
    return {
      running, lastSyncAt: s.lastSyncAt, lastFullAt: s.lastFullAt, lastStatus: running ? 'running' : s.lastStatus, lastError: s.lastError,
      lastDurationMs: s.lastDurationMs, tickets: store.count(), firstLoad: !s.lastSyncAt,
    };
  };

  const sprintTickets = ({ basis = 'sprint', months = 12 } = {}) => aggregate({ rows: store.allRows(), basis, months, now: now() });

  const tick = () => {
    if (running) return;
    const s = store.getSync();
    if (!s.lastSyncAt || now().getTime() - Date.parse(s.lastSyncAt) >= REFRESH_EVERY_MS) refresh('auto');
  };

  return {
    refresh, status, sprintTickets, tick, isRunning: () => running,
    start: () => { if (timer) return; first = setTimeout(tick, 8000); timer = setInterval(tick, tickMs); first.unref?.(); timer.unref?.(); },
    stop: () => { clearTimeout(first); clearInterval(timer); timer = null; },
  };
};

export const trendsService = createTrendsService();
export { BASES };
