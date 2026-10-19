// Data for the My Tracker "Release & PRs" tabs (no HTML). Built by daily.mjs after each run and written to .cache/data/delivery.json.
//   releases  : every release ticket in the ledger window (tenant, date, env, components, tickets, crisp summary)
//   toRelease : what is due today: release tickets dated today plus not-ready sprint tickets whose fix version is today with no release ticket yet
//   prs       : merged PRs from the PR ledger (the app filters to today by default) with dependencies flattened for one-line display
import { componentList, explainRelease, canonComponent } from './releases.mjs';
import { jiraUrl } from './jira.mjs';
import { normTier } from './triage.mjs';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isReadyTicket = (t) => t.statusCategory === 'Done' || t.status === 'Ready for QA'; // repo rule: Ready for QA counts as done

/** "UAT/LAB", "PROD - Pilot Stores", "UAT/PROD" ... -> which of the two filter values it matches */
export const envFlags = (env) => {
  const s = String(env || '');
  const f = [];
  if (/UAT|LAB/i.test(s)) f.push('UAT/LAB');
  if (/PROD/i.test(s)) f.push('PROD');
  return f;
};

const ticketRow = (t) => ({
  key: t.key || null, url: t.key ? jiraUrl(t.key) : null, label: t.label || null, summary: t.summary || '', status: t.status || '', statusCategory: t.statusCategory || '',
  ready: t.key ? isReadyTicket(t) : true, assignee: t.assignee || '', component: t.component || '', version: t.version || '', notes: t.notes || '',
});

export const releaseRow = (r) => {
  const tickets = (r.tickets || []).map(ticketRow);
  const g = { items: r.tickets || [], titleComponents: r.titleComponents, components: r.components, versions: r.versions };
  const comps = componentList(g);
  const notReady = tickets.filter((t) => t.key && !t.ready).length;
  return {
    id: r.key, key: r.key, url: r.url || jiraUrl(r.key), title: r.title, tenant: r.tenant, tenants: r.tenants, date: r.date, env: r.env || '', envFlags: envFlags(r.env),
    status: r.status, statusCategory: r.statusCategory, released: !!r.done, assignee: r.assignee || '', what: r.what,
    summary: `${r.what}. ${explainRelease(g, 2)}`, components: comps, tickets, notes: r.notes || '', notReady, ready: notReady === 0,
  };
};

/** Sprint tickets (not ready, fix version dated today) that no release ticket dated today carries yet: one row per tenant */
const pendingRows = ({ sprintIssues, todayRows, day, isRelease, isTest, compOk }) => {
  const covered = new Set(todayRows.flatMap((r) => r.tickets.map((t) => t.key)));
  const byTenant = new Map();
  for (const t of sprintIssues) {
    if (isRelease(t) || !compOk(t) || isReadyTicket(t) || isTest(t) || covered.has(t.key)) continue;
    const fvs = t.fixVersionsFull.filter((x) => x.date === day);
    if (!fvs.length) continue;
    const tenant = (t.clients[0] || '(no client)');
    if (!byTenant.has(tenant)) byTenant.set(tenant, { fvs: new Set(), tickets: [] });
    const g = byTenant.get(tenant);
    fvs.forEach((x) => g.fvs.add(x.name));
    g.tickets.push(t);
  }
  return [...byTenant.entries()].map(([tenant, g]) => {
    const comps = [...new Map(g.tickets.flatMap((t) => t.components).map((c) => [canonComponent(c), { name: c, version: '' }])).values()];
    return {
      id: `pending:${tenant}`, key: null, url: null, title: [...g.fvs].join(', '), tenant, tenants: [tenant], date: day, env: '', envFlags: [], status: 'No release ticket yet', statusCategory: '', released: false,
      assignee: '', what: [...g.fvs].join(', '), summary: `No release ticket yet for ${[...g.fvs].join(', ')}. ${g.tickets.length} sprint ${g.tickets.length === 1 ? 'ticket is' : 'tickets are'} not ready.`,
      components: comps, tickets: g.tickets.map((t) => ticketRow({ ...t })), notes: '', notReady: g.tickets.length, ready: false, noReleaseTicket: true,
    };
  });
};

