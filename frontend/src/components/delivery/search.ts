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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One word of the query against a row's lowercase text. A word that ends in a PR number (#394, kiosk-ui#394) must end there, so #39 does not match #394. */
const hit = (text: string, term: string): boolean =>
  /#\d+$/.test(term) ? new RegExp(`${escapeRe(term)}(?=\\s|$)`).test(text) : text.includes(term);

/** True when every word of the query appears in the row's text (any case). A blank query matches everything. `textOf` picks which fields count (default: all of them). */
export const matchesQuery = (row: unknown, query: string, textOf: (row: never) => string = flattenText): boolean => {
  const terms = queryTerms(query);
  if (!terms.length) return true;
  const text = textOf(row as never).toLowerCase();
  return terms.every(t => hit(text, t));
};

/** The rows that match, keeping their order. Builds each row's text once. */
export const filterRows = <T>(rows: readonly T[], query: string, textOf: (row: T) => string = flattenText): T[] => {
  const terms = queryTerms(query);
  if (!terms.length) return rows as T[];
  return rows.filter(r => { const text = textOf(r).toLowerCase(); return terms.every(t => hit(text, t)); });
};

/** What the PR lists search: the PR column (repo, #number), the ticket(s) and the title shown under "What it builds". Nothing else, so a tenant or file name does not add noise. */
export const prSearchText = (p: { repo: string; number: number; title?: string; line1?: string; keys?: string[]; tickets?: { key: string }[] }): string =>
  [p.repo, `#${p.number}`, `${p.repo}#${p.number}`, `${p.repo} #${p.number}`, ...(p.keys || []), ...(p.tickets || []).map(t => t.key), p.title || '', p.line1 || ''].join(' ');

/**
 * Quick find for the "Open PRs without a review" list. A word that is a number (394 or #394) matches PRs whose number starts with it, so
 * typing 41 shows #41x as you go; any other word must appear in the repo name or the title. Every word must match. Blank keeps the list.
 */
export const quickFindPrs = <T extends { number: number; repo: string; title: string }>(items: readonly T[], query: string): T[] => {
  const terms = queryTerms(query);
  if (!terms.length) return items as T[];
  return items.filter(i => {
    const text = `${i.repo} ${i.title}`.toLowerCase();
    return terms.every(t => /^#?\d+$/.test(t) ? String(i.number).startsWith(t.replace('#', '')) : text.includes(t.replace(/^#/, '')));
  });
};
