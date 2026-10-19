#!/usr/bin/env node
// Daily delivery summary. Deterministic and read-only (the only writes are local files under backend/data/delivery).
//   1. Completed releases: Release tickets dated the previous business day (date in the title, else due date; NOT the fix version).
//      Components from title + Jira Components field; tickets and software versions parsed from the description.
//      Every release is also kept in a ledger (releases/ledger.json + one markdown file per release) so it can be queried later.
//   2. Needs release today: active-sprint tickets whose fix version date is today and that are not ready. Release ticket may not exist yet.
//   3. Merged PRs by repo (previous business day + today): ticket + two lines on what was built.
//   4. Open PRs by repo, same way (older ones collapsed).
// Outputs: .cache/daily.html (open this), .cache/daily.md, .cache/daily.json.
// Needs Jira creds (backend/.env) and the user's gh login, so run it from the user's terminal.
// PRs are strictly those merged since the last run (state/run.json). Options for that: --rerender, --since "YYYY-MM-DD HH:MM", --no-save.
// Usage: node daily.mjs [--date YYYY-MM-DD] [--backfill N] [--component any|NAME] [--rag-dir PATH]
//   --backfill N  also records release tickets dated in the last N days into the ledger (one-time catch-up for "ask about any release")
//   --rag-dir     copy the release markdown files into that RAG data-feed folder (<dir>/ngk-releases)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { search, mapIssue, parseArgs, today, md, jiraUrl, PROJECT, FIELDS, JIRA_HOST, CACHE_DIR } from '../lib/jira.mjs';
import { syncReleases, parseSummary, copyToRag, componentList, componentText, explainRelease, loadLedger, releasesForTicket, canonComponent } from '../lib/releases.mjs';
import { renderHtml } from '../lib/html.mjs';
import { buildDeliveryData } from '../lib/delivery.mjs';
import { tierOf, rulesEntry, writeAnalysis } from '../lib/triage.mjs';
import { DATA_DIR } from '../lib/paths.mjs';
import { analyzeMerged, jiraLinks } from '../lib/prdeps.mjs';
import { loadPrLedger, upsertPr, savePrLedger, copyPrsToRag, loadAnalysis, inferTenants } from '../lib/prledger.mjs';

const run = promisify(execFile);
const T0 = Date.now(); let lapAt = T0; const laps = {}; // stage timings, shown in the app so "how long does a report take" has an answer
const lap = (name) => { laps[name] = Math.round((Date.now() - lapAt) / 100) / 10; lapAt = Date.now(); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const a = parseArgs(process.argv.slice(2));
const DAY = a.date || today();
const BACKFILL = Number(a.backfill || 0);
const root = String(cfg.root).replace(/^~/, os.homedir());
const aliases = cfg.tenantAliases || {};
const comp = String(a.component === undefined ? cfg.component || '' : a.component).toLowerCase(); // 'any' = all components

const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDate = (iso) => ymd(new Date(iso));
const shift = (day, n) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); return ymd(x); };
const prevBizDay = (day) => { let x = shift(day, -1); while ([0, 6].includes(new Date(`${x}T12:00:00`).getDay())) x = shift(x, -1); return x; };
const YDAY = prevBizDay(DAY); // Monday -> Friday

