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

const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/**
 * Tickets per month and type.
 *   months  how many months back from the current one (6, 12, 24) or 'all' (from the first month with a ticket)
 * Months after the current one are not shown (they are sprints that have not started); their tickets are counted in `future`.
 * Types are ranked once over ALL tickets, whatever the basis or range, so a type keeps its rank (and its color) when the view changes.
 */
export const aggregate = ({ rows, basis = 'sprint', months = 12, now = new Date() }) => {
  if (!BASES.includes(basis)) throw new Error(`basis must be one of ${BASES.join(', ')}`);
  const current = monthOf(now.toISOString());
  const typeTotals = new Map();
  for (const r of rows) typeTotals.set(r.type, (typeTotals.get(r.type) || 0) + 1);
  const types = [...typeTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, total], i) => ({ name, total, rank: i + 1 }));

  const dated = []; let noDate = 0; let future = 0;
  for (const r of rows) {
    const m = monthOf(dateFor(r, basis));
    if (!m) { noDate++; continue; }
    if (m > current) { future++; continue; }
    dated.push({ type: r.type, month: m });
  }
  const first = dated.reduce((min, d) => (d.month < min ? d.month : min), current);
  const from = months === 'all' ? first : addMonths(current, -(Number(months) - 1));
  const list = monthRange(from, current);
  const index = new Map(list.map((m, i) => [m, i]));

  const counts = Object.fromEntries(types.map((t) => [t.name, list.map(() => 0)]));
  let before = 0;
  for (const d of dated) {
    const i = index.get(d.month);
    if (i === undefined) { before++; continue; }
    counts[d.type][i]++;
  }
  return {
    basis, months: list, types, counts,
    totals: list.map((_, i) => types.reduce((n, t) => n + counts[t.name][i], 0)),
    tickets: rows.length, inRange: dated.length - before, before, future, noDate,
  };
};