const short = (slug) => String(slug).split('/')[1] || slug;
export const prRow = (r) => {
  const dependsOn = [
    ...(r.bumps || []).map((b) => ({ type: 'bump', tone: 'info', text: `${b.name} ${b.from ?? 'new'} → ${b.to ?? 'removed'}` })),
    ...(r.refs || []).map((x) => ({ type: 'pr', tone: /merged/i.test(x.state) ? 'ok' : 'warn', text: `${short(x.slug)}#${x.number} ${String(x.state || '').toLowerCase()}`, url: x.url })),
    ...(r.siblings || []).map((s) => ({ type: 'sibling', tone: 'info', text: `also in ${s.repo}#${s.number}`, url: s.url })),
    ...(r.links || []).filter((l) => /blocked by|depends on/i.test(l.rel)).map((l) => ({ type: 'jira', tone: l.statusCategory === 'Done' ? 'ok' : 'warn', text: `${l.rel} ${l.key} (${l.status})`, url: jiraUrl(l.key) })),
    ...((r.needsOther || []).length ? [{ type: 'release', tone: 'info', text: `release also lists ${[...new Set(r.needsOther.map((c) => c.name))].join(', ')}` }] : []),
  ];
  return {
    id: r.id, repo: r.repo, component: r.component, number: r.number, url: r.url, title: r.title, line1: r.line1, line2: r.line2 || '', author: r.author, mergedAt: r.mergedAt || null,
    day: r.mergedAt ? ymd(new Date(r.mergedAt)) : null, keys: r.keys, tickets: (r.tickets || []).map((t) => ({ ...t, url: jiraUrl(t.key) })), tenants: r.tenants || [],
    risk: r.analysis && r.analysis.ai !== false ? r.analysis.risk : null, analysis: r.analysis || null,
    rulesOnly: r.analysis?.ai === false, tier: normTier(r.tier), tierWhy: r.tierWhy || '', aiRecommended: !r.analysis && normTier(r.tier) === 'complex',
    dependsOn, files: r.files || [], declared: r.declared || [], needsOther: r.needsOther || [],
    // open PRs only
    open: !r.mergedAt, isDraft: !!r.isDraft, createdAt: r.createdAt || null, updatedAt: r.updatedAt || null, reviewDecision: r.reviewDecision || '',
  };
};

export const buildDeliveryData = ({ ledger, prLedger, openRecords = [], sprintIssues, day, window, helpers }) => {
  const releases = Object.values(ledger.releases || {}).map(releaseRow).sort((x, y) => y.date.localeCompare(x.date) || x.tenant.localeCompare(y.tenant) || x.env.localeCompare(y.env));
  const todayRows = releases.filter((r) => r.date === day);
  const toRelease = [...todayRows, ...pendingRows({ sprintIssues, todayRows, day, ...helpers })].sort((x, y) => Number(x.ready) - Number(y.ready) || x.tenant.localeCompare(y.tenant));
  const prs = Object.values(prLedger.prs || {}).map(prRow).sort((x, y) => String(y.mergedAt).localeCompare(String(x.mergedAt)));
  const openPrs = openRecords.map(prRow).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  const pendingAi = prs.filter((p) => p.day === day && p.aiRecommended).length;
  const lastReleasedDay = releases.filter((r) => r.released && r.date <= day).map((r) => r.date).sort().pop() || null;
  const uniq = (a) => [...new Set(a)].filter(Boolean).sort();
  return {
    generatedAt: new Date().toISOString(), day, window, lastReleasedDay, pendingAi,
    tenants: uniq([...releases.flatMap((r) => r.tenants), ...toRelease.flatMap((r) => r.tenants)]).filter((t) => !/^\d|\//.test(t)), // drops title leftovers like "2026.09.17-BK-US" or "BK-ES/BK-PT/..."
    envs: ['UAT/LAB', 'PROD'],
    releases, toRelease, prs, openPrs,
  };
};
