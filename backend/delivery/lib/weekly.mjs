// Weekly report (engineering manager to lead), tenant-first: for each tenant with important work, the ask, where we are, risks and
// blockers, and completed vs pending tickets; then the overall completed vs pending picture and a short defects comment.
// "Important" = the user's focus items + tickets starred in My Tracker. Facts are gathered by rules (lib/focusdata.mjs); the wording can be
// polished by AI later and is saved next to the facts. Entries are stored per ISO week in <reports root>/weekly.
import fs from 'node:fs';
import path from 'node:path';
import { jiraUrl, today } from './jira.mjs';
import { collect, first, trunc, daysBetween, ready } from './focusdata.mjs';
import { loadFocus, REPORTS_ROOT } from './focus.mjs';
import { weekOf, weekById, pretty } from './weeks.mjs';
import { buildDefects } from './defects.mjs';
import { resolveSprint, sprintNumber, fetchSprintTickets, loadSprintConfig, computeStats } from './sprintreport.mjs';

export const WEEKLY_DIR = path.join(REPORTS_ROOT, 'weekly');
export { weekOf, weekById };

const DONE = /ready for qa|done|closed|released|resolved/i;

/** Facts for a set of tickets in [from, T]: what moved, what is at risk, what is next. */
export const summarize = ({ item, rows, matchNote }, { from, T }) => {
  const real = rows.filter((r) => r.t);
  const inWin = (day) => day >= from && day <= T;
  const accomplished = []; let subtasksClosed = 0;
  for (const r of real) {
    const ev = r.events.find((e) => e.kind === 'status' && inWin(e.at) && DONE.test(e.to || ''));
    if (ev) { if (r.t.type === 'Sub-task') subtasksClosed++; else accomplished.push({ key: r.key, summary: r.t.summary, text: `reached ${ev.to}`, at: ev.at }); }
    for (const p of r.prs.filter((x) => x.state === 'merged' && inWin(x.at))) accomplished.push({ key: r.key, summary: r.t.summary, text: `PR ${p.id} merged`, at: p.at, url: p.url });
    for (const x of r.rels.filter((y) => y.done && inWin(y.date))) accomplished.push({ key: r.key, summary: r.t.summary, text: `release ${x.key} (${x.tenant}, ${x.env || 'env ?'}) done`, at: x.date });
  }
  const seen = new Set();
  const acc = accomplished.filter((a) => { const k = `${a.key}|${a.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => y.at.localeCompare(x.at));

  const risks = real.filter((r) => r.flags.length && r.t.type !== 'Sub-task')
    .flatMap((r) => r.flags.map((f) => ({ key: r.key, summary: r.t.summary, text: f, sev: r.sev, owner: first(r.t.assignee || '') })))
    .sort((x, y) => x.sev - y.sev);

  const next = [];
  for (const r of real.filter((x) => !ready(x.t))) {
    if (r.t.due && r.t.due >= T && daysBetween(T, r.t.due) <= 7) next.push({ key: r.key, summary: r.t.summary, text: `due ${pretty(r.t.due)}`, at: r.t.due });
    if (r.t.uat && r.t.uat >= T && daysBetween(T, r.t.uat) <= 14) next.push({ key: r.key, summary: r.t.summary, text: `UAT ${pretty(r.t.uat)}`, at: r.t.uat });
    for (const x of r.rels.filter((y) => !y.done && y.date >= T && daysBetween(T, y.date) <= 7)) next.push({ key: r.key, summary: r.t.summary, text: `release ${x.key} ${pretty(x.date)}`, at: x.date });
  }
  const nseen = new Set();
  const nxt = next.filter((n) => { const k = `${n.key}|${n.text}`; if (nseen.has(k)) return false; nseen.add(k); return true; }).sort((x, y) => x.at.localeCompare(y.at));

  const nBlocked = risks.filter((r) => /^blocked/.test(r.text)).length;
  const nOver = risks.filter((r) => /^overdue/.test(r.text)).length;
  const nWait = risks.filter((r) => /^waiting/.test(r.text)).length;
  const rag = nBlocked > 0 || nOver >= 2 ? 'red' : (risks.length > 0 ? 'amber' : 'green');
  const open = real.filter((r) => !ready(r.t) && r.t.type !== 'Sub-task').length;
  return {
    name: item.name, why: item.why || '', rag, matchNote,
    counts: { tickets: real.filter((r) => r.t.type !== 'Sub-task').length, open, movedForward: acc.filter((a) => /^reached/.test(a.text)).length, prsMerged: acc.filter((a) => /^PR /.test(a.text)).length, releasesDone: acc.filter((a) => /^release/.test(a.text)).length, subtasksClosed, blocked: nBlocked, overdue: nOver, waiting: nWait },
    accomplished: acc.slice(0, 12), risks: risks.slice(0, 10), next: nxt.slice(0, 8),
  };
};

/** Asks that the manager cannot clear alone (kept in the data for the lead; not part of the short report). */
export const asksFrom = (groups) => {
  const asks = [];
  for (const i of groups) {
    for (const r of i.risks) {
      if (/^blocked/.test(r.text)) asks.push({ key: r.key, initiative: i.name, text: `unblock needed: ${r.text}`, weight: 0 });
      else if (/^waiting on client (\d+)d/.test(r.text) && Number(r.text.match(/(\d+)d/)[1]) >= 7) asks.push({ key: r.key, initiative: i.name, text: `client has not answered (${r.text}); needs an account or PM nudge`, weight: 1 });
      else if (/^PR .* open (\d+)d/.test(r.text) && Number(r.text.match(/open (\d+)d/)[1]) >= 7) asks.push({ key: r.key, initiative: i.name, text: `needs a reviewer: ${r.text}`, weight: 2 });
      else if (/^overdue (\d+)d/.test(r.text) && Number(r.text.match(/(\d+)d/)[1]) >= 14) asks.push({ key: r.key, initiative: i.name, text: `re-date or de-scope (${r.text})`, weight: 3 });
    }
  }
  const seen = new Set();
  return asks.filter((a) => { const k = `${a.key}|${a.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.weight - y.weight).slice(0, 8);
};

const L = (key) => `[${key}](${jiraUrl(key)})`;
const DOT = { red: '🔴', amber: '🟡', green: '🟢' };
const RAGORD = { red: 0, amber: 1, green: 2 };

const SHORT_PREFIX = /^\s*(\[[^\]]*\]\s*)?(\d{4}\.\d{2}\.\d{2}_)?[A-Za-z0-9&-]{2,12}(\s*[/,]\s*[A-Za-z0-9-]{2,12})*\s*[:|-]\s*/;
/** A ticket title in plain words: no tenant prefix, trimmed. */
const plain = (s, n = 70) => trunc(String(s || '').replace(SHORT_PREFIX, '').replace(/\s+/g, ' ').trim() || String(s || ''), n);

/**
 * Rules draft for a VP: a summary first, then the tenants in plain words (no ticket numbers), overall numbers, a defects comment,
 * and the ticket numbers with links only in a reference list at the bottom. A saved narrative replaces it when present.
 */
export const renderDraft = (e) => {
  const out = [`# Engineering weekly status — ${pretty(e.from)}–${pretty(e.to)} (${e.week})`, ''];
  const ts = e.tenants; const rag = (r) => ts.filter((t) => t.rag === r);
  const o = e.overall; const imp = o.important;
  const worry = rag('red').slice(0, 4).map((t) => t.name).join(', ');
  out.push('## Summary', '',
    `${ts.length} tenants have important work: ${rag('red').length} red, ${rag('amber').length} amber, ${rag('green').length} green${worry ? ` (needs attention: ${worry})` : ''}. ${imp.completed} important tasks are complete and ${imp.pending} pending (${imp.pct}% done)${o.sprint && !o.sprint.error ? `; the current sprint is ${o.sprint.pct}% complete (${o.sprint.completed} done, ${o.sprint.pending} pending)` : ''}. ${e.defects && !e.defects.error ? e.defects.comment : ''}`, '');

  out.push('## Important tasks by tenant', '');
  const quiet = ts.filter((t) => t.counts.pending === 0 && !t.risks.length);
  for (const t of ts.filter((x) => !quiet.includes(x))) {
    const areas = t.ask.areas.filter((a) => a !== 'Starred tickets'); const why = t.ask.why.split('; ').filter((y) => y && y !== 'starred in My Tracker').join('; ');
    out.push(`### ${DOT[t.rag]} ${t.name} — ${t.counts.completed} of ${t.counts.total} important tasks done`);
    out.push(`- **Ask:** ${areas.length ? areas.join(' · ') : 'important work starred in My Tracker'}${why ? ` (${why})` : ''}. Main open work: ${t.ask.keyWork.map((k) => plain(k.summary, 60)).join('; ') || 'none'}.`);
    out.push(`- **Where we are:** ${t.updates.length ? t.updates.slice(0, 3).map((u) => `${plain(u.summary, 50)} (${u.text.replace(/^comment: /, 'comment ').slice(0, 60)}, ${pretty(u.at)})`).join('; ') : 'no updates this week'}.`);
    const by = []; for (const r of t.risks) { const x = by.find((y) => y.key === r.key); if (x) x.f.push(r.text); else by.push({ key: r.key, summary: r.summary, f: [r.text] }); }
    out.push(`- **Risks & blockers:** ${by.length ? by.slice(0, 4).map((r) => `${plain(r.summary, 55)}: ${r.f.join(', ')}`).join('; ') + (by.length > 4 ? `; ${by.length - 4} more tickets flagged` : '') : 'none flagged'}.`);
    out.push(`- **Completed:** ${t.completedThisWeek.length ? `${t.completedThisWeek.length} this week (${t.completedThisWeek.slice(0, 4).map((c) => plain(c.summary, 45)).join('; ')}${t.completedThisWeek.length > 4 ? '; …' : ''})` : 'none this week'}${t.counts.completed > t.completedThisWeek.length ? `; ${t.counts.completed - t.completedThisWeek.length} done earlier` : ''}.`);
    out.push(`- **Pending:** ${t.counts.pending}${t.pending.length ? ` (${t.pending.slice(0, 4).map((p) => `${plain(p.summary, 45)} [${p.status}]`).join('; ')}${t.counts.pending > 4 ? '; …' : ''})` : ''}.`, '');
  }
  if (quiet.length) out.push(`**Nothing pending or at risk:** ${quiet.map((t) => `${t.name} (${t.counts.completed} done)`).join(', ')}.`, '');

  out.push('## Overall tickets', '', `- **Important tasks:** ${imp.completed} completed vs ${imp.pending} pending (${imp.pct}% done).`);
  if (o.sprint && !o.sprint.error) out.push(`- **Current sprint** (${o.sprint.name}): ${o.sprint.completed} completed vs ${o.sprint.pending} pending (${o.sprint.pct}% done).`);
  out.push('', '## Defects', '', e.defects && !e.defects.error ? e.defects.comment : `Defect numbers unavailable (${e.defects?.error || 'not read'}).`, '');

  out.push('## Reference: tickets by tenant', '');
  for (const t of ts) {
    const parts = [...t.completedThisWeek.map((c) => `${L(c.key)} ${plain(c.summary, 45)} (done)`), ...t.pending.map((p) => `${L(p.key)} ${plain(p.summary, 45)} (${p.status})`)];
    if (parts.length) out.push(`- **${t.name}:** ${parts.join(' · ')}${t.counts.pending > t.pending.length ? ` · +${t.counts.pending - t.pending.length} more pending` : ''}`);
  }
  return out.join('\n');
};

/** The ticket-by-ticket draft, kept for reference. Not used by default. */
export const renderDetailed = (e) => {
  const out = [`# Weekly report — ${e.week} (${pretty(e.from)}–${pretty(e.to)}, as of ${pretty(e.asOf)})`, ''];
  out.push('## Important tasks by tenant', '');
  if (!e.tenants.length) out.push('No important tasks found. Add focus items (`focus.mjs add ...`) or star tickets in My Tracker.', '');
  const quiet = e.tenants.filter((t) => t.counts.pending === 0 && !t.risks.length); // nothing open and nothing at risk: one line at the end
  for (const t of e.tenants.filter((x) => !quiet.includes(x))) {
    out.push(`### ${DOT[t.rag]} ${t.name} — ${t.counts.completed} of ${t.counts.total} done`);
    const areas = t.ask.areas.filter((a) => a !== 'Starred tickets'); const why = t.ask.why.split('; ').filter((y) => y && y !== 'starred in My Tracker').join('; ');
    out.push(`**Ask:** ${areas.length ? areas.join(' · ') : 'starred in My Tracker'}${why ? ` (${why})` : ''}${t.ask.keyWork.length ? `. Open work: ${t.ask.keyWork.map((k) => `${L(k.key)} ${trunc(k.summary, 55)}`).join('; ')}` : ''}.`);
    out.push(`**Where we are:** ${t.updates.length ? t.updates.slice(0, 3).map((u) => `${pretty(u.at)} ${L(u.key)} ${trunc(u.text, 70)}`).join('; ') : 'no updates this week'}.`);
    out.push(`**Risks & blockers:** ${t.risks.length ? (() => { const by = []; for (const r of t.risks) { const x = by.find((y) => y.key === r.key); if (x) x.f.push(r.text); else by.push({ key: r.key, f: [r.text] }); } return by.slice(0, 4).map((r) => `${L(r.key)} ${r.f.join(', ')}`).join('; ') + (by.length > 4 ? `; +${by.length - 4} more tickets` : ''); })() : 'none flagged'}.`);
    out.push(`**Completed (${t.counts.completed}):** ${t.completedThisWeek.length ? `this week ${t.completedThisWeek.slice(0, 6).map((c) => L(c.key)).join(', ')}${t.completedThisWeek.length > 6 ? ` +${t.completedThisWeek.length - 6}` : ''}` : 'none this week'}${t.counts.completed > t.completedThisWeek.length ? `; ${t.counts.completed - t.completedThisWeek.length} done earlier` : ''}.`);
    out.push(`**Pending (${t.counts.pending}):** ${t.pending.length ? t.pending.slice(0, 6).map((p) => `${L(p.key)} (${p.status}${p.flag ? `, ${p.flag}` : ''})`).join('; ') + (t.counts.pending > 6 ? `; +${t.counts.pending - 6} more` : '') : 'nothing pending'}.`, '');
  }
  if (quiet.length) out.push(`**Nothing pending or at risk:** ${quiet.map((t) => `${t.name} (${t.counts.completed} done${t.completedThisWeek.length ? `, ${t.completedThisWeek.map((c) => L(c.key)).join(' ')} this week` : ''})`).join(', ')}.`, '');
  const o = e.overall; const imp = o.important;
  out.push('## Overall tickets', '', `- **Important tasks:** ${imp.completed} completed vs ${imp.pending} pending (${imp.pct}% done).`);
  if (o.sprint && !o.sprint.error) out.push(`- **${o.sprint.name}** (stories, feature and product requests worked in the sprint): ${o.sprint.completed} completed vs ${o.sprint.pending} pending (${o.sprint.pct}% done); ${o.sprint.byBucket.filter((b) => /blocked|returned/i.test(b.name)).map((b) => `${b.n} ${b.name.toLowerCase()}`).join(', ') || 'no blocked tickets'}.`);
  else out.push(`- Sprint numbers unavailable (${o.sprint?.error || 'not read'}).`);
  out.push('', '## Defects', '', e.defects && !e.defects.error ? e.defects.comment : `Defect numbers unavailable (${e.defects?.error || 'not read'}).`);
  return out.join('\n');
};

export const weekFile = (id, ext) => path.join(WEEKLY_DIR, `${id}.${ext}`);
export const loadWeek = (id) => { try { return JSON.parse(fs.readFileSync(weekFile(id, 'json'), 'utf8')); } catch { return null; } };
export const listWeeks = () => { try { return fs.readdirSync(WEEKLY_DIR).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).map((f) => f.replace('.json', '')).sort(); } catch { return []; } };

