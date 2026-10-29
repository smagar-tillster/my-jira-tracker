// Weekly defects data report: trend, type of issues, tenants/components, age, and recommendations to fix or reduce them.
// Defects = Jira type "Defect" in NGK (all components). Rules only: the categories and the recommendations are rule-based and
// tunable in config.json ("defects"); the short wording can be polished by AI afterwards and is saved next to the facts.
// Entries are stored per ISO week in <reports root>/defects.
import fs from 'node:fs';
import path from 'node:path';
import { search, mapIssue, SEARCH_FIELDS, jiraUrl, today } from './jira.mjs';
import { REPORTS_ROOT } from './focus.mjs';
import { CONFIG_FILE } from './paths.mjs';
import { weekOf, weekById, addDays, pretty } from './weeks.mjs';

export const DEFECTS_DIR = path.join(REPORTS_ROOT, 'defects');

// Order matters: the first match wins. Each category carries the advice used in the recommendations.
export const DEFAULT_CATEGORIES = [
  { name: 'Payment & payterminal', pattern: 'payment|payterminal|pay terminal|\\bcard\\b|tender|\\bebt\\b|refund|pinpad|k-?net|elavon|everpay|datafono|tipping', advice: 'Add payterminal contract and failure-path tests per processor (cancel, timeout, decline) and a stage certification checklist before release.' },
  { name: 'POS & fiscal integration', pattern: '\\bpos\\b|simphony|micros|brink|\\borb\\b|\\bspi\\b|fiscal|nf525|menu request|sku ?map|order (was )?n.?t sent', advice: 'Run contract tests against a mock POS per POS type and validate menu/skumap payloads in CI before UAT.' },
  { name: 'Receipts & printing', pattern: 'receipt|print|paper|\\bxsl\\b', advice: 'Add per-tenant receipt snapshot tests (fonts, locale, QR) and a receipt check in the tenant UAT checklist.' },
  { name: 'Loyalty, coupons & offers', pattern: 'loyalty|coupon|offer|reward|promo ?code|\\bpls\\b|medallia', advice: 'Keep a sandbox scenario pack for loyalty flows (sign-in, redeem, partial redeem, void, back-flow) and run it in every loyalty UAT.' },
  { name: 'Accessibility (ADA / screen reader)', pattern: '\\bada\\b|screen reader|jaws|accessib|vispero|voice over', advice: 'Add an accessibility pass (JAWS script) to the FE release checklist and lint for aria labels and focus order.' },
  { name: 'Hardware & device', pattern: 'scanner|device|hardware|sunmi|pole light|reader|peripheral|admin panel', advice: 'Maintain a hardware matrix in the lab and add device-service integration tests; improve admin-panel diagnostics.' },
  { name: 'Performance & reliability', pattern: 'slow|memory|performance|crash|freeze|hang|timeout|intermittent|offline|not responding', advice: 'Set timing and memory budgets with soak tests, and alert on regressions.' },
  { name: 'Navigation & flow', pattern: 'back flow|back button|flow|navigat|cancel|restart|stuck|blank screen|loop', advice: 'Add flow tests for back, edit and cancel paths (cart state) to the regression scripts.' },
  { name: 'Menu, pricing & content data', pattern: 'menu|price|pricing|\\bsku\\b|combo|modifier|categor|image|product|\\bitem|promotion|translation|language|allergen|calorie|upsell', advice: 'Automate menu/data validation (missing images, translations, prices, mappings) before UAT and keep a pre-release data checklist per tenant.' },
  { name: 'UI layout & display', pattern: '\\bui\\b|display|overlap|clipped|font|scroll|button|modal|screen|label|truncat|align|animation|slide|progress|tile|banner|logo|theme|colou?r|capitali|text', advice: 'Add visual regression tests per tenant theme and a device-size matrix; do a component-level design review before merge.' },
  { name: 'Config & deployment', pattern: 'config|deploy|environment|setting|\\bflag\\b|enable|disable|whitelist', advice: 'Validate config against a schema, review config diffs, and promote through UAT with automated checks.' },
];
const OTHER = { name: 'Other / unclear', advice: 'Ask reporters for a category when logging so these can be routed; review a sample for new patterns.' };

