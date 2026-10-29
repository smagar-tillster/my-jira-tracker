// Shared engine for sprint focus and the weekly status: line up the tickets of a focus item and read what happened on each
// (status changes, assignments, due changes, comments), plus PRs and releases from the local ledgers. Read-only, rules only.
import fs from 'node:fs';
import path from 'node:path';
import { jira, search, mapIssue, today, FIELDS, CACHE_DIR } from './jira.mjs';
import { adfText, loadLedger, releasesForTicket } from './releases.mjs';
import { loadPrLedger } from './prledger.mjs';

export const first = (name) => String(name || '').split(/\s+/)[0] || '?';
export const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
export const ready = (t) => t.statusCategory === 'Done' || t.status === 'Ready for QA'; // repo rule: Ready for QA counts as done
export const daysBetween = (from, to) => Math.floor((Date.parse(`${String(to).slice(0, 10)}T12:00:00`) - Date.parse(`${String(from).slice(0, 10)}T12:00:00`)) / 86400000);

/** One ticket: fields, changelog events (newest first), links, subtasks. */
export async function detail(key) {
  const raw = await jira('GET', `/issue/${key}?expand=changelog&fields=summary,status,issuetype,priority,assignee,duedate,fixVersions,components,labels,${FIELDS.client},${FIELDS.uat},${FIELDS.sprint},parent,created,updated,statuscategorychangedate,issuelinks,subtasks,comment`);
  const cl = raw.changelog || { histories: [] };
  let histories = cl.histories || [];
  if (cl.total > histories.length) { // long history: the newest entries are on the last page
    try { histories = (await jira('GET', `/issue/${key}/changelog?startAt=${Math.max(0, cl.total - 100)}&maxResults=100`)).values || histories; } catch { /* keep what we have */ }
  }
  const t = mapIssue(raw);
  const events = [];
  for (const h of histories) {
    const at = String(h.created).slice(0, 10);
    const by = first(h.author?.displayName);
    for (const it of h.items || []) {
      if (it.field === 'status') events.push({ at, kind: 'status', from: it.fromString, to: it.toString, text: `status ${it.fromString} → ${it.toString}`, by });
      else if (it.field === 'assignee') events.push({ at, kind: 'assign', text: `assigned to ${first(it.toString) || 'nobody'}`, by });
      else if (it.field === 'duedate') events.push({ at, kind: 'due', text: `due ${String(it.fromString || '-').slice(0, 10)} → ${String(it.toString || '-').slice(0, 10)}`, by });
      else if (/^(Client|Fix Version|UAT)/i.test(it.field)) events.push({ at, kind: 'field', text: `${it.field.toLowerCase()} → ${trunc(it.toString || it.to || '-', 40)}`, by });
    }
  }
  for (const c of raw.fields.comment?.comments || []) {
    events.push({ at: String(c.created).slice(0, 10), kind: 'comment', text: `comment: “${trunc(adfText(c.body).replace(/\s+/g, ' ').trim(), 140)}”`, by: first(c.author?.displayName) });
  }
  events.sort((x, y) => y.at.localeCompare(x.at));
  const links = (raw.fields.issuelinks || []).map((l) => {
    const o = l.outwardIssue || l.inwardIssue;
    return { rel: l.outwardIssue ? l.type.outward : l.type.inward, key: o?.key, status: o?.fields?.status?.name || '', cat: o?.fields?.status?.statusCategory?.name || '' };
  }).filter((l) => l.key && !/clone/i.test(l.rel));
  const subtasks = (raw.fields.subtasks || []).map((s) => s.key);
  const lastStatus = events.find((e) => e.kind === 'status');
  return { t, events, links, subtasks, lastStatusAt: lastStatus?.at || t.statusChanged || t.created };
}

const ledgers = () => {
  const delivery = (() => { try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'data', 'delivery.json'), 'utf8')); } catch { return { openPrs: [] }; } })();
  return { prLedger: loadPrLedger(), relLedger: loadLedger(), delivery };
};

/**
 * item: { name, why, seeds[], tenants[], keywords[] } (a focus item) or { name, seeds: [keys] } for an ad hoc set.
 * Returns { item, matchNote, rows[], events[] }; rows are most urgent first. Each row:
 * { key, t, reasons[], flags[], sev, lastAct, last, events[], prs[], rels[], links[] }
 */
