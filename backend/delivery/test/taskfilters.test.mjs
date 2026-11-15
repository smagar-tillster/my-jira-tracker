// The Tasks toolbar's rules (frontend/src/utils/taskFilters.ts): the quick filters and how the Additional Filters popover lays them out, the count,
// when Clear Filters shows, and the button colors.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../../../frontend/src/utils/taskFilters.ts');

test('there are eight quick filters, each with the icon and label it has always had, laid out two to a line in the agreed order', () => {
  assert.deepEqual(T.QUICK_ROWS, [['important', 'myDay'], ['urgent', 'attention'], ['noDueDate', 'noSubtasks'], ['feTeam', 'unassigned']]);
  assert.deepEqual(T.QUICK_ROWS.flat().map((k) => `${T.QUICK_FILTERS[k].icon} ${T.QUICK_FILTERS[k].label}`),
    ['⭐ Imp', '☀️ My Day', '🚨 Urgent', '⚠️ Attention', '📅 No Due Date', '📋 No Sub tasks', '👥 FE Team', '🙋 Unassigned']);
  assert.deepEqual(Object.keys(T.EMPTY_QUICK).sort(), [...T.QUICK_ROWS.flat()].sort());          // every filter is in a line, none twice
  assert.equal(new Set(T.QUICK_ROWS.flat()).size, 8);
  assert.ok(Object.values(T.EMPTY_QUICK).every((v) => v === false));
  assert.match(T.QUICK_FILTERS.unassigned.title, /nobody is assigned/);
});

test('the count is how many quick filters are on, and the button label shows it only when there is one', () => {
  assert.equal(T.quickCount(T.EMPTY_QUICK), 0);
  assert.equal(T.quickCount({ ...T.EMPTY_QUICK, urgent: true }), 1);
  assert.equal(T.quickCount({ ...T.EMPTY_QUICK, urgent: true, feTeam: true, important: true }), 3);
  assert.equal(T.quickCount(Object.fromEntries(Object.keys(T.EMPTY_QUICK).map((k) => [k, true]))), 8);
  assert.equal(T.additionalLabel(0), 'Additional Filters');
  assert.equal(T.additionalLabel(1), 'Additional Filters (1)');
  assert.equal(T.additionalLabel(8), 'Additional Filters (8)');
});

test('Clear Filters shows when anything is filtered: a dropdown or status choice, search text, or any quick filter; a blank search does not count', () => {
  const none = { filters: {}, searchTerm: '', quick: T.EMPTY_QUICK };
  assert.equal(T.anyFilterActive(none), false);
  assert.equal(T.anyFilterActive({ ...none, searchTerm: 'abc' }), true);
  assert.equal(T.anyFilterActive({ ...none, searchTerm: '   ' }), false);
  assert.equal(T.anyFilterActive({ ...none, filters: { issueType: ['Defect'] } }), true);
  assert.equal(T.anyFilterActive({ ...none, filters: { statusCategory: ['Done'] } }), true);       // a status choice is in filters only when it differs from the default
  for (const k of Object.keys(T.EMPTY_QUICK)) assert.equal(T.anyFilterActive({ ...none, quick: { ...T.EMPTY_QUICK, [k]: true } }), true, k);
});

test('buttons are blue when on and gray when off, the same blue as the selected All button', () => {
  assert.match(T.stateClass(true), /^bg-blue-600 text-white/);
  assert.match(T.stateClass(false), /^bg-gray-200 text-gray-700/);
  assert.notEqual(T.stateClass(true), T.stateClass(false));
  assert.ok(!/bg-(red|orange|yellow|purple|indigo)/.test(T.stateClass(true) + T.stateClass(false)));   // no separate warning colors any more
  assert.ok(T.BTN.includes('rounded-lg') && T.BTN.includes('text-sm'));
});