export const loadCategories = () => {
  let cfg = [];
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).defects?.categories || []; } catch { /* defaults */ }
  return (cfg.length ? cfg : DEFAULT_CATEGORIES).map((c) => ({ ...c, re: new RegExp(c.pattern, 'i') }));
};
export const categorize = (d, cats) => (cats.find((c) => c.re.test(`${d.summary} ${(d.labels || []).join(' ')}`)) || OTHER).name;
export const adviceFor = (name, cats) => (cats.find((c) => c.name === name) || OTHER).advice;

const days = (from, to) => Math.floor((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000);

/** All defects that were created, resolved or are still open within the look-back. */
export const fetchDefects = async ({ weeks = 12, T = today(), type = 'Defect' } = {}) => {
  const n = weeks * 7 + 14;
  const raw = await search(`project = NGK AND issuetype = ${type} AND (created >= -${n}d OR resolutiondate >= -${n}d OR statusCategory != Done) ORDER BY created DESC`, [...SEARCH_FIELDS, 'resolutiondate']);
  const cats = loadCategories();
  return raw.map((r) => {
    const t = mapIssue(r);
    const resolved = r.fields.resolutiondate ? String(r.fields.resolutiondate).slice(0, 10) : (t.statusCategory === 'Done' ? t.statusChanged : null);
    return { key: t.key, summary: t.summary, created: t.created, resolved, open: t.statusCategory !== 'Done', status: t.status, priority: t.priority || '(none)', clients: t.clients, component: t.components[0] || '(none)', assignee: t.assignee || '', labels: t.labels, category: categorize(t, cats), ageDays: days(t.created, T) };
  });
};

const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (m, n) => Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, n);
const inRange = (d, from, to) => d && d >= from && d <= to;