// ---- PR window: strictly what merged since the last run (state/run.json). --date = historical view of a past day (state untouched).
//   --rerender  same window as the last run (use after writing PR analyses); --since "2026-10-16 09:00" custom start; --no-save leaves the state alone
const STATE_DIR = path.join(DATA_DIR, 'state');
const STATE = path.join(STATE_DIR, 'run.json');
const prevState = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } })();
const nowIso = new Date().toISOString();
let winSince; let winUntil; let saveState = true; let windowNote;
if (a.date) { winSince = new Date(`${prevBizDay(DAY)}T00:00:00`).toISOString(); winUntil = new Date(`${DAY}T23:59:59`).toISOString(); saveState = false; windowNote = `historical view for ${DAY}`; }
else if (a.rerender && prevState) { winSince = prevState.since; winUntil = prevState.until; saveState = false; windowNote = 'same window as the last run'; }
else if (a.since && a.since !== true) { winSince = new Date(a.since).toISOString(); winUntil = nowIso; windowNote = `since ${a.since}`; }
else if (prevState?.until) { winSince = prevState.until; winUntil = nowIso; windowNote = 'since the last run'; }
else { winSince = new Date(`${prevBizDay(DAY)}T00:00:00`).toISOString(); winUntil = nowIso; windowNote = `first run: since ${prevBizDay(DAY)} 00:00`; }
if (a['no-save']) saveState = false;
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pretty = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const normTenant = (t) => aliases[t] || t;
const isDone = (t) => t.statusCategory === 'Done';
const isReady = (t) => isDone(t) || t.status === 'Ready for QA'; // repo rule: Ready for QA counts as done
const isRelease = (t) => t.type.toLowerCase() === 'release';
const isTestTicket = (t) => /regression testing/i.test(t.summary);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------------------------------------------------------------- PRs (merged since the previous business day, and all open)
const slugOf = (dir) => {
  try { return execFileSync('git', ['-C', path.join(root, dir), 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim().replace(/^(git@github\.com:|https:\/\/github\.com\/)/, '').replace(/\.git$/, ''); }
  catch { return null; }
};
const keysOf = (...t) => [...new Set(t.join(' ').toUpperCase().match(/NGK-\d+/g) || [])];
const cleanTitle = (t) => t.replace(/^\s*(fix|feat|chore|refactor|perf|docs|test)(\([^)]*\))?:\s*/i, '').replace(/^\s*NGK-\d+\s*[:\-|]?\s*/i, '').replace(/^\s*(fix|feat|chore)(\([^)]*\))?:\s*/i, '').trim();
const gist = (body) => {
  const text = (l) => l.replace(/[`*_]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/^[-+]\s+/, '').trim();
  const lines = String(body || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l
    && !/^(#|<!--|-\s*\[[ x]\]|>|---|\|)/i.test(l)
    && !/^(requirements|description|summary|overview|context|changes?|jira|testing|documentation)\b/i.test(text(l))
    && !/^(<|https?:\/\/|co-authored|ai-assisted|generated|ticket|link|screenshots?|how to test)/i.test(l)
    && !/^(provide|describe|please|add |explain|what |why |n\/a|none|tbd)\b/i.test(text(l))
    && /[a-z]{3}/i.test(text(l)) && text(l).length > 12);
  return lines.length ? trunc(text(lines[0]), 200) : '';
};
const dayBefore = shift(localDate(winSince), -1); // search is date-granular; the exact filter below uses the timestamps
const gh = async (args) => JSON.parse((await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout || '[]');

const mergedRaw = []; const prErrors = [];
await Promise.all(cfg.repos.map(async (repo) => {
  const slug = slugOf(repo);
  if (!slug) { prErrors.push(`${repo}: no git remote found under ${root}`); return; }
  try {
    for (const p of await gh(['pr', 'list', '--repo', slug, '--state', 'merged', '--search', `merged:>=${dayBefore}`, '--limit', '200', '--json', 'number,title,body,mergedAt,author,url,headRefName'])) {
      const t = Date.parse(p.mergedAt);
      if (t > Date.parse(winSince) && t <= Date.parse(winUntil)) mergedRaw.push({ repo, p, day: localDate(p.mergedAt) });
    }
  } catch (e) { prErrors.push(`${repo}: ${String(e.stderr || e.message).split('\n')[0]}`); }
}));

lap('GitHub: merged PRs');
// ---------------------------------------------------------------- Jira: active-sprint tickets and Release tickets
const prefix = String(cfg.sprintPrefix || '').toLowerCase();
const sprintIssues = (await search(`project = ${PROJECT} AND sprint in openSprints() ORDER BY key ASC`)).map(mapIssue)
  .filter((t) => t.sprints.some((s) => s.state === 'active' && s.name.toLowerCase().startsWith(prefix)));

// Release tickets: fetched, parsed and saved to the ledger by the shared sync (lib/releases.mjs)
const { recs, relMapped, kmap, ledgerInfo } = await syncReleases({
  minDate: BACKFILL ? shift(DAY, -BACKFILL) : shift(DAY, -7), maxDate: DAY, day: DAY, aliases, // last 7 days are re-synced so statuses in the app stay fresh
  known: new Map(sprintIssues.map((t) => [t.key, t])),
});
lap('Jira: sprint + release tickets');
const rag = a['rag-dir'] ? copyToRag(String(a['rag-dir']).replace(/^~/, os.homedir())) : null;

// 1. Completed releases: release tickets dated the previous business day; the UAT/LAB + PROD pair of one release becomes one row
const completedMap = new Map();
for (const r of recs.filter((x) => x.date === YDAY)) {
  const k = `${r.tenant}|${r.what}`;
  if (!completedMap.has(k)) completedMap.set(k, { tenant: r.tenant, what: r.what, titleComponents: r.titleComponents, components: [], versions: [], tickets: [], items: [], notes: '', owner: '' });
  const g = completedMap.get(k);
  g.tickets.push({ key: r.key, env: r.env, status: r.status, statusCategory: r.statusCategory, done: r.done });
  for (const c of r.components) if (!g.components.includes(c)) g.components.push(c);
  for (const v of r.versions) if (!g.versions.some((x) => x.name.toLowerCase() === v.name.toLowerCase())) g.versions.push(v);
  for (const i of r.tickets) if (!g.items.some((x) => (x.key && x.key === i.key) || (!x.key && !i.key && x.label === i.label))) g.items.push(i);
  if (r.notes.length > g.notes.length) g.notes = r.notes;
  if (!g.owner && r.assignee) g.owner = r.assignee;
  if (r.titleComponents.length > g.titleComponents.length) g.titleComponents = r.titleComponents;
}
const completed = [...completedMap.values()].map((g) => ({ ...g, allDone: g.tickets.every((t) => t.done) })).sort((x, y) => x.tenant.localeCompare(y.tenant) || x.what.localeCompare(y.what));

// 2. Needs release today: sprint tickets whose fix version is dated today and that are not ready
const relByFv = new Map();
for (const { t } of relMapped) for (const fv of t.fixVersions) relByFv.set(fv, [...(relByFv.get(fv) || []), { key: t.key, status: t.status, statusCategory: t.statusCategory, env: parseSummary(t.summary).env }]);
const compOk = (t) => !comp || comp === 'any' || t.components.some((c) => c.toLowerCase() === comp);
const sev = (t) => (/blocked/i.test(t.status) ? 0 : /returned/i.test(t.status) ? 1 : /^(to do|backlog|open|ready to build)$/i.test(t.status) ? 2 : 3);
const needsMap = new Map();
for (const t of sprintIssues) {
  if (isRelease(t) || !compOk(t) || isReady(t) || isTestTicket(t)) continue;
  for (const fv of t.fixVersionsFull.filter((x) => x.date === DAY)) {
    if (!needsMap.has(fv.name)) needsMap.set(fv.name, { fixVersion: fv.name, releaseTickets: relByFv.get(fv.name) || [], tickets: [] });
    needsMap.get(fv.name).tickets.push(t);
  }
}
// A fix version is shared by many release tickets; show the ones still open, and just count the ones already released.
const needs = [...needsMap.values()].map((g) => {
  const openRel = g.releaseTickets.filter((r) => r.statusCategory !== 'Done');
  return { ...g, releaseTickets: openRel, releasedCount: g.releaseTickets.length - openRel.length, tickets: g.tickets.sort((x, y) => sev(x) - sev(y) || x.key.localeCompare(y.key)) };
}).sort((x, y) => x.fixVersion.localeCompare(y.fixVersion));

// 3 + 4. PRs: tie to Jira tickets, then two lines on what each builds
const prKeys = [...new Set(mergedRaw.flatMap(({ p }) => keysOf(p.title, p.headRefName)))].filter((k) => !kmap.has(k));
for (const c of chunk(prKeys, 80)) for (const t of (await search(`key in (${c.join(',')})`)).map(mapIssue)) kmap.set(t.key, t);
const same = (x, y) => x.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) === y.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
const shapePr = ({ repo, p, day }) => {
  const keys = keysOf(p.title, p.headRefName);
  const jt = keys.map((k) => kmap.get(k)).find(Boolean);
  const line1 = cleanTitle(p.title);
  let line2 = gist(p.body);
  if (!line2 || same(line2, line1)) line2 = jt && !same(jt.summary, line1) ? `Ticket: ${jt.summary}` : '';
  const base = { repo, number: p.number, keys, title: p.title, body: p.body || '', line1, line2, detail: line2, author: p.author?.login || '', url: p.url };
  return { ...base, mergedAt: p.mergedAt, day, dayLabel: `${day === DAY ? 'today' : pretty(day)} ${new Date(p.mergedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` };
};
// Only repos that actually had merged PRs are kept
const mergedByRepo = cfg.repos.map((repo) => ({ repo, prs: mergedRaw.filter((x) => x.repo === repo).map(shapePr).sort((x, y) => y.mergedAt.localeCompare(x.mergedAt)) })).filter((r) => r.prs.length);

// Deeper analysis: what each merged PR depends on beyond its own repo
const flatMerged = mergedByRepo.flatMap((r) => r.prs.map((p) => ({ ...p, slug: slugOf(r.repo) })));
const depInfo = await analyzeMerged({ merged: flatMerged, gh });
const linkMap = await jiraLinks({ search, keys: flatMerged.flatMap((p) => p.keys) });
lap('PR files + dependencies');
for (const r of mergedByRepo) for (const p of r.prs) { p.deps = depInfo.get(`${p.repo}#${p.number}`) || { bumps: [], refs: [], siblings: [] }; delete p.body; }
const compOf = (repo) => (cfg.repoComponent || {})[repo] || repo;
const prsByKey = new Map();
for (const r of mergedByRepo) for (const p of r.prs) for (const k of p.keys) prsByKey.set(k, [...(prsByKey.get(k) || []), p]);
const deps = [];
const ledgerNow = loadLedger(); // release data we already hold: which components each release declares for a ticket
for (const [key, list] of prsByKey) {
  const repos = [...new Set(list.map((p) => p.repo))];
  const bumps = []; const refs = [];
  for (const p of list) {
    for (const b of p.deps.bumps) if (!bumps.some((x) => x.name === b.name && x.to === b.to && x.repo === p.repo)) bumps.push({ ...b, repo: p.repo });
    for (const rf of p.deps.refs) if (!refs.some((x) => x.slug === rf.slug && x.number === rf.number)) refs.push(rf);
  }
  const links = (linkMap.get(key) || []).filter((l) => !/clone/i.test(l.rel));
  const blockers = links.filter((l) => /blocked by|depends on/i.test(l.rel));
  // Release-declared dependencies: components the release description lists for this ticket, beyond what the merged PRs cover
  const covered = new Set(list.map((p) => canonComponent(compOf(p.repo))));
  const declared = releasesForTicket(ledgerNow, key).slice(0, 3).map(({ rec, rows }) => ({ release: rec.key, env: rec.env, date: rec.date, tenant: rec.tenant, status: rec.status, statusCategory: rec.statusCategory, components: componentList({ items: rows }) }));
  const needsOther = [];
  for (const dd of declared) for (const c of dd.components) if (!covered.has(canonComponent(c.name)) && !needsOther.some((x) => canonComponent(x.name) === canonComponent(c.name))) needsOther.push(c);
  if (repos.length < 2 && !bumps.length && !refs.length && !blockers.length && !needsOther.length) continue; // nothing cross-component to report
  const jt = kmap.get(key);
  deps.push({ key, summary: jt?.summary || '', status: jt?.status || '', statusCategory: jt?.statusCategory || '', prs: list.map((p) => ({ repo: p.repo, number: p.number, url: p.url, component: compOf(p.repo) })),
    components: [...new Set(list.map((p) => compOf(p.repo)))], bumps, refs, links, blockers, declared, needsOther });
}
deps.sort((x, y) => (y.blockers.length - x.blockers.length) || (y.components.length - x.components.length) || x.key.localeCompare(y.key));
// Attach cached AI analyses (pr-analysis/<repo>__<number>.json, written by Claude from pr-packet.mjs packets) and per-ticket dependency findings, for the PR modal
// Triage by rules: tiny PRs get a rules-only entry right here (no AI); everything else is marked light/deep for an AI read.
for (const r of mergedByRepo) for (const p of r.prs) {
  p.analysis = loadAnalysis(p.repo, p.number);
  if (!p.analysis) {
    const t = tierOf({ files: p.deps.files, bumps: p.deps.bumps, refs: p.deps.refs });
    p.tier = t.tier; p.tierWhy = t.why;
    if (t.tier === 'simple') { p.analysis = rulesEntry({ repo: p.repo, number: p.number, ticket: p.keys[0], files: p.deps.files, bumps: p.deps.bumps, today: DAY }); writeAnalysis(p.analysis); }
  }
}
for (const r of mergedByRepo) for (const p of r.prs) { p.ticketDeps = p.keys.map((k) => deps.find((t) => t.key === k)).filter(Boolean); }
// ---------------------------------------------------------------- Open PRs: scripted like the merged ones (no AI). Files/dependencies are cached per PR until it is updated (or 6 h pass).
const OPEN_CACHE = path.join(CACHE_DIR, 'open-prs.json');
const openCache = (() => { try { return JSON.parse(fs.readFileSync(OPEN_CACHE, 'utf8')); } catch { return {}; } })();
const openRaw = [];
await Promise.all(cfg.repos.map(async (repo) => {
  const slug = slugOf(repo);
  if (!slug) return;
  try { for (const p of await gh(['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '100', '--json', 'number,title,body,author,url,headRefName,baseRefName,createdAt,updatedAt,isDraft,reviewDecision'])) openRaw.push({ repo, slug, p }); }
  catch (e) { prErrors.push(`${repo} (open PRs): ${String(e.stderr || e.message).split('\n')[0]}`); }
}));
const openKeys = [...new Set(openRaw.flatMap(({ p }) => keysOf(p.title, p.headRefName)))].filter((k) => !kmap.has(k));
for (const c of chunk(openKeys, 80)) for (const t of (await search(`key in (${c.join(',')})`)).map(mapIssue)) kmap.set(t.key, t);
const openPrs = openRaw.map(({ repo, slug, p }) => ({ ...shapePr({ repo, p: { ...p, mergedAt: p.createdAt }, day: localDate(p.createdAt) }), slug, isDraft: !!p.isDraft, createdAt: p.createdAt, updatedAt: p.updatedAt, reviewDecision: p.reviewDecision || '' }));
const cacheFresh = (p) => { const c = openCache[`${p.repo}#${p.number}`]; return c && c.updatedAt === p.updatedAt && Date.now() - Date.parse(c.savedAt) < 6 * 3600 * 1000; };
const openFresh = await analyzeMerged({ merged: openPrs.filter((p) => !cacheFresh(p)), gh });
const openCacheNew = {};
for (const p of openPrs) {
  const id = `${p.repo}#${p.number}`;
  const e = openFresh.get(id) || openCache[id] || { bumps: [], refs: [], files: [] };
  p.deps = { bumps: e.bumps, refs: e.refs, files: e.files, siblings: [] };
  openCacheNew[id] = { updatedAt: p.updatedAt, savedAt: openFresh.get(id) ? nowIso : (openCache[id]?.savedAt || nowIso), bumps: e.bumps, refs: e.refs, files: e.files };
  delete p.body;
}
fs.writeFileSync(OPEN_CACHE, JSON.stringify(openCacheNew));
for (const p of openPrs) for (const k of p.keys) for (const o of openPrs) if (o.repo !== p.repo && o.keys.includes(k) && !p.deps.siblings.some((s) => s.repo === o.repo && s.number === o.number)) p.deps.siblings.push({ repo: o.repo, number: o.number, url: o.url, key: k });
const openLinkMap = await jiraLinks({ search, keys: openPrs.flatMap((p) => p.keys) });
const knownTen = [...new Set(Object.values(ledgerNow.releases || {}).flatMap((r) => r.tenants))];
const openRecords = openPrs.map((p) => {
  const t = tierOf({ files: p.deps.files, bumps: p.deps.bumps, refs: p.deps.refs });
  const analysis = loadAnalysis(p.repo, p.number) || (t.tier === 'simple' ? rulesEntry({ repo: p.repo, number: p.number, ticket: p.keys[0], files: p.deps.files, bumps: p.deps.bumps, today: DAY }) : null); // simple entries stay in memory: an open PR can still change
  const rec = { id: `${p.repo}#${p.number}`, repo: p.repo, component: compOf(p.repo), number: p.number, url: p.url, title: p.title, line1: p.line1, line2: p.line2, author: p.author, mergedAt: null,
    createdAt: p.createdAt, updatedAt: p.updatedAt, isDraft: p.isDraft, reviewDecision: p.reviewDecision, keys: p.keys, tickets: p.keys.map((k) => ({ key: k, summary: kmap.get(k)?.summary || '' })),
    tenants: [...new Set(p.keys.flatMap((k) => (kmap.get(k)?.clients || []).map(normTenant)))], files: p.deps.files, bumps: p.deps.bumps, refs: p.deps.refs, siblings: p.deps.siblings,
    links: p.keys.flatMap((k) => (openLinkMap.get(k) || []).filter((l) => /blocked by|depends on/i.test(l.rel))), declared: [], needsOther: [], analysis, tier: t.tier, tierWhy: t.why };
  if (!rec.tenants.length) rec.tenants = inferTenants(rec, knownTen);
  return rec;
});
lap('GitHub: open PRs + Jira');

// PR ledger: record every merged PR with its tickets, tenants, dependency facts and change understanding (for later questions / RAG)
const prLedger = loadPrLedger();
for (const r of mergedByRepo) for (const p of r.prs) {
  const td = p.ticketDeps;
  upsertPr(prLedger, { id: `${p.repo}#${p.number}`, repo: p.repo, component: compOf(p.repo), number: p.number, url: p.url, title: p.title, line1: p.line1, line2: p.line2, author: p.author, mergedAt: p.mergedAt, day: p.day, keys: p.keys,
    tickets: p.keys.map((k) => ({ key: k, summary: kmap.get(k)?.summary || '' })), tenants: [...new Set(p.keys.flatMap((k) => (kmap.get(k)?.clients || []).map(normTenant)))],
    files: p.deps.files, bumps: p.deps.bumps, refs: p.deps.refs, siblings: p.deps.siblings, links: td.flatMap((t) => t.blockers), declared: td.flatMap((t) => t.declared), needsOther: td.flatMap((t) => t.needsOther), analysis: p.analysis, tier: p.tier, tierWhy: p.tierWhy }, DAY);
}
const knownTenants = [...new Set(Object.values(ledgerNow.releases || {}).flatMap((r) => r.tenants))];
const prLedgerInfo = savePrLedger(prLedger, DAY, knownTenants);
const prRag = a['rag-dir'] ? copyPrsToRag(String(a['rag-dir']).replace(/^~/, os.homedir())) : null;

// ---------------------------------------------------------------- outputs
const fmtDay = new Date(`${DAY}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const d = {
  day: DAY, yesterday: YDAY, prettyDay: fmtDay, prettyYday: pretty(YDAY), generatedAt: new Date().toLocaleString('en-US'), jiraBase: JIRA_HOST, repos: cfg.repos,
  scope: { sprint: `Active ${cfg.sprintPrefix}`, component: comp === 'any' ? 'any' : (cfg.component || 'any') },
  completed, needs, mergedByRepo, deps,
  window: { since: winSince, until: winUntil, note: windowNote, sinceLabel: fmtTime(winSince), untilLabel: fmtTime(winUntil) },
};

const mdOut = [];
mdOut.push(`# Daily delivery summary — ${fmtDay}\n`);
mdOut.push(`Active ${cfg.sprintPrefix}, ${d.scope.component === 'any' ? 'all components' : d.scope.component + ' component'}. Releases dated ${pretty(YDAY)}: ${completed.length} (${completed.filter((g) => g.allDone).length} released). Tickets needing release today: ${needs.reduce((n, g) => n + g.tickets.length, 0)}. Merged PRs: ${mergedByRepo.reduce((n, r) => n + r.prs.length, 0)}.\n`);
mdOut.push(`## Completed releases (dated ${pretty(YDAY)})\n`);
mdOut.push(completed.length ? md(completed.map((g) => [g.tenant, g.tickets.map((t) => `[${t.key}](${jiraUrl(t.key)})${t.env ? ' ' + t.env : ''} ${t.done ? '✓' : '⚠'} ${t.status}`).join('; '), `${g.what}. ${explainRelease(g)}${g.notes ? ' Note: ' + trunc(g.notes, 140) : ''}`, componentText(componentList(g)) || '-']), ['Tenant', 'Release ticket', 'What was released', 'Components (version)']) : 'No release tickets dated that day.');
mdOut.push(`\n## Needs release today (${fmtDay})\n`);
if (!needs.length) mdOut.push('Nothing is waiting on a release dated today.');
for (const g of needs) {
  mdOut.push(`**${g.fixVersion}** — open release ticket: ${g.releaseTickets.length ? g.releaseTickets.map((r) => `${r.key}${r.env ? ' ' + r.env : ''} (${r.status})`).join(', ') : (g.releasedCount ? 'none open' : 'none yet')}${g.releasedCount ? ` · ${g.releasedCount} already released` : ''}\n`);
  mdOut.push(md(g.tickets.map((t) => [`[${t.key}](${jiraUrl(t.key)})`, trunc(t.summary, 80), t.status, t.assignee || 'unassigned']), ['Ticket', 'Summary', 'Status', 'Assignee']));
  mdOut.push('');
}
mdOut.push('\n## Merged PRs by repo\n');
if (!mergedByRepo.length) mdOut.push('No PRs merged in this period.\n');
for (const { repo, prs } of mergedByRepo) { // repos without merged PRs are not listed
  mdOut.push(`**${repo}** (${prs.length})\n`);
  mdOut.push(md(prs.map((p) => [`#${p.number}`, p.keys.join(', ') || '-', `${p.line1}${p.line2 ? ' — ' + p.line2 : ''}`, p.dayLabel, p.author]), ['PR', 'Ticket', 'What it builds', 'Merged', 'Author']));
  mdOut.push('');
}
mdOut.push('\n## Dependencies and cross-component links (merged PRs)\n');
mdOut.push(deps.length ? md(deps.map((t) => [`[${t.key}](${jiraUrl(t.key)}) ${trunc(t.summary, 50)}`, t.prs.map((p) => `${p.repo}#${p.number}`).join(', '),
  [...t.bumps.map((b) => `${b.name} ${b.from || 'new'}→${b.to || 'removed'} (${b.repo})`), ...t.refs.map((r) => `${r.slug.split('/')[1]}#${r.number} ${String(r.state).toLowerCase()}`)].join('; ') || '-',
  t.links.filter((l) => l.rel !== 'parent').slice(0, 4).map((l) => `${l.rel} ${l.key} (${l.status})`).join('; ') || '-',
  t.needsOther.length ? `release lists also: ${t.needsOther.map((c) => c.name + (c.version ? ' (' + c.version + ')' : '')).join(', ')}` : '-',
  `Ships with: ${t.components.join(' + ')}${t.blockers.some((b) => b.statusCategory !== 'Done') ? '; waiting on ' + t.blockers.filter((b) => b.statusCategory !== 'Done').map((b) => b.key).join(', ') : ''}`]), ['Ticket', 'PRs', 'Dependency changes', 'Jira links', 'Release also lists', 'Release implication']) : 'No cross-component dependencies found in the merged PRs.');
if (prErrors.length) mdOut.push(`\n_PR scan problems: ${prErrors.join('; ')}_`);

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.writeFileSync(path.join(CACHE_DIR, 'daily.md'), mdOut.join('\n') + '\n');
fs.writeFileSync(path.join(CACHE_DIR, 'daily.json'), JSON.stringify(d, null, 2));
if (a.html) fs.writeFileSync(path.join(CACHE_DIR, 'daily.html'), renderHtml(d)); // the HTML report is opt-in now; My Tracker reads the data file below

// Data for the My Tracker "Release & PRs" tabs (releases, to release today, merged PRs). No HTML.
const OUT_DIR = path.join(CACHE_DIR, 'data');
fs.mkdirSync(OUT_DIR, { recursive: true });
lap('ledgers + report build');
const delivery = buildDeliveryData({ ledger: loadLedger(), prLedger, openRecords, sprintIssues, day: DAY, window: d.window, helpers: { isRelease, isTest: isTestTicket, compOk } });
delivery.timing = { totalSec: Math.round((Date.now() - T0) / 100) / 10, stages: laps };
fs.writeFileSync(path.join(OUT_DIR, 'delivery.json'), JSON.stringify(delivery));

console.log(`Daily summary for ${DAY} (releases dated ${YDAY}; PRs ${windowNote}: ${fmtTime(winSince)} to ${fmtTime(winUntil)})`);
console.log(`  completed releases: ${completed.length} (${completed.filter((g) => g.allDone).length} released) · need release today: ${needs.reduce((n, g) => n + g.tickets.length, 0)} tickets in ${needs.length} fix versions`);
const prTotal = mergedByRepo.reduce((n, r) => n + r.prs.length, 0);
const prAnalyzed = mergedByRepo.reduce((n, r) => n + r.prs.filter((p) => p.analysis).length, 0);
console.log(`  merged PRs in this window: ${prTotal} in ${mergedByRepo.length} repos · ${prAnalyzed} have a change understanding`);
if (prTotal > prAnalyzed) console.log(`  ${prTotal - prAnalyzed} PRs still need analysis: run pr-packet.mjs --missing, have Claude write pr-analysis/*.json, then re-run with --rerender`);
console.log(`  PR ledger: ${prLedgerInfo.count} PRs tracked (${prLedgerInfo.analyzed} analyzed) in ${prLedgerInfo.dir}${prRag ? ` · copied ${prRag.files} files to ${prRag.dest}` : ''}`);
console.log(`  release ledger: ${ledgerInfo.count} releases tracked in ${ledgerInfo.dir}${rag ? ` · copied ${rag.files} files to ${rag.dest}` : ''}`);
console.log(`  open PRs: ${openRecords.length} · took ${delivery.timing.totalSec}s (${Object.entries(laps).map(([k, v]) => `${k} ${v}s`).join(', ')})`);
console.log(`  data for My Tracker: ${path.join(OUT_DIR, 'delivery.json')} (${delivery.releases.length} releases, ${delivery.toRelease.length} to release today, ${delivery.prs.length} PRs) | daily.md | daily.json${a.html ? ' | daily.html' : ''}`);
if (prErrors.length) console.log(`  PR scan problems: ${prErrors.join('; ')}`);
if (saveState) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ since: winSince, until: winUntil, day: DAY, savedAt: nowIso }, null, 2)); console.log(`  next run will cover PRs merged after ${fmtTime(winUntil)}`); }
