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