export const buildMetrics = (defects, { id, weeks = 12, T = today() }) => {
  const w = id ? weekById(id) : weekOf(T);
  const asOf = T < w.to ? T : w.to;
  const wk = Array.from({ length: weeks }, (_, i) => weekOf(addDays(w.from, -7 * (weeks - 1 - i))));
  const trend = wk.map((x) => ({
    week: x.id, from: x.from, to: x.to, partial: x.to > asOf,
    created: defects.filter((d) => inRange(d.created, x.from, x.to)).length,
    resolved: defects.filter((d) => inRange(d.resolved, x.from, x.to)).length,
    open: defects.filter((d) => d.created <= x.to && (!d.resolved || d.resolved > x.to)).length,
  }));
  const last4 = trend.slice(-4); const prev4 = trend.slice(-8, -4);
  const sum = (a, k) => a.reduce((n, x) => n + x[k], 0);
  const inWindow = (from, to) => defects.filter((d) => inRange(d.created, from, to));
  const recent = inWindow(last4[0].from, asOf); const before = inWindow(prev4[0].from, prev4[prev4.length - 1].to);
  const openNow = defects.filter((d) => d.open);
  const cats = Object.keys(count(defects, (d) => d.category));
  const byCategory = cats.map((c) => ({ name: c, last4: recent.filter((d) => d.category === c).length, prev4: before.filter((d) => d.category === c).length, open: openNow.filter((d) => d.category === c).length })).sort((x, y) => y.last4 - x.last4 || y.open - x.open);
  const tenantOf = (d) => d.clients[0] || '(no client)';
  const byTenant = top(count(recent, tenantOf), 8).map(([name, n]) => ({ name, last4: n, open: openNow.filter((d) => tenantOf(d) === name).length }));
  const byComponent = top(count(recent, (d) => d.component), 6).map(([name, n]) => ({ name, last4: n, open: openNow.filter((d) => d.component === name).length }));
  const byPriority = Object.entries(count(openNow, (d) => d.priority)).map(([name, n]) => ({ name, open: n })).sort((x, y) => y.open - x.open);
  const buckets = [['0-7d', 0, 7], ['8-30d', 8, 30], ['31-90d', 31, 90], ['90d+', 91, 1e9]];
  const age = buckets.map(([name, lo, hi]) => ({ name, open: openNow.filter((d) => d.ageDays >= lo && d.ageDays <= hi).length }));
  const oldest = [...openNow].sort((x, y) => y.ageDays - x.ageDays).slice(0, 5).map((d) => ({ key: d.key, summary: d.summary, ageDays: d.ageDays, status: d.status, tenant: tenantOf(d) }));
  const newThisWeek = defects.filter((d) => inRange(d.created, w.from, asOf)).map((d) => ({ key: d.key, summary: d.summary, tenant: tenantOf(d), category: d.category, priority: d.priority, status: d.status }));
  const resolvedThisWeek = defects.filter((d) => inRange(d.resolved, w.from, asOf)).length;
  // this week's patterns (category), each with the tenants it hit
  const patterns = Object.entries(count(newThisWeek, (d) => d.category)).map(([name, n]) => {
    const list = newThisWeek.filter((d) => d.category === name);
    return { name, count: n, tenants: top(count(list, (d) => d.tenant), 99).map(([t, c]) => ({ name: t, count: c })), open: openNow.filter((d) => d.category === name).length, keys: list.map((d) => d.key) };
  }).sort((x, y) => y.count - x.count);
  const topTenants = top(count(newThisWeek.filter((d) => d.tenant !== '(no client)'), (d) => d.tenant), 3).map(([name, n]) => ({ name, count: n })); // real tenants only
  const noClientThisWeek = newThisWeek.filter((d) => d.tenant === '(no client)').length;
  const summary = {
    createdThisWeek: newThisWeek.length, resolvedThisWeek, openNow: openNow.length,
    avgCreatedLast4: Math.round((sum(last4, 'created') / 4) * 10) / 10, avgCreatedPrev4: Math.round((sum(prev4, 'created') / 4) * 10) / 10,
    createdLast4: recent.length, resolvedLast4: sum(last4, 'resolved'), createdPrev4: before.length,
    noClient: openNow.filter((d) => !d.clients.length).length,
  };
  return { week: w.id, from: w.from, to: w.to, asOf, summary, patterns, topTenants, noClientThisWeek, trend, byCategory, byTenant, byComponent, byPriority, age, oldest, newThisWeek };
};

