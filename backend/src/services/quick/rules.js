// Quick Analysis rules: when it runs, what counts as new, who is on the FE team and how loaded they are, and ticket priority.
// Pure functions with no I/O, so they can be tested directly. The model is only used for the things a rule cannot judge (see ai.js).

// ---------------------------------------------------------------- when it runs
export const DEFAULT_SCHEDULE = { startHour: 7, endHour: 18, intervalMinutes: 15, weekdaysOnly: true };
const MIN = 60 * 1000;

/** Working hours: from startHour:00 up to, but not including, endHour:00 in the machine's local time, Monday to Friday by default. */
export const isWorkingTime = (now, cfg = DEFAULT_SCHEDULE) => {
  const day = now.getDay();
  if (cfg.weekdaysOnly && (day === 0 || day === 6)) return false;
  const h = now.getHours();
  return h >= cfg.startHour && h < cfg.endHour;
};

/** Time to run: inside working hours and at least `intervalMinutes` since the last run started (or never run). */
export const isDue = (now, lastRunAtMs, cfg = DEFAULT_SCHEDULE) =>
  isWorkingTime(now, cfg) && (lastRunAtMs == null || now.getTime() - lastRunAtMs >= cfg.intervalMinutes * MIN);

/** The first moment at or after `from` that is inside working hours. */
const nextWorkingMoment = (from, cfg) => {
  let d = new Date(from.getTime());
  for (let i = 0; i < 9; i++) {                                   // at most a weekend and a night away
    if (isWorkingTime(d, cfg)) return d;
    const sameDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), cfg.startHour, 0, 0, 0);
    if (d < sameDayStart && (!cfg.weekdaysOnly || (d.getDay() !== 0 && d.getDay() !== 6))) { d = sameDayStart; continue; }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, cfg.startHour, 0, 0, 0);
  }
  return d;
};

/** When the next automatic run is expected (a Date), for the "next run" line on the page. */
export const nextRunAt = (now, lastRunAtMs, cfg = DEFAULT_SCHEDULE) => {
  const due = lastRunAtMs == null ? now : new Date(Math.max(now.getTime(), lastRunAtMs + cfg.intervalMinutes * MIN));
  return nextWorkingMoment(due, cfg);
};

// ---------------------------------------------------------------- tickets
// Status buckets, the same rule as frontend/src/utils/statusBuckets.ts (a test keeps the two in step).
const DONE_NAMES = new Set(['ready for qa', 'in qa', 'passed qa', 'in uat', 'ready for uat', 'ready for release', 'ready to release', 'released', 'deployed', 'done', 'closed', 'resolved']);
export const bucketOf = (issue) => {
  const name = String(issue?.status ?? '').trim().toLowerCase();
  if (name === 'blocked' || name.startsWith('waiting')) return 'blocked';
  if (DONE_NAMES.has(name) || String(issue?.statusCategory ?? '').toLowerCase() === 'done') return 'done';
  return 'aligned';
};

/** A component named FE (FE, FE Team, kiosk-FE), not one that merely contains the letters (Feature, Safe). */
export const isFE = (issue) => (issue?.components || []).some((c) => /(^|[^a-z])fe([^a-z]|$)/i.test(String(c)));
export const isUnassigned = (issue) => !issue?.assignee || issue.assignee === 'Unassigned';
export const clientsOf = (issue) => String(issue?.client || '').split(',').map((c) => c.trim()).filter(Boolean);

