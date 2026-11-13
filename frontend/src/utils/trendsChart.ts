// The logic of the Trends charts, as plain functions with no imports so it can be tested with node directly: which color a ticket type
// gets, how a column is laid out and stacked, and the axis. The look follows the dataviz palette (blue, orange, aqua, yellow, magenta, green,
// violet in that order) validated on the light surface; the tail of the types folds into one gray "Other" instead of generating a color.

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
export const OTHER_COLOR = '#898781';
export const MAX_NAMED = 7;

export interface TypeInfo { name: string; total: number; rank: number }
export interface Series { id: string; label: string; color: string; types: string[]; isOther: boolean }

/**
 * The named series (rank 1 to 7) and one "Other" series for the rest. A type's color comes from its rank over ALL tickets, which the
 * backend fixes, so a type keeps its color when the basis, the range or the visible types change.
 */
export const buildSeries = (types: readonly TypeInfo[]): Series[] => {
  const named: Series[] = types.slice(0, MAX_NAMED).map((t, i) => ({ id: t.name, label: t.name, color: SERIES_COLORS[i], types: [t.name], isOther: false }));
  const rest = types.slice(MAX_NAMED);
  if (!rest.length) return named;
  return [...named, { id: '__other__', label: rest.length === 1 ? rest[0].name : `Other (${rest.length} types)`, color: OTHER_COLOR, types: rest.map((t) => t.name), isOther: true }];
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

// ---------------------------------------------------------------- layout
export const BAR_MAX = 24;       // a bar is never thicker than this, however wide its slot
export const GAP = 2;            // the surface-colored gap between touching segments
export const RADIUS = 4;         // the data end (top) of a column is rounded, the baseline end is square

export const columnLayout = (width: number, count: number, left: number, right: number) => {
  const plot = Math.max(0, width - left - right);
  const band = count ? plot / count : plot;
  const bar = Math.max(2, Math.min(BAR_MAX, Math.floor(band * 0.62)));
  return { plot, band, bar, x: (i: number) => left + i * band + (band - bar) / 2, center: (i: number) => left + i * band + band / 2 };
};

export interface Segment { index: number; value: number; y: number; h: number; top: boolean }

/**
 * Stacks values from the baseline up. `px` converts a value to pixels. Every segment above the first leaves a GAP of surface at its lower
 * edge so touching segments read apart; a segment too small to spare the gap keeps its full height. Zero values are skipped.
 * Returns the segments bottom to top; `top` marks the last one, the data end that gets the rounded corners.
 */
export const stackSegments = (values: readonly number[], baseY: number, px: (v: number) => number): Segment[] => {
  const out: Segment[] = [];
  let cum = 0;
  values.forEach((v, index) => {
    if (!(v > 0)) return;
    const lowEdge = baseY - px(cum);
    const topEdge = baseY - px(cum + v);
    const gap = out.length && lowEdge - topEdge > GAP + 1 ? GAP : 0;
    out.push({ index, value: v, y: topEdge, h: lowEdge - topEdge - gap, top: false });
    cum += v;
  });
  if (out.length) out[out.length - 1].top = true;
  return out;
};

/** The outline of a rectangle whose top corners are rounded and whose bottom corners are square. */
export const roundedTopPath = (x: number, y: number, w: number, h: number, r = RADIUS): string => {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + h}Z`;
};
