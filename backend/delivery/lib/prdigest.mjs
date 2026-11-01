// "What is happening in the stack": a digest of merged and open PRs for a date range, built by rules from the delivery data.
// Plain functions with no imports so they can be tested with node directly. No model is involved; an optional written summary
// is a separate, on-demand step (see the digest route) that only restates these facts.

const NO_TENANT = '(no tenant)';
export const STALE_DAYS = 14;
const DAY = 86400000;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (day, n) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); return ymd(x); };
const count = (items, keyOf) => {
  const m = new Map();
  for (const it of items) for (const k of [].concat(keyOf(it))) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};
const brief = (p) => ({ id: p.id, url: p.url, line1: p.line1, repo: p.repo, number: p.number, tenants: p.tenants || [], day: p.day || null, keys: p.keys || [] });
const ageDays = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The default range: the seven days ending today. */
export const defaultRange = (today) => ({ from: shift(today, -6), to: today });

/**
 * { window, headline, attention[], merged{...}, open{...} }.
 *   merged: PRs merged from..to (by merge day): totals by repo and tenant, defect fixes, how far they got (prod / uat / planned / none)
 *   open:   PRs open now: drafts, waiting for review, older than STALE_DAYS, waiting on something, open defect fixes
 *   attention: the few things worth a look, each with the PR ids behind it; empty when nothing is
 */
export const buildDigest = ({ prs = [], openPrs = [], from, to, now = Date.now() }) => {
  const merged = prs.filter((p) => p.day && p.day >= from && p.day <= to);
  const defect = merged.filter((p) => p.defectFix);
  const state = (s) => merged.filter((p) => (p.shippedState || 'none') === s);
  const notReleased = state('none').sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const defectNotReleased = notReleased.filter((p) => p.defectFix);

  const live = openPrs.filter((p) => !p.isDraft);
  const stale = live.filter((p) => p.createdAt && ageDays(p.createdAt, now) >= STALE_DAYS).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const waiting = live.filter((p) => !p.reviewDecision || p.reviewDecision === 'REVIEW_REQUIRED');
  const blocked = openPrs.filter((p) => (p.dependsOn || []).some((d) => d.tone === 'warn'));
  const openDefect = openPrs.filter((p) => p.defectFix);

  const attention = [];
  const add = (level, text, list) => { if (list.length) attention.push({ level, text, prs: list.map(brief) }); };
  add('warn', `${plural(defectNotReleased.length, 'defect fix', 'defect fixes')} merged but not in any release yet`, defectNotReleased);
  add('info', `${plural(notReleased.length, 'merged PR')} not in a release dated on or after the merge${notReleased.length ? ` (oldest merged ${notReleased[0].day})` : ''}`, notReleased);
  add('warn', `${plural(openDefect.length, 'open PR')} fixing a defect`, openDefect);
  add('warn', `${plural(stale.length, 'open PR')} older than ${STALE_DAYS} days, not a draft`, stale);
  add('info', `${plural(blocked.length, 'open PR')} waiting on another PR or ticket`, blocked);

  const repos = count(merged, (p) => p.repo);
  const tenants = count(merged, (p) => (p.tenants && p.tenants.length ? p.tenants : [NO_TENANT]));
  const headline = merged.length
    ? `${plural(merged.length, 'PR')} merged in ${plural(repos.length, 'repo')} for ${plural(tenants.filter((t) => t.name !== NO_TENANT).length, 'tenant')}; ${plural(defect.length, 'defect fix', 'defect fixes')}; ${state('prod').length} reached PROD, ${state('uat').length} UAT, ${state('planned').length} planned, ${notReleased.length} not in a release yet.`
    : 'No PRs merged in this range.';

  return {
    window: { from, to },
    headline,
    attention,
    merged: {
      total: merged.length, byRepo: repos, byTenant: tenants,
      defectFixes: defect.map((p) => ({ ...brief(p), shippedState: p.shippedState || 'none' })),
      shipped: { prod: state('prod').length, uat: state('uat').length, planned: state('planned').length, none: notReleased.length },
    },
    open: {
      total: openPrs.length, drafts: openPrs.length - live.length, waitingForReview: waiting.length,
      stale: stale.map((p) => ({ ...brief(p), ageDays: ageDays(p.createdAt, now) })), blocked: blocked.length, defectFixes: openDefect.length,
      byRepo: count(openPrs, (p) => p.repo),
    },
  };
};