test('the status buttons come in a fixed order, In Progress, Done, To Do, with an icon each; any other category follows in name order without one', () => {
  assert.deepEqual(T.STATUS_ORDER, ['In Progress', 'Done', 'To Do']);
  assert.deepEqual(T.orderedStatuses({ 'To Do': 115, 'Done': 189, 'In Progress': 198 }), [['In Progress', 198], ['Done', 189], ['To Do', 115]]);   // whatever order the data came in
  assert.deepEqual(T.orderedStatuses({ 'Done': 1 }), [['Done', 1]]);                                                           // a missing one is simply absent
  assert.deepEqual(T.orderedStatuses({ 'Zeta': 1, 'To Do': 2, 'Alpha': 3, 'In Progress': 4 }).map(([c]) => c), ['In Progress', 'To Do', 'Alpha', 'Zeta']);
  assert.deepEqual(T.orderedStatuses({}), []);
  assert.deepEqual(Object.keys(T.STATUS_ICONS).sort(), [...T.STATUS_ORDER].sort());
  assert.ok(Object.values(T.STATUS_ICONS).every((i) => i.length > 0));
});

test('the Board is built on one of three dates, offered in a fixed order, and its button says which; Board and Region have options, List does not', () => {
  assert.deepEqual(T.BOARD_DATES.map((d) => [d.key, d.label]), [['dueDate', 'Due Date'], ['releaseDate', 'Release Date'], ['plannedUatDate', 'UAT Date']]);
  assert.equal(T.boardDateLabel('releaseDate'), 'Release Date');
  assert.equal(T.viewSuffix('board', 'plannedUatDate'), 'UAT Date');
  assert.equal(T.viewSuffix('list', 'dueDate'), undefined);
  assert.equal(T.viewSuffix('region', 'dueDate'), undefined);
  assert.deepEqual(['list', 'board', 'region'].map(T.viewHasOptions), [false, true, true]);
});

test('In Progress and Done show an icon and the count, To Do keeps its words, and the buttons shrink one step at a time only when they did not fit', () => {
  assert.deepEqual([0, 1, 2].map((d) => T.nextDensity(d, false)), [0, 1, 2]);                 // they fit: stay as they are
  assert.deepEqual([0, 1, 2].map((d) => T.nextDensity(d, true)), [1, 2, 2]);                  // they wrapped: one step smaller, and no further than 2
  assert.equal(T.STATUS_ICONS['In Progress'], '⏳');                                          // the pending icon
  assert.equal(T.statusText('In Progress', 198), '⏳ 198');                                    // no words
  assert.equal(T.statusText('Done', 189), '✅ 189');                                           // no words
  assert.equal(T.statusText('To Do', 115), '📝 To Do 115');                                    // words kept
  assert.equal(T.statusText('Blocked', 3), 'Blocked 3');                                        // another category keeps its words, and has no icon
  assert.deepEqual([...T.STATUS_ICON_ONLY].sort(), ['Done', 'In Progress']);
  assert.ok(T.statusButtonClass(true, 0).startsWith(T.BTN) && T.statusButtonClass(true, 0).includes('bg-blue-600'));
  assert.ok(T.statusButtonClass(false, 1).includes('text-xs') && T.statusButtonClass(false, 1).includes('bg-gray-200'));
  assert.ok(T.statusButtonClass(false, 2).includes('text-[11px]') && !T.statusButtonClass(false, 2).includes('text-xs'));
  const px = (d) => /px-(\d(?:\.5)?)/.exec(T.statusButtonClass(true, d))[1];
  assert.ok(Number(px(0)) > Number(px(1)) && Number(px(1)) > Number(px(2)));                    // each step is smaller
});

