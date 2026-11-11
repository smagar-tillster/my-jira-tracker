// Which column of the Due-date board a ticket lands in. Plain functions with no imports so they can be tested with node directly.
//   Overdue    before today (tickets that are done are left out: they are not late)
//   This week  today through the coming Sunday
//   Next week  the following Monday through Sunday
//   Later      after that

export type BoardColumnId = 'overdue' | 'thisWeek' | 'nextWeek' | 'later';

export const BOARD_COLUMNS: { id: BoardColumnId; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'nextWeek', label: 'Next week' },
  { id: 'later', label: 'Later' },
];

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The Sunday that ends the week `today` is in (today itself when it is a Sunday), at midnight. */
export const weekEnd = (today: Date): Date => addDays(startOfDay(today), (7 - startOfDay(today).getDay()) % 7);

export const columnFor = (date: Date, today: Date): BoardColumnId => {
  const t = startOfDay(today);
  const d = startOfDay(date);
  if (d < t) return 'overdue';
  const end = weekEnd(t);
  if (d <= end) return 'thisWeek';
  if (d <= addDays(end, 7)) return 'nextWeek';
  return 'later';
};

export interface BoardResult<T> {
  columns: { id: BoardColumnId; label: string; items: T[] }[];
  /** Tickets with no date of the chosen kind. */
  noDate: number;
  /** Done tickets dated before today: they are not late and would only crowd the Overdue column. */
  doneBeforeToday: number;
}

/** Sorts tickets into the four columns, each ordered by date and then by `tieBreak` (a key, for example). */
export const buildBoard = <T>(
  items: readonly T[], today: Date, dateOf: (t: T) => Date | null, isDone: (t: T) => boolean, tieBreak: (t: T) => string,
): BoardResult<T> => {
  const cols = new Map<BoardColumnId, T[]>(BOARD_COLUMNS.map(c => [c.id, []]));
  let noDate = 0; let doneBeforeToday = 0;
  for (const it of items) {
    const d = dateOf(it);
    if (!d) { noDate++; continue; }
    const col = columnFor(d, today);
    if (col === 'overdue' && isDone(it)) { doneBeforeToday++; continue; }
    cols.get(col)!.push(it);
  }
  for (const list of cols.values()) {
    list.sort((a, b) => (dateOf(a)!.getTime() - dateOf(b)!.getTime()) || tieBreak(a).localeCompare(tieBreak(b), 'en', { numeric: true }));
  }
  return { columns: BOARD_COLUMNS.map(c => ({ ...c, items: cols.get(c.id)! })), noDate, doneBeforeToday };
};

export type ChipTone = 'overdue' | 'done' | 'blocked' | 'aligned';

/** The color of a card's date chip: red when late, otherwise the same buckets as the status pills in the list. */
export const chipTone = (date: Date, today: Date, bucket: 'blocked' | 'aligned' | 'done'): ChipTone =>
  bucket === 'done' ? 'done' : startOfDay(date) < startOfDay(today) ? 'overdue' : bucket;
