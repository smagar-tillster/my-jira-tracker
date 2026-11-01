// Free-text search over delivery rows (releases and PRs). Plain functions with no imports so they can be tested with node directly.

const MAX_DEPTH = 5;

/** Every string and number inside a value, joined into one lowercase line. Links are left out so "github" or "https" match nothing by themselves. */
export const flattenText = (value: unknown, depth = 0): string => {
  if (value === null || value === undefined || depth > MAX_DEPTH) return '';
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? '' : value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(v => flattenText(v, depth + 1)).join(' ');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(v => flattenText(v, depth + 1)).join(' ');
  return '';
};

/** Lowercase words of a query; blank gives none. */
export const queryTerms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/** True when every word of the query appears somewhere in the row (any field, any case). A blank query matches everything. */
export const matchesQuery = (row: unknown, query: string): boolean => {
  const terms = queryTerms(query);
  if (!terms.length) return true;
  const text = flattenText(row).toLowerCase();
  return terms.every(t => text.includes(t));
};

/** The rows that match, keeping their order. Builds each row's text once. */
export const filterRows = <T>(rows: readonly T[], query: string): T[] => {
  const terms = queryTerms(query);
  if (!terms.length) return rows as T[];
  return rows.filter(r => { const text = flattenText(r).toLowerCase(); return terms.every(t => text.includes(t)); });
};