test('the toolbar lines sit above every table header, so a menu never opens behind one, and below the Jira filter', async () => {
  const fs = await import('node:fs');
  const src = (f) => fs.readFileSync(new URL(`../../../frontend/src/components/${f}`, import.meta.url), 'utf8');
  const z = (text, re) => { const m = re.exec(text); assert.ok(m, `not found: ${re}`); return Number(m[1] || m[2]); };
  const num = '(?:z-\\[(\\d+)\\]|z-(\\d+))';
  const tracker = src('JiraTasksTracker.tsx');
  const line1 = z(tracker, new RegExp(`ref=\\{lineRef\\} className="[^"]*relative ${num}`));
  const line2 = z(tracker, new RegExp(`className="flex flex-wrap gap-1\\.5 items-center relative ${num} min-w-0 col-start-1"`));
  const jira = z(tracker, new RegExp(`className="relative ${num} jira-filter-dropdown`));
  const regionHeader = z(src('views/RegionView.tsx'), new RegExp(`<ListHeader[^>]*className="${num}"`));
  const listHeader = z(src('views/ListView.tsx'), /className = 'z-(\d+)'/);
  assert.ok(line2 > regionHeader && line2 > listHeader, `line 2 (${line2}) must be above the headers (${regionHeader}, ${listHeader})`);
  assert.ok(line1 > line2, `line 1 (${line1}) must be above line 2 (${line2}) so the Group By menu opens in front of the filter row`);
  assert.ok(jira > line1, `the Jira filter (${jira}) must stay above line 1 (${line1})`);
});

test('the toolbar no longer draws the selected-filter pills with an x: the blue buttons and Clear Filters show what is selected', async () => {
  const fs = await import('node:fs');
  const tracker = fs.readFileSync(new URL('../../../frontend/src/components/JiraTasksTracker.tsx', import.meta.url), 'utf8');
  assert.ok(!/removeFilter\(col\)/.test(tracker));                       // the pill's remove button
  assert.ok(!/Active filter chips/.test(tracker));
  assert.ok(tracker.includes('clearEverything') && tracker.includes('Clear Filters'));   // Clear Filters is still there
});

test('in the right column Clear Filters sits below Refresh and Full Screen and above the issue count, in a slot that keeps its height', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../../frontend/src/components/JiraTasksTracker.tsx', import.meta.url), 'utf8');
  const col = src.slice(src.indexOf('Under the Jira Filter'));
  const at = (s) => col.indexOf(s);
  assert.ok(at('aria-label="Refresh"') > -1 && at('aria-label="Refresh"') < at('aria-label="Full Screen"'));
  assert.ok(at('aria-label="Full Screen"') < at('Clear Filters</button>'));                 // Clear Filters is below the buttons...
  assert.ok(at('Clear Filters</button>') < at('/ {mergedIssues.length} issues'));            // ...and above the count
  assert.ok(/data-slot="clear-filters"/.test(col) && /className="h-7 flex items-center" data-slot="clear-filters"/.test(col));   // the slot has a fixed height
  assert.ok(/\{filtersActive && \(\s*<button onClick=\{clearEverything\}/.test(col));        // the link is only inside the slot, and only when something is filtered
});

test('Clear Filters is a small red button with an icon, so it stands out as the reset action', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../../frontend/src/components/JiraTasksTracker.tsx', import.meta.url), 'utf8');
  const m = /<button onClick=\{clearEverything\}[^>]*className="([^"]*)">([^<]*)<\/button>/.exec(src);
  assert.ok(m, 'the Clear Filters button was not found');
  assert.match(m[1], /bg-red-500 text-white hover:bg-red-600/);            // red background, white text
  assert.match(m[1], /rounded-lg/);                                         // a button, not a text link
  assert.equal(m[2], '🧹 Clear Filters');                                    // an icon and the same words
  assert.ok(!/text-blue-600/.test(m[1]));                                   // not the old blue link
});

test('the All, Sprint and Me pills are a little more compact than the other buttons, to leave room on the first line', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../../frontend/src/components/JiraTasksTracker.tsx', import.meta.url), 'utf8');
  const m = /className=\{`(px-[\d.]+ py-[\d.]+ text-\[\d+px\]) transition-colors \$\{\s*sourceFilter === s/.exec(src);
  assert.ok(m, 'the source pills were not found');
  assert.equal(m[1], 'px-2 py-1.5 text-[13px]');
  const px = Number(/px-([\d.]+)/.exec(m[1])[1]);
  assert.ok(px < 3, 'tighter than the other buttons (px-3)');
});
