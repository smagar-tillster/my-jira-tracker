// Which column of the Due-date board a ticket lands in. Plain functions with no imports so they can be tested with node directly.
//   Overdue    before today (a done ticket dated before today sits here too; its green chip says it is not late)
//   This week  today through the coming Sunday
//   Next week  the following Monday through Sunday
//   Later      after that, and then the tickets with no date of the chosen kind (after the dated ones)

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
  /** How many tickets have no date of the chosen kind; they are the last ones in the Later column. */
  noDate: number;
}

/**
 * Sorts tickets into the four columns, each ordered by date and then by `tieBreak` (a key, for example).
 * A ticket with no date goes to the end of Later, after every dated ticket, ordered by `tieBreak`.
 */
export const buildBoard = <T>(items: readonly T[], today: Date, dateOf: (t: T) => Date | null, tieBreak: (t: T) => string): BoardResult<T> => {
  const cols = new Map<BoardColumnId, T[]>(BOARD_COLUMNS.map(c => [c.id, []]));
  const undated: T[] = [];
  for (const it of items) {
    const d = dateOf(it);
    if (!d) { undated.push(it); continue; }
    cols.get(columnFor(d, today))!.push(it);
  }
  const byKey = (a: T, b: T) => tieBreak(a).localeCompare(tieBreak(b), 'en', { numeric: true });
  for (const list of cols.values()) list.sort((a, b) => (dateOf(a)!.getTime() - dateOf(b)!.getTime()) || byKey(a, b));
  cols.get('later')!.push(...undated.sort(byKey));
  return { columns: BOARD_COLUMNS.map(c => ({ ...c, items: cols.get(c.id)! })), noDate: undated.length };
};

export type ChipTone = 'overdue' | 'done' | 'blocked' | 'aligned';

/** The chip filters switched on when the board opens: everything except Done. */
export const DEFAULT_TONES: ChipTone[] = ['aligned', 'blocked', 'overdue'];

/** The color of a card's date chip: red when late, otherwise the same buckets as the status pills in the list. A ticket with no date is never late. */
export const chipTone = (date: Date | null, today: Date, bucket: 'blocked' | 'aligned' | 'done'): ChipTone =>
  bucket === 'done' || !date ? bucket : startOfDay(date) < startOfDay(today) ? 'overdue' : bucket; // no date cannot be late