/** Rule-based recommendations, each with its evidence and an action. */
export const recommend = (m, cats) => {
  const R = []; const s = m.summary;
  const L = (key) => `[${key}](${jiraUrl(key)})`;
  if (s.createdPrev4 > 0 || s.createdLast4 > 0) {
    const delta = s.createdPrev4 ? Math.round(((s.createdLast4 - s.createdPrev4) / s.createdPrev4) * 100) : null;
    if (delta !== null && delta >= 20) R.push({ topic: 'Inflow rising', evidence: `${s.createdLast4} new defects in the last 4 weeks vs ${s.createdPrev4} in the 4 before (+${delta}%).`, action: 'Run a short root-cause pass on the top 2 categories below and add a release gate for them.', weight: 0 });
    else if (delta !== null && delta <= -20) R.push({ topic: 'Inflow falling', evidence: `${s.createdLast4} new defects in the last 4 weeks vs ${s.createdPrev4} before (${delta}%).`, action: 'Keep what is working; note which categories dropped so the practice can be repeated.', weight: 5 });
  }
  const net4 = s.createdLast4 - s.resolvedLast4;
  if (net4 > 0) R.push({ topic: 'Backlog growing', evidence: `${s.createdLast4} created vs ${s.resolvedLast4} resolved over 4 weeks (+${net4} open); ${s.openNow} open now.`, action: 'Reserve a fixed share of each sprint for defects (for example 20%), or triage the oldest into close / schedule.', weight: 1 });
  for (const c of m.byCategory.filter((x) => x.last4 > 0).slice(0, 2)) {
    const share = s.createdLast4 ? Math.round((c.last4 / s.createdLast4) * 100) : 0;
    if (share >= 20 && c.name !== OTHER.name) R.push({ topic: `${c.name}: ${share}% of new defects`, evidence: `${c.last4} of ${s.createdLast4} new in 4 weeks (${c.prev4} in the 4 before); ${c.open} open.`, action: adviceFor(c.name, cats), weight: 2 });
  }
  const t = m.byTenant[0];
  if (t && s.createdLast4 >= 8 && t.last4 / s.createdLast4 >= 0.25) R.push({ topic: `${t.name} concentrates the defects`, evidence: `${t.last4} of ${s.createdLast4} new defects in 4 weeks (${Math.round((t.last4 / s.createdLast4) * 100)}%); ${t.open} open.`, action: 'Hold a readiness review and a tenant-specific UAT checklist before its next release; name one owner for its defect list.', weight: 3 });
  const old90 = m.age.find((a) => a.name === '90d+')?.open || 0;
  if (old90 >= 5) R.push({ topic: 'Old defects pile up', evidence: `${old90} open defects are older than 90 days; oldest: ${m.oldest.slice(0, 3).map((o) => `${L(o.key)} (${o.ageDays}d)`).join(', ')}.`, action: 'Groom them in one session: close what no longer applies, re-date or assign the rest.', weight: 4 });
  const high = m.byPriority.filter((p) => /highest|critical|blocker|high|major/i.test(p.name) && p.open > 0);
  if (high.length) R.push({ topic: 'High-priority defects still open', evidence: high.map((p) => `${p.open} ${p.name}`).join(', ') + '.', action: 'Review these first in the next triage and confirm an owner and date for each.', weight: 2 });
  if (s.noClient > 0) R.push({ topic: 'Defects without a client', evidence: `${s.noClient} open defects have no client set.`, action: 'Require a client when a defect is logged so tenant trends stay accurate.', weight: 6 });
  return R.sort((x, y) => x.weight - y.weight).slice(0, 6);
};

const bar = (n, max, w = 14) => '█'.repeat(max ? Math.round((n / max) * w) : 0) || (n ? '▏' : '');
const L = (key) => `[${key}](${jiraUrl(key)})`;
const cell = (s) => String(s).replace(/\|/g, '/');

/** Plan for the top pattern of the week: fix what is open, prevent it, and measure it. */
export const planFor = (m, defects, cats) => {
  const p = m.patterns[0];
  if (!p) return null;
  const open = defects.filter((d) => d.open && d.category === p.name).sort((x, y) => y.created.localeCompare(x.created));
  const share = m.summary.createdThisWeek ? Math.round((p.count / m.summary.createdThisWeek) * 100) : 0;
  return {
    pattern: p.name, thisWeek: p.count, share, openOverall: p.open,
    why: `${p.count} of ${m.summary.createdThisWeek} new defects this week (${share}%), ${p.open} still open overall.`,
    fixNow: open.slice(0, 5).map((d) => ({ key: d.key, summary: d.summary, tenant: d.clients[0] || '(no client)' })),
    prevent: adviceFor(p.name, cats),
    measure: `Aim for at most ${Math.max(1, Math.ceil(p.count / 2))} new "${p.name}" defects a week within 4 weeks (this week: ${p.count}); check it in each weekly report.`,
  };
};

