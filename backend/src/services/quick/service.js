// Quick Analysis as a running service: one run at a time, started by the scheduler during working hours or by the Run now button.
// Also overlays what was marked read since the last run onto the stored report, so the page reflects it at once.
import { getIssuesFromFilter } from '../jiraService.js';
import { getAllFETeamMembers } from '../feteamService.js';
import * as store from './store.js';
import { runQuickAnalysis, quickConfig } from './runner.js';
import { isDue, nextRunAt } from './rules.js';

const sprintFilter = () => process.env.JIRA_FILTER_ID_SPRINT || process.env.JIRA_FILTER_ID || '';
const meFilter = () => process.env.JIRA_FILTER_ID_ME || '';

const realDeps = (now) => ({
  fetchSprint: async () => { if (!sprintFilter()) throw new Error('JIRA_FILTER_ID is not set in .env'); return getIssuesFromFilter(sprintFilter()); },
  fetchMine: async () => { if (!meFilter()) throw new Error('JIRA_FILTER_ID_ME is not set in .env'); return getIssuesFromFilter(meFilter()); },
  feMembers: getAllFETeamMembers(),
  now,
});

export const createQuickService = ({ run = runQuickAnalysis, deps = realDeps, cfgOf = quickConfig, now = () => new Date(), tickMs = 60000 } = {}) => {
  let running = false;
  let timer = null;
  let first = null;

  /** Starts a run unless one is going. Returns true when it started. */
  const runNow = () => {
    if (running) return false;
    running = true;
    let p;
    try { p = Promise.resolve(run({ ...deps(now), cfg: cfgOf(), now })); } catch (e) { p = Promise.reject(e); }   // started at once, so "running" is true from here
    p.catch((e) => console.error('Quick Analysis run failed:', e?.message || e)).finally(() => { running = false; });
    return true;
  };

  /** The stored report with the read marks as they are now. */
  const currentReport = () => {
    const { report } = store.getState();
    if (!report) return null;
    const readAt = new Map(store.newRows().map((r) => [r.key, r.readAt]));
    const newTickets = report.newTickets.map((t) => ({ ...t, read: readAt.has(t.key) ? !!readAt.get(t.key) : t.read }));
    const readNow = new Set(newTickets.filter((t) => t.read).map((t) => t.key));
    const feCandidates = report.feCandidates.filter((c) => !(c.origin === 'new' && readNow.has(c.key)));
    return { ...report, newTickets, feCandidates, counts: { ...report.counts, newUnread: newTickets.filter((t) => !t.read).length, feCandidates: feCandidates.length } };
  };

  const status = () => {
    const s = store.getState();
    const cfg = cfgOf();
    const last = s.lastRunAt ? Date.parse(s.lastRunAt) : null;
    const report = currentReport();
    return {
      running, lastRunAt: s.lastRunAt, lastStatus: running ? 'running' : s.lastStatus, lastError: s.lastError, lastDurationMs: s.lastDurationMs,
      reportReady: !!report, generatedAt: report?.generatedAt || null,
      nextRunAt: cfg.disabled ? null : nextRunAt(now(), last, cfg.schedule).toISOString(), schedule: cfg.schedule, disabled: cfg.disabled,
      // new tickets found since the page was last opened: this is what the bell counts
      unviewedNew: report ? report.newTickets.filter((t) => !t.read && t.firstSeenAt > (s.viewedAt || '')).length : 0,
      unreadNew: report ? report.counts.newUnread : 0,
    };
  };

  const tick = () => {
    const cfg = cfgOf();
    if (cfg.disabled || running) return;
    const s = store.getState();
    if (isDue(now(), s.lastRunAt ? Date.parse(s.lastRunAt) : null, cfg.schedule)) runNow();
  };

  return {
    runNow, status, currentReport, tick,
    isRunning: () => running,
    markRead: (key, read) => store.setRead(key, read, now().toISOString()),
    markViewed: () => store.markViewed(now().toISOString()),
    start: () => { if (timer) return; first = setTimeout(tick, 5000); timer = setInterval(tick, tickMs); first.unref?.(); timer.unref?.(); },
    stop: () => { clearTimeout(first); clearInterval(timer); timer = null; },
  };
};

export const quickService = createQuickService();
