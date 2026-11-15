// The logic of the Trends charts, as plain functions with no imports so it can be tested with node directly: which color a ticket type
// gets, how a column is laid out and stacked, and the axis. The look follows the dataviz palette (blue, orange, aqua, yellow, magenta, green,
// violet in that order) validated on the light surface; the tail of the types folds into one gray "Other" instead of generating a color.

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
export const OTHER_COLOR = '#898781';
export const MAX_NAMED = 7;

export interface TypeInfo { name: string; total: number; rank: number }
export interface Series { id: string; label: string; color: string; types: string[]; isOther: boolean }

/**
 * The named series (rank 1 to 7) and one "Other" series for the rest. A series' color comes from its rank by tickets in view, which the
 * backend fixes, so hiding series in the legend does not repaint the rest. `noun` words the Other label.
 */
export const buildSeries = (types: readonly TypeInfo[], noun = 'types'): Series[] => {
  const named: Series[] = types.filter((t) => t.rank <= MAX_NAMED).map((t) => ({ id: t.name, label: t.name, color: SERIES_COLORS[t.rank - 1], types: [t.name], isOther: false }));
  const rest = types.filter((t) => t.rank > MAX_NAMED);
  if (!rest.length) return named;
  return [...named, { id: '__other__', label: rest.length === 1 ? rest[0].name : `Other (${rest.length} ${noun})`, color: OTHER_COLOR, types: rest.map((t) => t.name), isOther: true }];
};

/** A series' count per month: its types added together. */
export const seriesCounts = (series: Series, counts: Record<string, number[]>, months: number): number[] =>
  Array.from({ length: months }, (_, i) => series.types.reduce((n, t) => n + (counts[t]?.[i] ?? 0), 0));

// ---------------------------------------------------------------- axis
/**
 * A round maximum and a step so there are about four to five gridlines: 7 -> 8 by 2, 23 -> 25 by 5, 140 -> 150 by 50.
 * Ticket counts are whole numbers, so the step is never below 1 and a small maximum is padded to 3.
 */
export const niceAxis = (max: number): { max: number; step: number; ticks: number[] } => {
  if (!(max > 0)) return { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] };
  const pow = 10 ** Math.floor(Math.log10(max / 4));
  let step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s * 5 >= max) as number;
  let top = Math.ceil(max / step) * step;
  if (step < 1) { step = 1; top = Math.max(Math.ceil(max), 3); }
  return { max: top, step, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
};

const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11" -> { short: 'Nov', year: '2026', full: 'Nov 2026' } */
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-');
  return { short: NAMES[Number(m) - 1] || month, year: y, full: `${NAMES[Number(m) - 1] || month} ${y}` };
};

/** Which x labels to print: every one when they fit, every second or third when they do not. The year goes under the first and under each January. */
export const labelPlan = (months: readonly string[], bandWidth: number) => {
  const every = bandWidth >= 38 ? 1 : bandWidth >= 20 ? 2 : 3;
  return months.map((m, i) => ({ month: m, show: i % every === 0, showYear: i === 0 || m.endsWith('-01') }));
};

// ---------------------------------------------------------------- lines
/** Dash pattern and marker shape per series position, so a line is told apart without its color (the first, or only, line is solid). */
export const LINE_DASH: readonly string[] = ['', '6 3', '2 2', '8 3 2 3', '', '6 3', ''];
export const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'circle', 'square', 'triangle'] as const;
export const LAST_SEGMENT_DASH = '4 4';      // the month in progress is drawn dashed

/** The x of each month: the middle of its slot, so the first and last points keep a margin from the axes. */
export const plotLayout = (width: number, count: number, left: number, right: number) => {
  const plot = Math.max(0, width - left - right);
  const band = count ? plot / count : plot;
  return { plot, band, x: (i: number) => left + i * band + band / 2 };
};

/** An SVG path through the points (straight segments, no smoothing: a smoothed line invents values between months). */
export const linePath = (xs: readonly number[], ys: readonly number[]): string => xs.map((x, i) => `${i ? 'L' : 'M'}${round(x)},${round(ys[i])}`).join('');
const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- filters
/** Case-insensitive "contains" over the options; an empty search keeps all of them. */
export const matchOptions = (options: readonly string[], search: string): string[] => {
  const q = search.trim().toLowerCase();
  return q ? options.filter((o) => o.toLowerCase().includes(q)) : [...options];
};