export async function collect(item, { limit = 40, staleDays = 5, T = today(), hop = true } = {}) {
  const { prLedger, relLedger, delivery } = ledgers();
  const sprintScope = 'project = NGK AND sprint in openSprints() AND statusCategory != Done';
  const why = new Map();
  const mark = (k, r) => { if (!why.has(k)) why.set(k, new Set()); why.get(k).add(r); };
  (item.seeds || []).forEach((k) => mark(k, 'you named it'));
  const clauses = [];
  if ((item.tenants || []).length) clauses.push(`cf[16047] in (${item.tenants.map((t) => `"${t}"`).join(',')})`);
  if ((item.keywords || []).length) clauses.push(`(${item.keywords.map((k) => `text ~ "${k.replace(/"/g, '')}"`).join(' OR ')})`);
  let matchNote = '';
  if (clauses.length) {
    try {
      const found = (await search(`${sprintScope} AND ${clauses.join(' AND ')} ORDER BY updated DESC`)).map(mapIssue).slice(0, limit);
      found.forEach((t) => mark(t.key, `sprint match: ${[item.tenants?.length ? `tenant ${item.tenants.join('/')}` : '', item.keywords?.length ? `text ${item.keywords.join('/')}` : ''].filter(Boolean).join(' + ')}`));
      matchNote = `${found.length} active sprint ticket(s) matched ${clauses.length > 1 ? 'tenant AND text' : item.tenants?.length ? 'the tenant' : 'the text'}`;
    } catch (e) { matchNote = `search failed: ${String(e.message).split('\n')[0]}`; }
  }
  const details = new Map();
  const fetchAll = async (keys) => {
    const todo = keys.filter((k) => !details.has(k));
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < todo.length) { const k = todo[i++]; try { details.set(k, await detail(k)); } catch (e) { details.set(k, { error: String(e.message).split('\n')[0] }); } } }));
  };
  await fetchAll([...why.keys()].slice(0, limit));
  if (hop) {
    for (const k of item.seeds || []) { // one hop from the seeds
      const d = details.get(k);
      if (!d || d.error) continue;
      d.links.forEach((l) => mark(l.key, `${l.rel} ${k}`));
      d.subtasks.forEach((s) => mark(s, `subtask of ${k}`));
      if (d.t.parentKey) mark(d.t.parentKey, `parent of ${k}`);
    }
    await fetchAll([...why.keys()].slice(0, limit + 15));
  }

  const rows = []; const events = [];
  for (const [key, reasons] of why) {
    const d = details.get(key);
    if (!d) continue;
    if (d.error) { rows.push({ key, err: d.error, flags: [], sev: 9, events: [], prs: [], rels: [], links: [] }); continue; }
    const { t } = d;
    const flags = []; let sev = 5;
    const lastAct = [d.events[0]?.at, t.updated].filter(Boolean).sort().pop();
    const open = !ready(t);
    const blockers = d.links.filter((l) => /blocked by/i.test(l.rel) && l.cat !== 'Done');
    if (/blocked/i.test(t.status) || blockers.length) { flags.push(blockers.length ? `blocked by ${blockers.map((b) => b.key).join(', ')}` : 'blocked'); sev = Math.min(sev, 0); }
    if (/waiting for client/i.test(t.status)) { const n = daysBetween(d.lastStatusAt, T); flags.push(`waiting on client ${n}d`); sev = Math.min(sev, n >= 3 ? 1 : 3); }
    if (open && t.due) { const n = daysBetween(t.due, T); if (n > 0) { flags.push(`overdue ${n}d`); sev = Math.min(sev, 1); } else if (n >= -2) { flags.push(`due ${n === 0 ? 'today' : `in ${-n}d`}`); sev = Math.min(sev, 2); } }
    if (open && !/blocked|waiting/i.test(t.status) && daysBetween(lastAct, T) >= staleDays) { flags.push(`quiet ${daysBetween(lastAct, T)}d`); sev = Math.min(sev, 2); }
    const prs = [...Object.values(prLedger.prs || {}).filter((p) => (p.keys || []).includes(key)).map((p) => ({ id: p.id, url: p.url, state: 'merged', at: String(p.mergedAt).slice(0, 10) })),
      ...(delivery.openPrs || []).filter((p) => (p.keys || []).includes(key)).map((p) => ({ id: p.id, url: p.url, state: 'open', at: String(p.createdAt).slice(0, 10), review: p.reviewDecision, draft: p.isDraft }))];
    for (const p of prs.filter((x) => x.state === 'open')) {
      const n = daysBetween(p.at, T);
      if (!p.draft && p.review !== 'APPROVED' && n >= 3) { flags.push(`PR ${p.id.split('#')[1]} open ${n}d, ${p.review ? p.review.toLowerCase().replace('_', ' ') : 'no review'}`); sev = Math.min(sev, 2); }
    }
    const rels = releasesForTicket(relLedger, key).slice(0, 2).map(({ rec }) => ({ key: rec.key, date: rec.date, env: rec.env, status: rec.status, done: rec.done, tenant: rec.tenant }));
    d.events.forEach((e) => events.push({ ...e, key }));
    rows.push({ key, t, reasons: [...reasons], flags, sev, lastAct, last: d.events[0], events: d.events, prs, rels, links: d.links });
  }
  rows.sort((x, y) => x.sev - y.sev || String(y.lastAct || '').localeCompare(String(x.lastAct || '')));
  return { item, matchNote, rows, events };
}
