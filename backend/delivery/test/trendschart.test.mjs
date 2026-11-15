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
  assert.equal(C.buildSeries(types(10), 'clients')[7].label, 'Other (3 clients)');
});

test('a filtered list that skips ranks keeps each series its color; ranks over 7 are gray even when few are shown', () => {
  const some = types(12).filter((t) => [2, 5, 9, 11].includes(t.rank));
  const s = C.buildSeries(some);
  assert.deepEqual(s.map((x) => [x.id, x.color]), [['T2', C.SERIES_COLORS[1]], ['T5', C.SERIES_COLORS[4]], ['__other__', C.OTHER_COLOR]]);
  assert.deepEqual(s[2].types, ['T9', 'T11']);
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

test('points sit in the middle of their month slot, evenly spaced, with the slots sharing the plot width', () => {
  const l = C.plotLayout(1000, 6, 40, 10);
  assert.equal(l.plot, 950);
  assert.equal(l.band, 950 / 6);
  assert.equal(l.x(0), 40 + l.band / 2);
  assert.ok(Math.abs(l.x(5) - l.x(4) - l.band) < 1e-9);
  assert.equal(C.plotLayout(1000, 0, 40, 10).band, 950);              // no months: no division by zero
  assert.equal(C.plotLayout(30, 3, 40, 10).plot, 0);                  // a width smaller than the margins does not go negative
});

test('a line is straight segments through its points (no smoothing), and the dash and marker sets tell lines apart without color', () => {
  assert.equal(C.linePath([10, 20, 30], [100, 50, 75]), 'M10,100L20,50L30,75');
  assert.equal(C.linePath([10.123456], [5]), 'M10.12,5');
  assert.equal(C.linePath([], []), '');
  assert.equal(C.LINE_DASH[0], '');                                   // the first (or only) line is solid
  assert.equal(new Set(C.LINE_DASH.slice(0, 4)).size, 4);             // the first four lines differ in dash
  assert.equal(new Set(C.MARKERS.slice(0, 4)).size, 4);               // and in marker shape
  assert.ok(C.LINE_DASH.length >= C.MAX_NAMED + 0 && C.MARKERS.length >= C.MAX_NAMED);   // one per colored series, Other included
});

test('filter search matches anywhere in a name, ignoring case, and an empty search shows everything', () => {
  const opts = ['BK-US', 'BK-ES', 'PLK-US', 'KFC-MX'];
  assert.deepEqual(C.matchOptions(opts, 'bk'), ['BK-US', 'BK-ES']);
  assert.deepEqual(C.matchOptions(opts, '-us'), ['BK-US', 'PLK-US']);
  assert.deepEqual(C.matchOptions(opts, '  '), opts);
  assert.deepEqual(C.matchOptions(opts, ''), opts);
  assert.deepEqual(C.matchOptions(opts, 'zzz'), []);
  assert.notEqual(C.matchOptions(opts, ''), opts);                    // a copy, so a caller cannot change the options
});

test('the filter button says all, the one value, or how many are selected', () => {
  assert.equal(C.selectionLabel('Client', []), 'Client: all');
  assert.equal(C.selectionLabel('Client', ['BK-US']), 'Client: BK-US');
  assert.equal(C.selectionLabel('Assignee', ['Ann', 'Bob', 'Cy']), 'Assignee: 3 selected');
});

test('the request repeats a filter name for each value, leaves out empty filters, and keeps names with commas or ampersands intact', () => {
  const q = C.trendQuery('resolved', 6, 'client', { client: ['BK-US', 'PLK-US'], assignee: ['Smith, Ann', 'A&B'], type: [], feTeam: true });
  assert.deepEqual(q.getAll('client'), ['BK-US', 'PLK-US']);
  assert.deepEqual(q.getAll('assignee'), ['Smith, Ann', 'A&B']);        // read back unchanged from the encoded string
  assert.deepEqual(new URLSearchParams(q.toString()).getAll('assignee'), ['Smith, Ann', 'A&B']);
  assert.equal(q.has('type'), false);
  assert.equal(q.get('feTeam'), '1'); assert.equal(q.get('months'), '6'); assert.equal(q.get('group'), 'client'); assert.equal(q.get('basis'), 'resolved');
  assert.equal(C.trendQuery('resolved', 3, 'all', {}).has('feTeam'), false);
});

test('the defect analysis request carries the months and the client, assignee and FE team filters, and never the type', () => {
  const q = C.defectQuery(3, { client: ['BK-US'], assignee: ['Smith, Ann'], feTeam: true, type: ['Story'] });
  assert.equal(q.get('months'), '3'); assert.deepEqual(q.getAll('client'), ['BK-US']); assert.deepEqual(q.getAll('assignee'), ['Smith, Ann']);
  assert.equal(q.get('feTeam'), '1'); assert.equal(q.has('type'), false); assert.equal(q.has('basis'), false);
  assert.equal(C.defectQuery(6, {}).toString(), 'months=6');
});

test('trend text: up, down, flat, and not available when the earlier half was too small', () => {
  assert.deepEqual(C.trendText(40), { arrow: '▲', text: '40%', tone: 'up' });
  assert.deepEqual(C.trendText(-18), { arrow: '▼', text: '18%', tone: 'down' });
  assert.deepEqual(C.trendText(0), { arrow: '▬', text: '0%', tone: 'flat' });
  assert.deepEqual(C.trendText(null), { arrow: '', text: 'n/a', tone: 'none' });
  assert.deepEqual(C.monthCounts(['2026-10', '2026-11'], [3]).map((m) => [m.label, m.count]), [['Oct', 3], ['Nov', 0]]);
});

test('the little trend line puts the highest month at the top, zero at the bottom, and the last point where the dot goes', () => {
  const s = C.sparkline([0, 5, 10], 100, 30, 3);
  assert.equal(s.points, '3,27 50,15 97,3');                                // x spread over the width less the pad; y from the bottom pad to the top pad
  assert.deepEqual(s.last, { x: 97, y: 3 }); assert.equal(s.top, 10);
  assert.deepEqual(C.sparkline([4, 4, 4], 100, 30, 3).points.split(' ').map((p) => p.split(',')[1]), ['3', '3', '3']);   // all equal: a flat line at the top, since the scale is 0 to the max
  assert.equal(C.sparkline([], 100, 30).points, ''); assert.equal(C.sparkline([], 100, 30).last, null);
  assert.deepEqual(C.sparkline([7], 100, 30).last, { x: 50, y: 3 });         // one month: centered
  assert.equal(C.sparkline([0, 0], 100, 30, 3).top, 1);                       // all zeros: no division by zero
});

test('component filters travel in both requests', () => {
  assert.deepEqual(C.trendQuery('resolved', 6, 'component', { component: ['FE', 'Web Service (WS)'] }).getAll('component'), ['FE', 'Web Service (WS)']);
  assert.deepEqual(C.defectQuery(6, { component: ['FE'] }).getAll('component'), ['FE']);
  assert.equal(C.defectQuery(6, { component: [] }).has('component'), false);
});

test('the FE fixes toggle selects only FE, or removes FE and keeps other components, and leaves other filters alone', () => {
  const eq = (a, b) => assert.deepEqual(a, b);
  eq(C.toggleFeFixes({}), { component: ['FE'] });
  eq(C.toggleFeFixes({ component: ['Menu'] }), { component: ['FE'] });
  eq(C.toggleFeFixes({ component: ['FE'] }), { component: undefined });
  eq(C.toggleFeFixes({ component: ['FE', 'Menu'] }), { component: ['Menu'] });
  eq(C.toggleFeFixes({ client: ['AA'], feTeam: true }), { client: ['AA'], feTeam: true, component: ['FE'] });
  assert.equal(C.FE_COMPONENT, 'FE');
});
