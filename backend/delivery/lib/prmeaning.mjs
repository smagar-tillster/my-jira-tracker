// What a PR in the ledger means and where it went. Plain functions with no imports so they can be tested with node directly.
//   meaningOf   one short line on what changed and why, with where it came from (so a guess is never shown as a fact)
//   isDefectFix a PR whose Jira ticket is a Defect, Bug or Incident (decided by the ticket type, not by words in the title)
//   shippedFor  the release tickets that carry the PR's ticket and are dated on or after its merge: tenant, environment, date, released or not

const DEFECT_TYPE = /^(defect|bug|incident)$/i;
export const isDefectType = (type) => DEFECT_TYPE.test(String(type ?? '').trim());
/** True when any of the PR's tickets is a defect type. Tickets without a known type (older ledger entries) do not count. */
export const isDefectFix = (tickets) => (tickets || []).some((t) => isDefectType(t?.type));

const MAX = 240;
const clip = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

/**
 * { text, source } where source says how much to trust the line:
 *   analysis        an AI-assisted reading of the diff and ticket (still to be verified)
 *   pr-description  the first useful line of the PR description, after the title
 *   ticket          the Jira ticket's summary, after the title
 *   title           the PR title alone
 */
export const meaningOf = (r) => {
  const a = r.analysis;
  if (a && a.ai !== false && String(a.summary || '').trim()) return { text: clip(String(a.summary).trim()), source: 'analysis' };
  const title = String(r.line1 || r.title || '').trim();
  const desc = String(r.line2 || '').trim();
  if (desc && norm(desc) !== norm(title)) return { text: clip(`${title} — ${desc}`), source: 'pr-description' };
  const ticket = (r.tickets || []).map((t) => String(t.summary || '').trim()).find((s) => s && norm(s) !== norm(title));
  if (ticket) return { text: clip(`${title} — Ticket: ${ticket}`), source: 'ticket' };
  return { text: clip(title), source: 'title' };
};

const isProd = (env) => /PROD/i.test(String(env || ''));

/**
 * Release tickets that carry the PR's ticket, newest first, one row per release ticket. A release counts only when it is dated on or
 * after the day the PR merged: a release that went out before the merge cannot contain it. `since` is that day (YYYY-MM-DD); without
 * one (an open PR) nothing has shipped. `state` is the furthest it got:
 *   prod (a PROD release is done) > uat (a UAT/LAB release is done) > planned (in a release that is not done yet) > none
 * The link is by ticket, not by commit: when the ticket also has PRs in other repos (`shared`), the release may carry only some of them,
 * so the result is marked `approx`.
 */
export const shippedFor = (ledger, keys, { since = null, shared = false } = {}) => {
  const want = new Set((keys || []).filter(Boolean));
  const rows = [];
  if (want.size && since) {
    for (const rec of Object.values(ledger?.releases || {})) {
      if (!(rec.tickets || []).some((t) => want.has(t.key))) continue;
      if (String(rec.date || '') < since) continue;
      rows.push({ key: rec.key, tenant: rec.tenant || '', env: rec.env || '', date: rec.date || '', released: !!rec.done, status: rec.status || '' });
    }
  }
  rows.sort((x, y) => String(y.date).localeCompare(String(x.date)) || x.key.localeCompare(y.key));
  const state = rows.some((r) => r.released && isProd(r.env)) ? 'prod' : rows.some((r) => r.released) ? 'uat' : rows.length ? 'planned' : 'none';
  return { shipped: rows, shippedState: state, shippedApprox: !!shared && rows.length > 0 };
};
