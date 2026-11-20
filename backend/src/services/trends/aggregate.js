// Counting tickets by month and type. Pure functions with no I/O, so they can be tested directly.
// A ticket row is { key, type, created, resolved, firstSprintStart } with ISO date strings (any may be missing).

/** The "YYYY-MM" month of a timestamp in the machine's local time, or null. */
export const monthOf = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * What a ticket is counted by:
 *   sprint    the month its first sprint started (when it entered sprint planning); a ticket whose sprints have not started has none yet
 *   created   the month it was created
 *   resolved  the month it was resolved (an unresolved ticket has none)
 */
export const BASES = ['sprint', 'created', 'resolved'];
const dateFor = (row, basis) => (basis === 'created' ? row.created : basis === 'resolved' ? row.resolved : row.firstSprintStart);

/** The number of months a range choice covers. 'ytd' is the current year so far: January up to the current month. */
export const resolveMonths = (choice, now = new Date()) => (choice === 'ytd' ? Number(monthOf(now.toISOString()).slice(5)) : Number(choice));

/** Every month from `from` to `to` inclusive, as "YYYY-MM". */
export const monthRange = (from, to) => {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
};

export const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export const GROUPS = ['all', 'type', 'client', 'component', 'assignee'];
const ALL = 'All tickets';
const NO_CLIENT = 'No client';
const NO_ASSIGNEE = 'Unassigned';
export const NO_COMPONENT = 'No component';

/** The series a ticket belongs to for a grouping. A ticket with several clients counts under each of them. */
const valuesFor = (row, group) => {
  if (group === 'all') return [ALL];
  if (group === 'client') return row.clients?.length ? row.clients : [NO_CLIENT];
  if (group === 'component') return row.components?.length ? row.components : [NO_COMPONENT];
  if (group === 'assignee') return [row.assignee || NO_ASSIGNEE];
  return [row.type || 'Unknown'];
};

const rank = (rows, group) => {
  const totals = new Map();
  for (const r of rows) for (const v of valuesFor(r, group)) totals.set(v, (totals.get(v) || 0) + 1);
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, total], i) => ({ name, total, rank: i + 1 }));
};

/**
 * Tickets per month: all together, or split by type, client or assignee.
 * `summary` is for the tiles, over the tickets counted in the months shown: stories, defects, and the client with the most tickets (tickets with no client are not a client).
 *   months    how many months back from the current one (3 or 6)
 *   filters   { type, client, assignee, component, feTeam }: type, client and assignee are each a list of values (or one value); a ticket must match one value
 *             of every list given (OR inside a filter, AND between them). feTeam keeps tickets assigned to a member of `feMembers`
 * Months after the current one are not shown (sprints that have not started); their tickets are counted in `future`.
 * `series` are the ones with tickets in the months shown, ranked by those counts (so the top seven in view get the colors and the tail folds into
 * Other; ranking over all history would paint almost every assignee gray). A change of filter, basis or range can therefore change colors;
 * hiding series in the legend does not. `options` lists every value over all tickets for the filter menus.
 */
/** The rows that match the filters: OR inside a filter, AND between them (see aggregate). */
export const filterRows = (rows, filters = {}, feMembers = new Set()) => {
  const f = filters || {};
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => typeof x === 'string' && x);
  const [types, clients, assignees, components] = [list(f.type), list(f.client), list(f.assignee), list(f.component)];
  return rows.filter((r) => (!types.length || types.includes(r.type))
    && (!clients.length || valuesFor(r, 'client').some((c) => clients.includes(c)))
    && (!components.length || valuesFor(r, 'component').some((c) => components.includes(c)))
    && (!assignees.length || assignees.includes(r.assignee || NO_ASSIGNEE))
    && (!f.feTeam || (!!r.assignee && feMembers.has(r.assignee))));
};

/**
 * The tickets behind the chart: the ones counted in the months shown, after the filters, newest first. Same month rules as `aggregate`
 * (a ticket with no date, one older than the range, or one in a future month is not in view).
 */
export const ticketsInView = ({ rows, basis = 'resolved', months = 6, filters = {}, feMembers = new Set(), now = new Date() }) => {
  const current = monthOf(now.toISOString());
  const wanted = new Set(monthRange(addMonths(current, -(Number(months) - 1)), current));
  return filterRows(rows, filters, feMembers)
    .map((r) => ({ r, date: dateFor(r, basis) }))
    .filter(({ date }) => wanted.has(monthOf(date)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.r.key).localeCompare(String(b.r.key)))
    .map(({ r, date }) => ({
      key: r.key, summary: r.summary || '', type: r.type || 'Unknown', assignee: r.assignee || '', clients: r.clients || [], components: r.components || [],
      date, month: monthOf(date),
    }));
};

export const aggregate = ({ rows, basis = 'sprint', group = 'all', months = 6, filters = {}, feMembers = new Set(), now = new Date() }) => {
  if (!BASES.includes(basis)) throw new Error(`basis must be one of ${BASES.join(', ')}`);
  if (!GROUPS.includes(group)) throw new Error(`group must be one of ${GROUPS.join(', ')}`);
  const current = monthOf(now.toISOString());
  const options = { types: rank(rows, 'type').map((t) => t.name).sort(), clients: rank(rows, 'client').map((t) => t.name).sort(), components: rank(rows, 'component').map((t) => t.name).sort(), assignees: rank(rows, 'assignee').map((t) => t.name).sort() };

  const kept = filterRows(rows, filters, feMembers);

  const list = monthRange(addMonths(current, -(Number(months) - 1)), current);
  const index = new Map(list.map((m, i) => [m, i]));
  const counts = {};
  const totals = list.map(() => 0);
  let noDate = 0; let future = 0; let before = 0; let inRange = 0;
  const summary = { stories: 0, defects: 0, topClient: null };
  const clientCounts = new Map();
  for (const r of kept) {
    const m = monthOf(dateFor(r, basis));
    if (!m) { noDate++; continue; }
    if (m > current) { future++; continue; }
    const i = index.get(m);
    if (i === undefined) { before++; continue; }
    inRange++; totals[i]++;
    if (r.type === 'Story') summary.stories++;
    else if (r.type === 'Defect') summary.defects++;
    for (const c of r.clients?.length ? r.clients : []) clientCounts.set(c, (clientCounts.get(c) || 0) + 1);
    for (const v of valuesFor(r, group)) (counts[v] ||= list.map(() => 0))[i]++;
  }
  const series = Object.entries(counts).map(([name, c]) => ({ name, total: c.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).map((s, i) => ({ ...s, rank: i + 1 }));
  const topClient = [...clientCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (topClient) summary.topClient = { name: topClient[0], count: topClient[1] };
  return { basis, group, summary, months: list, series, counts, totals, options, tickets: rows.length, matching: kept.length, inRange, before, future, noDate };
};