const defectsComment = (en, prev) => {
  const s = en.summary; const p = en.patterns[0];
  const tt = en.topTenants.map((t) => `${t.name} ${t.count}`).join(', ');
  const t4 = en.trend.slice(-2);
  const move = t4.length === 2 && t4[0].created !== t4[1].created ? ` (${t4[1].created > t4[0].created ? 'up' : 'down'} from ${t4[0].created} last week)` : '';
  return `${s.createdThisWeek} new defects this week${move}, ${s.resolvedThisWeek} resolved, ${s.openNow} open overall.${tt ? ` Most affected: ${tt}.` : ''}${p ? ` Biggest pattern: ${p.name} (${p.count} of ${s.createdThisWeek}), plan: ${en.plan ? 'see the defects report' : 'none yet'}.` : ''}`;
};

/** Gather facts for a week and save them (json + md). Keeps an earlier narrative but marks it stale. */
export const buildWeek = async ({ id, getFlags, T = today(), staleDays = 5 }) => {
  const w = id ? weekById(id) : weekOf(T);
  const asOf = T < w.to ? T : w.to;
  const focus = loadFocus().items.filter((i) => !i.archived);
  const collected = [];
  for (const item of focus) collected.push(await collect(item, { staleDays, T: asOf }));
  const covered = new Set(collected.flatMap((c) => c.rows.map((r) => r.key)));
  const flags = getFlags ? await getFlags() : { keys: [], source: 'not read' };
  const extra = flags.keys.filter((k) => !covered.has(k));
  if (extra.length) {
    const c = await collect({ name: 'Starred tickets', why: 'starred in My Tracker', seeds: extra, tenants: [], keywords: [] }, { staleDays, T: asOf, hop: false });
    c.rows = c.rows.filter((r) => !r.t || r.t.statusCategory !== 'Done' || String(r.lastAct || '') >= w.from); // old closed stars are not news
    collected.push(c);
  }

  // group every important ticket under one tenant: a focus item that names a single tenant wins, else the ticket's first client
  const byKey = new Map();
  for (const c of collected) {
    const pref = c.item.tenants?.length === 1 ? c.item.tenants[0] : null;
    for (const r of c.rows) {
      if (!r.t) continue;
      const e = byKey.get(r.key) || { row: r, tenant: pref || r.t.clients[0] || '(no client)', inits: new Set(), whys: new Set(), pref: !!pref };
      if (pref && !e.pref) { e.tenant = pref; e.pref = true; }
      e.inits.add(c.item.name); if (c.item.why) e.whys.add(c.item.why);
      byKey.set(r.key, e);
    }
  }
  const groups = new Map();
  for (const e of byKey.values()) {
    if (!groups.has(e.tenant)) groups.set(e.tenant, { rows: [], inits: new Set(), whys: new Set() });
    const g = groups.get(e.tenant); g.rows.push(e.row); e.inits.forEach((i) => g.inits.add(i)); e.whys.forEach((y) => g.whys.add(y));
  }
  const tenants = [];
  for (const [name, g] of groups) {
    const s = summarize({ item: { name, why: '' }, rows: g.rows, matchNote: '' }, { from: w.from, T: asOf });
    const real = g.rows.filter((r) => r.t.type !== 'Sub-task');
    const doneRows = real.filter((r) => ready(r.t));
    const pendingRows = real.filter((r) => !ready(r.t)).sort((x, y) => x.sev - y.sev || String(x.t.due || '9').localeCompare(String(y.t.due || '9')));
    const moved = s.accomplished.filter((a) => /^reached/.test(a.text));
    const updates = g.rows.filter((r) => r.t.type !== 'Sub-task').flatMap((r) => r.events.filter((ev) => ['status', 'comment', 'due'].includes(ev.kind) && ev.at >= w.from && ev.at <= asOf).map((ev) => ({ at: ev.at, key: r.key, summary: r.t.summary, text: ev.text, by: ev.by }))).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6);
    tenants.push({
      name, rag: s.rag, initiatives: [...g.inits],
      ask: { areas: [...g.inits], why: [...g.whys].join('; '), keyWork: pendingRows.slice(0, 3).map((r) => ({ key: r.key, summary: r.t.summary })) },
      counts: { ...s.counts, total: real.length, completed: doneRows.length, pending: pendingRows.length },
      updates, risks: s.risks, next: s.next,
      completedThisWeek: moved.map((a) => ({ key: a.key, summary: a.summary, at: a.at })),
      pending: pendingRows.slice(0, 12).map((r) => ({ key: r.key, summary: r.t.summary, status: r.t.status, due: r.t.due || null, flag: r.flags[0] || null })),
    });
  }
  tenants.sort((x, y) => RAGORD[x.rag] - RAGORD[y.rag] || y.counts.pending - x.counts.pending);

  const completed = tenants.reduce((n, t) => n + t.counts.completed, 0); const pending = tenants.reduce((n, t) => n + t.counts.pending, 0);
  let sprint = null;
  try {
    const sp = await resolveSprint('current');
    const rows = await fetchSprintTickets(sp, loadSprintConfig(sprintNumber(sp)), asOf);
    const st = computeStats(rows, sp, asOf);
    sprint = { name: sp.name, total: st.total, completed: st.done, pending: st.total - st.done, pct: st.completionPct, byBucket: st.byBucket.filter((b) => b.n) };
  } catch (err) { sprint = { error: String(err.message).split('\n')[0] }; }
  let defects = null;
  try { const { entry } = await buildDefects({ id: w.id, T }); defects = { created: entry.summary.createdThisWeek, resolved: entry.summary.resolvedThisWeek, open: entry.summary.openNow, topTenants: entry.topTenants, topPattern: entry.patterns[0]?.name || null, comment: defectsComment(entry) }; }
  catch (err) { defects = { error: String(err.message).split('\n')[0] }; }

  const prev = loadWeek(w.id);
  const entry = {
    week: w.id, from: w.from, to: w.to, asOf, generatedAt: new Date().toISOString(), flagged: { count: flags.keys.length, source: flags.source },
    tenants, overall: { important: { completed, pending, pct: completed + pending ? Math.round((completed / (completed + pending)) * 100) : 0 }, sprint }, defects,
    asks: asksFrom(tenants), narrative: prev?.narrative ? { ...prev.narrative, stale: true } : null,
  };
  fs.mkdirSync(WEEKLY_DIR, { recursive: true });
  fs.writeFileSync(weekFile(w.id, 'json'), JSON.stringify(entry, null, 2));
  fs.writeFileSync(weekFile(w.id, 'md'), entry.narrative && !entry.narrative.stale ? entry.narrative.text : renderDraft(entry));
  return entry;
};

export const saveNarrative = (id, text) => {
  const e = loadWeek(id);
  if (!e) throw new Error(`no stored entry for ${id}; run build first`);
  e.narrative = { text, savedAt: new Date().toISOString(), forGeneratedAt: e.generatedAt, stale: false };
  fs.writeFileSync(weekFile(id, 'json'), JSON.stringify(e, null, 2));
  fs.writeFileSync(weekFile(id, 'md'), text);
  return e;
};