/** The simple report: this week's count, patterns, the top pattern's plan, and a 4-week trend. */
export const renderDraft = (e) => {
  const s = e.summary;
  const tt = e.topTenants.map((t) => `${t.name} ${t.count}`).join(', ');
  const lead = e.topTenants[0] && s.createdThisWeek ? ` ${e.topTenants[0].name} alone is ${Math.round((e.topTenants[0].count / s.createdThisWeek) * 100)}% of the week.` : '';
  const out = [`# Defects this week — ${e.week} (${pretty(e.from)}–${pretty(e.to)}${e.asOf < e.to ? `, as of ${pretty(e.asOf)}` : ''})`, '',
    `**${s.createdThisWeek} new defects** (${s.resolvedThisWeek} resolved, ${s.openNow} open overall).${tt ? ` Most affected tenants: ${tt}.${lead}` : ''}${e.noClientThisWeek ? ` ${e.noClientThisWeek} have no client set.` : ''}`, ''];
  out.push('## Defect patterns', '');
  if (e.patterns.length) out.push('| Pattern | New | Tenants impacted |', '|---|---|---|', ...e.patterns.map((p) => `| ${cell(p.name)} | ${p.count} | ${p.tenants.slice(0, 4).map((t) => `${t.name} (${t.count})`).join(', ')}${p.tenants.length > 4 ? ` +${p.tenants.length - 4} more` : ''} |`));
  else out.push('No new defects this week.');
  out.push('');
  if (e.plan) {
    const p = e.plan;
    out.push(`## Top pattern: ${p.pattern} — resolution plan`, '', p.why, '',
      `1. **Fix now:** ${p.fixNow.length ? p.fixNow.map((d) => `${L(d.key)} (${d.tenant})`).join(', ') : 'nothing open'}${p.openOverall > p.fixNow.length ? `; ${p.openOverall - p.fixNow.length} more open` : ''}.`,
      `2. **Prevent:** ${p.prevent}`, `3. **Measure:** ${p.measure}`, '');
  }
  const t4 = e.trend.slice(-4); const mx = Math.max(1, ...t4.flatMap((t) => [t.created, t.resolved]));
  const avg = Math.round((t4.reduce((n, t) => n + t.created, 0) / t4.length) * 10) / 10;
  const overall = t4[3].created > t4[0].created * 1.15 ? 'up' : t4[3].created < t4[0].created * 0.85 ? 'down' : 'flat';
  const recent = t4[3].created === t4[2].created ? '' : ` but ${t4[3].created > t4[2].created ? 'up' : 'down'} from last week (${t4[2].created})`;
  out.push('## Last 4 weeks', '', '```', 'Week          New                            Resolved', ...t4.map((t) => `${t.week.slice(5)} ${pretty(t.from).padEnd(6)}  ${bar(t.created, mx, 16).padEnd(16)} ${String(t.created).padStart(3)}     ${bar(t.resolved, mx, 16).padEnd(16)} ${String(t.resolved).padStart(3)}${t.partial ? '  (so far)' : ''}`), '```', '',
    `Inflow is ${overall} over four weeks (${t4.map((t) => t.created).join(' → ')}, average ${avg} a week)${recent}${overall === 'flat' && recent ? '' : ''}; open defects at week end: ${t4.map((t) => t.open).join(' → ')}.`);
  return out.join('\n');
};

