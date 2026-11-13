// The logic behind the Trends charts (frontend/src/utils/trendsChart.ts): colors by type rank, the axis, labels, and how a column is stacked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../../../frontend/src/utils/trendsChart.ts');
const types = (n) => Array.from({ length: n }, (_, i) => ({ name: `T${i + 1}`, total: 100 - i, rank: i + 1 }));

test('the first seven types get the seven palette colors in order, and the rest fold into one gray Other', () => {
  const s = C.buildSeries(types(10));
  assert.equal(s.length, 8);
  assert.deepEqual(s.slice(0, 7).map((x) => x.color), C.SERIES_COLORS);
  assert.deepEqual(s.slice(0, 7).map((x) => x.id), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
  assert.equal(s[7].isOther, true); assert.equal(s[7].color, C.OTHER_COLOR);
  assert.deepEqual(s[7].types, ['T8', 'T9', 'T10']);
  assert.equal(s[7].label, 'Other (3 types)');
  assert.equal(C.buildSeries(types(8))[7].label, 'T8');            // a lone leftover keeps its own name
  assert.equal(C.buildSeries(types(5)).length, 5);                  // no Other when nothing is left over
  assert.deepEqual(C.buildSeries([]), []);
});

test('a type keeps its color whatever else is shown: color follows rank, not position in a filtered list', () => {
  const all = C.buildSeries(types(9));
  const shownAgain = C.buildSeries(types(9));
  assert.deepEqual(all.map((s) => s.color), shownAgain.map((s) => s.color));
  assert.equal(all.find((s) => s.id === 'T3').color, C.SERIES_COLORS[2]);
  assert.ok(C.SERIES_COLORS.length === C.MAX_NAMED && new Set(C.SERIES_COLORS).size === 7);   // seven distinct colors, never cycled
});

test('a series adds up the counts of its types per month', () => {
  const s = C.buildSeries(types(9));
  const counts = { T8: [1, 0, 2], T9: [0, 4, 1], T1: [5, 5, 5] };
  assert.deepEqual(C.seriesCounts(s[7], counts, 3), [1, 4, 3]);
  assert.deepEqual(C.seriesCounts(s[0], counts, 3), [5, 5, 5]);
  assert.deepEqual(C.seriesCounts(s[1], counts, 3), [0, 0, 0]);    // a type with no entry counts zero
});

test('the axis tops out at a round whole number with four to five gridlines', () => {
  const a = (m) => { const x = C.niceAxis(m); return [x.max, x.step, x.ticks.length]; };
  assert.deepEqual(a(7), [8, 2, 5]);
  assert.deepEqual(a(23), [25, 5, 6]);
  assert.deepEqual(a(140), [150, 50, 4]);
  assert.deepEqual(a(48), [50, 10, 6]);
  for (const m of [1, 2, 3]) assert.deepEqual(a(m), [3, 1, 4], `max ${m}`);       // tiny counts: whole-number steps, padded to 3
  assert.deepEqual(C.niceAxis(0), { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  for (const m of [1, 2, 3, 9, 11, 17, 36, 95, 260, 1234]) {
    const x = C.niceAxis(m);
    assert.ok(x.max >= m, `${m} fits`);
    assert.ok(x.ticks.length >= 4 && x.ticks.length <= 7, `${m}: ${x.ticks}`);
    assert.ok(x.ticks.every((t) => Number.isInteger(t)), `${m}: whole numbers only ${x.ticks}`);
    assert.equal(x.ticks[0], 0); assert.equal(x.ticks.at(-1), x.max);
  }
});

test('month labels, and which ones to print when the columns get narrow', () => {
  assert.deepEqual(C.monthLabel('2026-11'), { short: 'Nov', year: '2026', full: 'Nov 2026' });
  assert.equal(C.monthLabel('2026-01').short, 'Jan');
  const months = ['2025-11', '2025-12', '2026-01', '2026-02'];
  assert.deepEqual(C.labelPlan(months, 60).map((l) => [l.show, l.showYear]), [[true, true], [true, false], [true, true], [true, false]]);
  assert.deepEqual(C.labelPlan(months, 25).map((l) => l.show), [true, false, true, false]);
  assert.deepEqual(C.labelPlan(months, 10).map((l) => l.show), [true, false, false, true]);
});

test('a column is at most 24px thick, centered in its slot, and the slots share the plot width', () => {
  const wide = C.columnLayout(1000, 6, 40, 10);
  assert.equal(wide.plot, 950);
  assert.equal(wide.band, 950 / 6);
  assert.equal(wide.bar, 24);                                         // capped: the rest of the slot is air
  assert.equal(wide.center(0), 40 + wide.band / 2);
  assert.equal(wide.x(0) + wide.bar / 2, wide.center(0));
  assert.ok(Math.abs(wide.center(5) - wide.center(4) - wide.band) < 1e-9);   // evenly spaced
  const narrow = C.columnLayout(300, 24, 40, 10);
  assert.ok(narrow.bar < 24 && narrow.bar >= 2);                      // squeezed but never below 2px
  assert.equal(C.columnLayout(1000, 0, 40, 10).band, 950);            // no months: no division by zero
});

test('segments stack from the baseline up with a 2px gap between touching ones, and the last one is the rounded end', () => {
  const px = (v) => v * 10;                                           // 10px per ticket
  const seg = C.stackSegments([3, 0, 2, 4], 200, px);
  assert.deepEqual(seg.map((s) => [s.index, s.value]), [[0, 3], [2, 2], [3, 4]]);     // the zero is skipped
  assert.equal(seg[0].y, 170); assert.equal(seg[0].h, 30);                             // bottom segment: no gap
  assert.equal(seg[1].y, 150); assert.equal(seg[1].h, 20 - C.GAP);                     // starts 2px above the one below
  assert.equal(seg[2].y, 110); assert.equal(seg[2].h, 40 - C.GAP);
  assert.deepEqual(seg.map((s) => s.top), [false, false, true]);
  assert.equal(seg[1].y + seg[1].h + C.GAP, seg[0].y);                                 // the gap sits exactly between them
  assert.equal(seg[2].y + seg[2].h + C.GAP, seg[1].y);
  assert.deepEqual(C.stackSegments([0, 0], 200, px), []);
  assert.equal(C.stackSegments([5], 200, px)[0].top, true);
});

test('a segment too small to spare the gap keeps its full height, so a single ticket is still visible', () => {
  const seg = C.stackSegments([10, 1], 500, (v) => v * 2);            // the 1 is 2px tall
  assert.equal(seg[1].h, 2);                                          // not 0: the gap is dropped for it
  assert.ok(C.stackSegments([10, 1], 500, (v) => v * 4)[1].h >= 2);
});

test('the rounded top is only on the data end: square at the baseline, corners clamped for a short or narrow bar', () => {
  assert.equal(C.roundedTopPath(10, 20, 24, 50), 'M10,70L10,24Q10,20 14,20L30,20Q34,20 34,24L34,70Z');
  assert.match(C.roundedTopPath(10, 20, 24, 2), /Q10,20 12,20/);      // a 2px segment gets a 2px radius, not 4
  assert.match(C.roundedTopPath(10, 20, 4, 50), /Q10,20 12,20/);      // a 4px wide bar: radius is half the width
  assert.ok(C.roundedTopPath(0, 0, 24, 30).startsWith('M0,30L0,4'));  // the left edge runs straight down to the baseline
});