const dayOf = (iso) => { const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The earlier of the due date and the release date, or null. */
export const dateOf = (issue) => {
  const due = dayOf(issue?.dueDate);
  const rel = issue?.releaseDate && issue.releaseDate !== 'NA' ? dayOf(issue.releaseDate) : null;
  return due && rel ? (due <= rel ? due : rel) : due || rel;
};

// ---------------------------------------------------------------- what is new
/**
 * Tickets in the sprint that were not there at an earlier run. On the very first run nothing is known yet, so everything would look new:
 * instead only tickets created in the last `seedDays` days count, and the rest are taken as already known.
 */
export const findNewKeys = ({ currentIssues, knownKeys, now, seedDays = 2 }) => {
  if (knownKeys.size === 0) {
    const since = now.getTime() - seedDays * 86400000;
    return { baseline: true, newKeys: currentIssues.filter((i) => Date.parse(i.created) >= since).map((i) => i.key) };
  }
  return { baseline: false, newKeys: currentIssues.filter((i) => !knownKeys.has(i.key)).map((i) => i.key) };
};

// ---------------------------------------------------------------- the FE team and who has what
/**
 * One entry per FE team member: how many sprint tickets they hold that are still aligned (in progress, not blocked, not done), how many are
 * blocked, and the clients and components of the aligned ones. Only facts about tickets; nothing about the person.
 */
export const teamWorkload = (sprintIssues, members) => members.slice().sort((a, b) => a.localeCompare(b)).map((name) => {
  const mine = sprintIssues.filter((i) => i.assignee === name);
  const aligned = mine.filter((i) => bucketOf(i) === 'aligned');
  const count = (list) => { const m = {}; for (const x of list) m[x] = (m[x] || 0) + 1; return m; };
  return {
    name,
    aligned: aligned.length,
    blocked: mine.filter((i) => bucketOf(i) === 'blocked').length,
    clients: count(aligned.flatMap(clientsOf)),
    components: count(aligned.flatMap((i) => (i.components || []).filter((c) => !/(^|[^a-z])fe([^a-z]|$)/i.test(c)))),
    tickets: aligned.slice(0, 6).map((i) => ({ key: i.key, summary: i.summary })),
  };
});

/**
 * Who could take a ticket: the FE team member with the lightest aligned load, where already holding tickets for the same client or
 * component counts in their favor (up to 3 tickets' worth), because related work is quicker for someone who already knows it.
 * `exclude` are people who cannot be suggested (the current assignee). Returns { name, why, alternatives } or null.
 */
export const suggestAssignee = (ticket, workloads, { exclude = [] } = {}) => {
  const pool = workloads.filter((w) => !exclude.includes(w.name));
  if (!pool.length) return null;
  const clients = clientsOf(ticket);
  const comps = (ticket.components || []).filter((c) => !/(^|[^a-z])fe([^a-z]|$)/i.test(c));
  const scored = pool.map((w) => {
    const sharedClients = clients.filter((c) => w.clients[c]);
    const sharedComps = comps.filter((c) => w.components[c]);
    const related = sharedClients.reduce((n, c) => n + w.clients[c], 0) + sharedComps.reduce((n, c) => n + w.components[c], 0);
    return { w, sharedClients, sharedComps, score: w.aligned - Math.min(related, 3) };
  }).sort((a, b) => a.score - b.score || a.w.aligned - b.w.aligned || a.w.name.localeCompare(b.w.name));
  const top = scored[0];
  const lightest = Math.min(...pool.map((w) => w.aligned));
  const parts = [`${top.w.aligned} aligned ticket${top.w.aligned === 1 ? '' : 's'}${top.w.aligned === lightest ? ' (the fewest on the team)' : ''}`];
  if (top.w.blocked) parts.push(`${top.w.blocked} blocked`);
  if (top.sharedClients.length) parts.push(`already holds work for ${top.sharedClients.join(', ')}`);
  if (top.sharedComps.length) parts.push(`and the ${top.sharedComps.join(', ')} component`);
  return {
    name: top.w.name,
    why: `${top.w.name}: ${parts.join('; ')}.`,
    alternatives: scored.slice(1, 3).map((s) => ({ name: s.w.name, aligned: s.w.aligned })),
  };
};

// ---------------------------------------------------------------- priority and a fallback grouping
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/**
 * high   the due or release date is tomorrow or earlier (including overdue)
 * medium within the next 3 days, or blocked
 * low    everything else
 */
export const priorityOf = (issue, today = new Date()) => {
  const d = dateOf(issue);
  const t = startOfDay(today);
  if (d && d <= addDays(t, 1)) return 'high';
  if (d && d <= addDays(t, 3)) return 'medium';
  if (bucketOf(issue) === 'blocked') return 'medium';
  return 'low';
};

const highest = (list) => list.reduce((best, p) => (PRIORITY_RANK[p] < PRIORITY_RANK[best] ? p : best), 'low');

/** Rule-based grouping, used when the model is not available: one group per client, with the next step worked out from dates and status. */
export const fallbackGroups = (tickets, today = new Date()) => {
  const by = new Map();
  for (const t of tickets) {
    const name = clientsOf(t)[0] || 'No client';
    if (!by.has(name)) by.set(name, []);
    by.get(name).push(t);
  }
  const groups = [...by.entries()].map(([name, list]) => {
    const pr = list.map((t) => ({ t, p: priorityOf(t, today) }));
    const high = pr.filter((x) => x.p === 'high').map((x) => x.t.key);
    const blocked = list.filter((t) => bucketOf(t) === 'blocked').map((t) => t.key);
    const action = high.length ? `Deal with the ${high.length} due soon or overdue first: ${high.slice(0, 4).join(', ')}.`
      : blocked.length ? `Chase what blocks ${blocked.slice(0, 3).join(', ')}.` : 'Carry on in order of date.';
    return {
      title: name, priority: highest(pr.map((x) => x.p)), why: `${list.length} open ticket${list.length === 1 ? '' : 's'} for ${name}${high.length ? `, ${high.length} due soon or overdue` : ''}${blocked.length ? `, ${blocked.length} blocked` : ''}.`,
      action, keys: list.slice().sort((a, b) => (dateOf(a)?.getTime() ?? Infinity) - (dateOf(b)?.getTime() ?? Infinity) || a.key.localeCompare(b.key, 'en', { numeric: true })).map((t) => t.key),
    };
  });
  return groups.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.keys.length - a.keys.length || a.title.localeCompare(b.title));
};