/** The fuller report kept for reference (12-week trend, categories, tenants, components, age). Not used by default. */
export const renderDetailed = (e) => {
  const m = e; const s = m.summary;
  const trend = m.trend.map((t) => `| ${t.week}${t.partial ? '*' : ''} | ${pretty(t.from)} | ${t.created} ${bar(t.created, Math.max(...m.trend.map((x) => x.created)))} | ${t.resolved} | ${t.open} |`);
  const out = [`# Weekly defects report — ${m.week} (${pretty(m.from)}–${pretty(m.to)}, as of ${pretty(m.asOf)})`, '',
    `**This week:** ${s.createdThisWeek} new, ${s.resolvedThisWeek} resolved · **Open now:** ${s.openNow} · **4-week average inflow:** ${s.avgCreatedLast4}/week (previous 4: ${s.avgCreatedPrev4})`, ''];
  if (e.recommendations.length) { out.push('## Recommendations', ...e.recommendations.map((r) => `- **${r.topic}.** ${r.evidence} → ${r.action}`), ''); }
  out.push('## Trend (12 weeks; * = week in progress)', '', '| Week | Starts | Created | Resolved | Open at end |', '|---|---|---|---|---|', ...trend, '');
  out.push('## Type of issues (last 4 weeks vs the 4 before; open now)', '', '| Category | Last 4w | Previous 4w | Open now |', '|---|---|---|---|', ...m.byCategory.filter((c) => c.last4 || c.prev4 || c.open).map((c) => `| ${cell(c.name)} | ${c.last4} ${bar(c.last4, m.byCategory[0].last4 || 1, 10)} | ${c.prev4} | ${c.open} |`), '');
  out.push('## By tenant and component (last 4 weeks)', '', '| Tenant | New | Open now |', '|---|---|---|', ...m.byTenant.map((t) => `| ${t.name} | ${t.last4} | ${t.open} |`), '', '| Component | New | Open now |', '|---|---|---|', ...m.byComponent.map((c) => `| ${cell(c.name)} | ${c.last4} | ${c.open} |`), '');
  out.push(`## Open defects by age and priority`, '', `Age: ${m.age.map((a) => `${a.name} ${a.open}`).join(' · ')}`, `Priority: ${m.byPriority.map((p) => `${p.name} ${p.open}`).join(' · ') || 'none'}`, '');
  if (m.oldest.length) out.push('Oldest open: ' + m.oldest.map((o) => `${L(o.key)} ${cell(o.summary.slice(0, 50))} (${o.ageDays}d, ${o.tenant})`).join('; '), '');
  if (m.newThisWeek.length) out.push('## New this week', '', '| Ticket | Summary | Tenant | Category | Priority |', '|---|---|---|---|---|', ...m.newThisWeek.slice(0, 15).map((d) => `| ${L(d.key)} | ${cell(d.summary.slice(0, 70))} | ${d.tenant} | ${cell(d.category)} | ${d.priority} |`), m.newThisWeek.length > 15 ? `\n+${m.newThisWeek.length - 15} more` : '', '');
  return out.join('\n');
};

const file = (id, ext) => path.join(DEFECTS_DIR, `${id}.${ext}`);
export const loadDefectsWeek = (id) => { try { return JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8')); } catch { return null; } };
export const listDefectWeeks = () => { try { return fs.readdirSync(DEFECTS_DIR).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).map((f) => f.replace('.json', '')).sort(); } catch { return []; } };

export const buildDefects = async ({ id, T = today(), weeks = 12 }) => {
  const defects = await fetchDefects({ weeks, T });
  const m = buildMetrics(defects, { id, weeks, T });
  const cats = loadCategories();
  const prev = loadDefectsWeek(m.week);
  const entry = { ...m, generatedAt: new Date().toISOString(), totalDefectsRead: defects.length, plan: planFor(m, defects, cats), recommendations: recommend(m, cats), narrative: prev?.narrative ? { ...prev.narrative, stale: true } : null };
  fs.mkdirSync(DEFECTS_DIR, { recursive: true });
  fs.writeFileSync(file(m.week, 'json'), JSON.stringify(entry, null, 2));
  fs.writeFileSync(file(m.week, 'md'), renderDraft(entry));
  return { entry, defects };
};

export const saveDefectsNarrative = (id, text) => {
  const e = loadDefectsWeek(id);
  if (!e) throw new Error(`no stored defects report for ${id}; run build first`);
  e.narrative = { text, savedAt: new Date().toISOString(), forGeneratedAt: e.generatedAt, stale: false };
  fs.writeFileSync(file(id, 'json'), JSON.stringify(e, null, 2));
  fs.writeFileSync(file(id, 'md'), text);
  return e;
};
