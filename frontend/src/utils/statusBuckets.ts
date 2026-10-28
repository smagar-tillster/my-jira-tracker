// Where a ticket's status puts it, for the List view's Blocked / Aligned counts, the status pill colors and the group order.
// Plain functions with no imports so they can be tested with node directly.
//
//   blocked  Blocked, and anything "Waiting ..." (Waiting for Client, Waiting for Clarification)
//   done     Ready for QA and everything after it (In QA, Passed QA, In UAT, Released, Done, Closed, ...)
//   aligned  everything else: in progress and not blocked (To Do, Backlog, In Development, Code Review, Returned by QA, ...)
//
// Jira's own status category cannot be used alone: "Ready for QA" is still "In Progress" in Jira but counts as done here.

export type StatusBucket = 'blocked' | 'aligned' | 'done';

export interface HasStatus { status: string; statusCategory?: string | null }

const DONE_NAMES = new Set([
  'ready for qa', 'in qa', 'passed qa', 'in uat', 'ready for uat', 'ready for release', 'ready to release',
  'released', 'deployed', 'done', 'closed', 'resolved',
]);

export const bucketOf = (issue: HasStatus): StatusBucket => {
  const name = String(issue.status ?? '').trim().toLowerCase();
  if (name === 'blocked' || name.startsWith('waiting')) return 'blocked';
  if (DONE_NAMES.has(name) || String(issue.statusCategory ?? '').toLowerCase() === 'done') return 'done';
  return 'aligned';
};

export interface BucketCounts { blocked: number; aligned: number; done: number }

export const countBuckets = (issues: readonly HasStatus[]): BucketCounts => {
  const c: BucketCounts = { blocked: 0, aligned: 0, done: 0 };
  for (const i of issues) c[bucketOf(i)]++;
  return c;
};

/** Pill colors (Tailwind classes) for a status: blocked gray, aligned orange, done green. */
export const BUCKET_PILL: Record<StatusBucket, string> = {
  blocked: 'bg-gray-200 text-gray-700 ring-1 ring-gray-300',
  aligned: 'bg-orange-100 text-orange-800',
  done: 'bg-green-100 text-green-800',
};

/** Hover text for the group counts, so the definitions are one hover away without taking space on screen. */
export const BUCKET_HINT: Record<'blocked' | 'aligned', string> = {
  blocked: 'Blocked: status Blocked or Waiting (for Client, for Clarification)',
  aligned: 'Aligned: in progress and not blocked (To Do, Backlog, In Development, Code Review, Returned by QA). Ready for QA and after is done.',
};

export type GroupOrderMode = 'aligned-asc' | 'aligned-desc' | 'name';

const UNASSIGNED = 'Unassigned';

/**
 * A new Map with the groups in the requested order. Ties are alphabetical and "Unassigned" always comes last, so a group that is
 * not a person never floats to the top. The issues inside each group keep their order.
 */
export const orderGroups = <T extends HasStatus>(groups: Map<string, T[]>, mode: GroupOrderMode): Map<string, T[]> => {
  const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  const aligned = new Map<string, number>();
  for (const [k, items] of groups) aligned.set(k, countBuckets(items).aligned);
  const keys = [...groups.keys()].sort((a, b) => {
    const ua = a === UNASSIGNED ? 1 : 0;
    const ub = b === UNASSIGNED ? 1 : 0;
    if (ua !== ub) return ua - ub;
    if (mode === 'name') return byName(a, b);
    const d = (aligned.get(a) ?? 0) - (aligned.get(b) ?? 0);
    return (mode === 'aligned-asc' ? d : -d) || byName(a, b);
  });
  return new Map(keys.map((k) => [k, groups.get(k) as T[]]));
};