/** What a multi-select button says: "Client: all", "Client: BK-US", or "Client: 3 selected". */
export const selectionLabel = (label: string, value: readonly string[]): string =>
  `${label}: ${value.length === 0 ? 'all' : value.length === 1 ? value[0] : `${value.length} selected`}`;

/** The query for the trend: a filter with several values repeats its name (client=A&client=B), which is how the backend reads a list. */
export const trendQuery = (basis: string, months: number, group: string, filters: { type?: readonly string[]; client?: readonly string[]; assignee?: readonly string[]; component?: readonly string[]; feTeam?: boolean }): URLSearchParams => {
  const p = new URLSearchParams({ basis, months: String(months), group });
  for (const k of ['type', 'client', 'assignee', 'component'] as const) for (const v of filters[k] ?? []) p.append(k, v);
  if (filters.feTeam) p.set('feTeam', '1');
  return p;
};

/** The defect analysis uses the page's months and its client, assignee, component and FE team filters; the Type filter does not apply to it. */
export const defectQuery = (months: number, filters: { client?: readonly string[]; assignee?: readonly string[]; component?: readonly string[]; feTeam?: boolean }): URLSearchParams => {
  const p = new URLSearchParams({ months: String(months) });
  for (const k of ['client', 'assignee', 'component'] as const) for (const v of filters[k] ?? []) p.append(k, v);
  if (filters.feTeam) p.set('feTeam', '1');
  return p;
};

/** "Jun" + 14 style month list for the little per-month row. */
export const monthCounts = (months: readonly string[], counts: readonly number[]) => months.map((m, i) => ({ month: m, label: monthLabel(m).short, count: counts[i] ?? 0 }));

/** The trend text for a category: "up 40%", "down 18%", "flat", or "n/a" when the earlier half had too few defects for a percentage. */
export const trendText = (changePct: number | null): { arrow: string; text: string; tone: 'up' | 'down' | 'flat' | 'none' } =>
  changePct === null ? { arrow: '', text: 'n/a', tone: 'none' }
    : changePct > 0 ? { arrow: '▲', text: `${changePct}%`, tone: 'up' }
    : changePct < 0 ? { arrow: '▼', text: `${-changePct}%`, tone: 'down' }
    : { arrow: '▬', text: '0%', tone: 'flat' };

/**
 * A small trend line: the points inside a width x height box with a pad all round, the lowest value at the bottom (zero is the floor, so a
 * flat run of the same number is a flat line in the middle-ish, not a line at the bottom), and where the last point is for its dot.
 */
export const sparkline = (values: readonly number[], width: number, height: number, pad = 3) => {
  const n = values.length;
  const top = Math.max(1, ...values);
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const y = (v: number) => height - pad - (v / top) * (height - 2 * pad);
  const pts = values.map((v, i) => ({ x: Math.round(x(i) * 10) / 10, y: Math.round(y(v) * 10) / 10 }));
  return { points: pts.map((p) => `${p.x},${p.y}`).join(' '), last: pts[n - 1] ?? null, top };
};

/** The Jira component for work fixed in the front end. */
export const FE_COMPONENT = 'FE';
/** The filters with the FE-fixes toggle flipped: on selects only the FE component; off removes FE and keeps any other component picked. */
export const toggleFeFixes = <F extends { component?: string[] }>(filters: F): F => {
  const have = filters.component ?? [];
  const on = have.includes(FE_COMPONENT);
  const rest = have.filter((c) => c !== FE_COMPONENT);
  return { ...filters, component: on ? (rest.length ? rest : undefined) : [FE_COMPONENT] };
};

/**
 * Where a pattern that was queued for the RAG's ingest stands: queued while an ingest is running (or none has finished since), added once an ingest
 * that finished after it was queued succeeded, failed if that one failed. `since` and the ingest times are ISO strings from the same server clock.
 */
export type IngestPhase = 'queued' | 'added' | 'failed';
export const ingestPhase = (since: string, ingest: { state: string; finishedAt: string | null }): IngestPhase => {
  if (ingest.state === 'running') return 'queued';
  if (ingest.finishedAt && ingest.finishedAt >= since) return ingest.state === 'failed' ? 'failed' : 'added';
  return 'queued';
};
