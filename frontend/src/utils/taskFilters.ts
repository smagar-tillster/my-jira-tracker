// The Tasks toolbar's rules as plain functions with no imports, so they can be tested with node directly: which quick filters exist and how they are
// grouped in the Additional Filters popover, how many are on, whether anything at all is filtered (what Clear Filters shows for), and the button colors
// (gray when off, blue when on, the same as the selected "All" source button).

export type QuickKey = 'important' | 'myDay' | 'urgent' | 'attention' | 'noDueDate' | 'noSubtasks' | 'feTeam' | 'unassigned';
export type QuickState = Record<QuickKey, boolean>;

export interface QuickFilter { key: QuickKey; icon: string; label: string; title?: string }

/** The quick filters with the icons and labels they have always had. */
export const QUICK_FILTERS: Record<QuickKey, QuickFilter> = {
  important:  { key: 'important',  icon: '⭐', label: 'Imp' },
  myDay:      { key: 'myDay',      icon: '☀️', label: 'My Day' },
  urgent:     { key: 'urgent',     icon: '🚨', label: 'Urgent' },
  attention:  { key: 'attention',  icon: '⚠️', label: 'Attention' },
  noDueDate:  { key: 'noDueDate',  icon: '📅', label: 'No Due Date' },
  noSubtasks: { key: 'noSubtasks', icon: '📋', label: 'No Sub tasks' },
  feTeam:     { key: 'feTeam',     icon: '👥', label: 'FE Team' },
  unassigned: { key: 'unassigned', icon: '🙋', label: 'Unassigned', title: 'Tickets nobody is assigned to' },
};

/** The popover's lines, in order: two buttons to a line. */
export const QUICK_ROWS: QuickKey[][] = [['important', 'myDay'], ['urgent', 'attention'], ['noDueDate', 'noSubtasks'], ['feTeam', 'unassigned']];

export const EMPTY_QUICK: QuickState = { important: false, myDay: false, urgent: false, attention: false, noDueDate: false, noSubtasks: false, feTeam: false, unassigned: false };

/** How many quick filters are on. */
export const quickCount = (state: QuickState): number => (Object.keys(EMPTY_QUICK) as QuickKey[]).filter((k) => state[k]).length;

/** "Additional Filters", or "Additional Filters (3)" when three are on. */
export const additionalLabel = (count: number): string => (count > 0 ? `Additional Filters (${count})` : 'Additional Filters');

/**
 * Whether anything is filtered: a dropdown or status filter chosen (a status filter in `filters` means it differs from the default), text in the
 * search box, or a quick filter on. Clear Filters is shown exactly then, and clears all of it.
 */
export const anyFilterActive = ({ filters, searchTerm, quick }: { filters: Record<string, unknown>; searchTerm: string; quick: QuickState }): boolean =>
  Object.keys(filters).length > 0 || searchTerm.trim().length > 0 || quickCount(quick) > 0;

// ---------------------------------------------------------------- colors
export const BTN = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
const ON = 'bg-blue-600 text-white hover:bg-blue-700';
const OFF = 'bg-gray-200 text-gray-700 hover:bg-gray-300';
/** A toggle or dropdown button: blue when selected, gray when not. */
export const stateClass = (on: boolean): string => (on ? ON : OFF);

// ---------------------------------------------------------------- status buttons
/** The status buttons in a fixed order, with an icon each. Any other category Jira sends comes after these, in name order, without an icon. */
export const STATUS_ORDER = ['In Progress', 'Done', 'To Do'];
export const STATUS_ICONS: Record<string, string> = { 'In Progress': '🔄', 'Done': '✅', 'To Do': '📝' };
export const orderedStatuses = (counts: Record<string, number>): [string, number][] => {
  const known = STATUS_ORDER.filter((c) => c in counts).map((c): [string, number] => [c, counts[c]]);
  const rest = Object.keys(counts).filter((c) => !STATUS_ORDER.includes(c)).sort().map((c): [string, number] => [c, counts[c]]);
  return [...known, ...rest];
};

// ---------------------------------------------------------------- view options (Board and Region)
export type BoardDate = 'dueDate' | 'releaseDate' | 'plannedUatDate';
/** The dates the Board can be built on, in the order they are offered. */
export const BOARD_DATES: { key: BoardDate; label: string }[] = [
  { key: 'dueDate', label: 'Due Date' }, { key: 'releaseDate', label: 'Release Date' }, { key: 'plannedUatDate', label: 'UAT Date' },
];
export const boardDateLabel = (key: BoardDate): string => BOARD_DATES.find((d) => d.key === key)?.label ?? key;

/** What a view button shows after its name: the Board says which date it is built on. */
export const viewSuffix = (mode: 'list' | 'board' | 'region', boardDate: BoardDate): string | undefined => (mode === 'board' ? boardDateLabel(boardDate) : undefined);
/** Board and Region have options (the date; Manage Regions); List does not. */
export const viewHasOptions = (mode: 'list' | 'board' | 'region'): boolean => mode !== 'list';

// ---------------------------------------------------------------- fitting the status buttons on the first line
/** 0 = full size with the label; 1 = smaller type and padding, same text; 2 = smaller still, icon and count only (the label is in the tooltip). */
export type StatusDensity = 0 | 1 | 2;

/** The next smaller step when the buttons did not fit on the line, else the same step. */
export const nextDensity = (current: StatusDensity, wrapped: boolean): StatusDensity => (wrapped && current < 2 ? ((current + 1) as StatusDensity) : current);

/** The text of a status button at a density. A category without an icon always keeps its label. */
export const statusText = (category: string, count: number, density: StatusDensity): string => {
  const icon = STATUS_ICONS[category];
  if (density === 2 && icon) return `${icon} ${count}`;
  return `${icon ? `${icon} ` : ''}${category}: ${count}`;
};

export const statusButtonClass = (on: boolean, density: StatusDensity): string =>
  `${density === 0 ? BTN : 'px-2 py-1 rounded-lg text-xs font-medium transition-colors'} whitespace-nowrap ${stateClass(on)}`;
