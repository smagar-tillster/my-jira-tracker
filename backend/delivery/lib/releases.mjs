// Release-ticket helpers: parse a Release ticket description (ADF) into tickets + software versions,
// and keep a ledger of releases (JSON + one markdown file per release, RAG-friendly) so past releases can be queried later.
import fs from 'node:fs';
import path from 'node:path';
import { search, mapIssue, FIELDS, PROJECT, jiraUrl } from './jira.mjs';
import { DATA_DIR } from './paths.mjs';

export const REL_DIR = path.join(DATA_DIR, 'releases');
const LEDGER = path.join(REL_DIR, 'ledger.json');
export const MD_DIR = path.join(REL_DIR, 'md');

export const keysIn = (s) => [...new Set((String(s || '').match(/NGK-\d+/gi) || []).map((k) => k.toUpperCase()))];

// ---------------------------------------------------------------- ADF -> text (smart links become their issue key)
export const adfText = (n) => {
  if (!n) return '';
  if (typeof n === 'string') return n;
  switch (n.type) {
    case 'text': return n.text || '';
    case 'hardBreak': return '\n';
    case 'inlineCard': case 'blockCard': case 'embedCard': return keysIn(n.attrs?.url).join(' ');
    case 'mention': return n.attrs?.text || '';
    case 'emoji': case 'media': case 'mediaInline': return '';
    default: break;
  }
  const inner = (n.content || []).map(adfText).join(n.type === 'tableRow' ? ' | ' : '');
  return ['paragraph', 'heading', 'listItem', 'tableRow', 'taskItem', 'codeBlock'].includes(n.type) ? inner + '\n' : inner;
};
const cellText = (c) => adfText(c).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const findTables = (n, out) => { if (!n || typeof n !== 'object') return; if (n.type === 'table') out.push(n); (n.content || []).forEach((c) => findTables(c, out)); };

// "FE: 1.294.0-16 / 1.294.0-14" -> {name:'FE', uat:'1.294.0-16', prod:'1.294.0-14'};  "MS: 26.166" -> {name:'MS', value:'26.166'}
const VERSION_LINE = /^\s*([A-Za-z][A-Za-z0-9 ._&-]{0,28}?)\s*[:=]\s*v?(\d[\w.\-]*)(?:\s*\/\s*v?(\d[\w.\-]*))?\s*$/;
const parseVersions = (text) => {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (/^\s*(uat|prod)\b/i.test(line)) continue;
    const m = line.match(VERSION_LINE);
    if (m) out.push(m[3] ? { name: m[1].trim(), uat: m[2], prod: m[3] } : { name: m[1].trim(), value: m[2] });
  }
  return out;
};
const dedupeVersions = (list) => {
  const seen = new Map();
  for (const v of list) { const k = v.name.toLowerCase(); if (!seen.has(k) || (v.uat && !seen.get(k).uat)) seen.set(k, v); }
  return [...seen.values()];
};

/** The release template has a table: Tickets | Components | UAT Version / PROD Version | Notes (or Tickets | Assets & versions). */
export const parseReleaseDescription = (adf) => {
  const text = adfText(adf);
  const tables = [];
  findTables(adf, tables);
  const rowsOut = [];
  let versions = [];
  for (const tb of tables) {
    const rows = (tb.content || []).filter((r) => r.type === 'tableRow');
    if (!rows.length) continue;
    const headTexts = (rows[0].content || []).map(cellText);
    if (!/ticket|tix/i.test(headTexts[0] || '')) continue; // checklist tables etc. are ignored
    const hdr = headTexts.map((t) => t.split('\n')[0].toLowerCase());
    headTexts.forEach((t) => { const extra = t.split('\n').slice(1).join('\n'); if (extra) versions.push(...parseVersions(extra)); });
    for (const row of rows.slice(1)) {
      const cells = (row.content || []).map(cellText);
      if (!cells.length) continue;
      const keys = keysIn(cells[0]);
      const rec = { keys, label: keys.length ? '' : cells[0].replace(/\s+/g, ' ').trim(), component: '', version: '', notes: '' };
      cells.slice(1).forEach((t, j) => {
        const h = hdr[j + 1] || '';
        const flat = t.replace(/\s*\n\s*/g, '; ').trim();
        if (/component|asset/.test(h)) rec.component = flat;
        else if (/version/.test(h)) rec.version = flat;
        else if (/note/.test(h)) rec.notes = flat;
        else rec.notes = [rec.notes, flat].filter(Boolean).join(' ');
      });
      if (keys.length || rec.label) rowsOut.push(rec);
    }
  }
  if (!versions.length) versions = parseVersions(text).filter((v) => /^(FE|SW|DS|DB|MS|WS|PA|TRSC|Menu|SkuMap|Kiosk|Menu Version|TCE Menu|Web Service)$/i.test(v.name));
  const tableKeys = new Set(rowsOut.flatMap((r) => r.keys));
  const m = text.match(/NOTES:?([\s\S]*?)(?:\bTIX\b|ASSETS|RELEASE CHECKLIST|DEFINITION OF READY|This release includes|$)/i);
  let notes = m ? m[1].replace(/<\/?HR>/gi, ' ').replace(/\s+/g, ' ').trim() : '';
  if (notes.length < 12 || /tickets? components|ticket key|asset\/version|uat version|prod version/i.test(notes)) notes = '';
  return { rows: rowsOut, versions: dedupeVersions(versions), otherKeys: keysIn(text).filter((k) => !tableKeys.has(k)), notes };
};

export const versionText = (v) => (v.uat || v.prod ? `${v.name} ${v.uat || '?'} / ${v.prod || '?'}` : `${v.name} ${v.value}`);

// ---------------------------------------------------------------- components (with versions) and a short plain-language explanation
const ALIAS = { fe: 'fe', kiosk: 'fe', ms: 'menuservice', kioskmenuservice: 'menuservice', menuservice: 'menuservice', ws: 'webservice', kioskwebservice: 'webservice', webservice: 'webservice', mobilem8webservice: 'webservice',
  ds: 'deviceservice', deviceservice: 'deviceservice', db: 'database', mobilem8database: 'database', database: 'database', pa: 'portaladmin', kioskportaladmin: 'portaladmin', portaladminapp: 'portaladmin', portaladmin: 'portaladmin',
  alc: 'avoltaloyaltyclient', avoltaloyaltyclient: 'avoltaloyaltyclient', trsc: 'recommender', tillsterrecommenderserviceclient: 'recommender', menuversion: 'menu', tcemenu: 'menu', menu: 'menu', skumap: 'skumap' };
const tidy = (s) => String(s).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').replace(/\s*[-–]\s*$/, '').trim();
const canon = (n) => { const k = tidy(n).toLowerCase().replace(/[^a-z0-9]/g, ''); return ALIAS[k] || k; };
// split on + & ; , but not inside parentheses: "OCC (Menu Metadata - Calories, Drink Tabs), FE" -> two items
const splitList = (s) => {
  const out = []; let depth = 0; let cur = '';
  for (const ch of String(s || '')) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[+&;,]/.test(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
export const fmtVersion = (v) => (v.uat || v.prod ? (v.uat && v.prod ? (v.uat === v.prod ? v.uat : `UAT ${v.uat} / PROD ${v.prod}`) : v.uat ? `UAT ${v.uat}` : `PROD ${v.prod}`) : v.value);

/** Components of a release group {titleComponents, components, items, versions}: Jira field + title + per-ticket components, each with its version if one is listed. */
export const componentList = (g) => {
  const out = new Map(); // canonical name -> { name, versions[] }
  const add = (label, version) => {
    label = tidy(label);
    if (!label || label.length > 40 || /^(see ticket|n\/a|none|tbd|-)$/i.test(label)) return; // template filler, not a component
    const k = canon(label);
    if (!out.has(k)) out.set(k, { name: label, versions: [] });
    if (version && !out.get(k).versions.includes(version)) out.get(k).versions.push(version);
  };
  const addToken = (t) => { const m = String(t).match(/^(.*?)\s*(?:[=:]|\s[-–]\s)\s*v?(\d[\w.\-]*)\s*$/); if (m) add(m[1], m[2]); else add(t, ''); }; // "FE = v1.294.0-2" -> FE (1.294.0-2)
  for (const c of g.components || []) addToken(c);
  for (const c of splitList(g.titleComponents)) addToken(c);
  for (const i of g.items || []) {
    for (const c of splitList(i.component)) addToken(c);
    for (const m of String(i.version || '').matchAll(/([A-Za-z][A-Za-z0-9 ._-]{0,24}?)\s*[:=]\s*v?(\d[\w.\-]*)/g)) add(m[1], m[2]);
  }
  for (const v of g.versions || []) add(v.name, fmtVersion(v));
  return [...out.values()].map((c) => ({ name: c.name, version: c.versions.length > 3 ? `${c.versions.slice(0, 3).join(', ')} +${c.versions.length - 3}` : c.versions.join(', ') }));
};
export const componentText = (list) => list.map((c) => (c.version ? `${c.name} (${c.version})` : c.name)).join(', ');

const shortTitle = (s) => String(s || '').replace(/^\s*\[[^\]]+\]\s*/, '').replace(/^\W*[A-Z0-9-]{2,8}(?:\s*\/\s*[A-Z0-9-]+)*\s*[:|]\s*/, '').replace(/^(FE|BE)\s*[:-]\s*/i, '').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
/** Two plain sentences on what a release contains: the tickets it carries and how they split by component. */
export const explainRelease = (g, max = 3) => {
  const items = g.items || [];
  if (!items.length) return 'No ticket list in the release description.';
  const keyed = items.filter((i) => i.key);
  const names = items.map((i) => (i.key ? shortTitle(i.summary || i.key) : i.label)).filter(Boolean);
  const byComp = {};
  for (const i of items) for (const c of splitList(i.component)) { const k = tidy(c); if (k && k.length <= 30) byComp[k] = (byComp[k] || 0) + 1; }
  const top = Object.entries(byComp).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`);
  return `Includes ${keyed.length || items.length} ${(keyed.length || items.length) === 1 ? 'ticket' : 'tickets'}: ${names.slice(0, max).map((n) => cut(n, 70)).join('; ')}${names.length > max ? `; +${names.length - max} more` : ''}.${top.length ? ` By component: ${top.join(', ')}.` : ''}`;
};

// ---------------------------------------------------------------- ledger (JSON) + per-release markdown (for RAG)
export const loadLedger = () => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return { updated: null, releases: {} }; } };

export const upsertRelease = (ledger, rec, onDay) => {
  const prev = ledger.releases[rec.key];
  const hist = prev?.statusHistory || [];
  if (!hist.length || hist[hist.length - 1].status !== rec.status) hist.push({ on: onDay, status: rec.status });
  ledger.releases[rec.key] = { ...rec, firstSeen: prev?.firstSeen || onDay, lastSeen: onDay, statusHistory: hist };
};

const cellMd = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

export const releaseMd = (r) => {
  const L = [];
  L.push(`# ${r.key} — ${r.tenant} — ${r.what || r.title} (${r.date})`);
  L.push('');
  L.push(`- Release ticket: ${r.key}${r.env ? ` [${r.env}]` : ''} — status: **${r.status}**${r.done ? ' (released)' : ' (not marked released)'}`);
  L.push(`- Tenant: ${r.tenants.join(', ')}`);
  L.push(`- Release date (from the ticket title, else its due date): ${r.date}`);
  L.push(`- Title: ${r.title}`);
  L.push(`- Components (title): ${r.titleComponents || '-'} · (Jira field): ${r.components.join(', ') || '-'}`);
  L.push(`- Software versions (UAT / PROD): ${r.versions.length ? r.versions.map(versionText).join('; ') : '-'}`);
  L.push(`- Owner: ${r.assignee || 'unassigned'} · Link: ${r.url}`);
  if (r.fixVersions?.length) L.push(`- Fix version(s) on the ticket: ${r.fixVersions.join('; ')}`);
  if (r.notes) L.push(`- Notes: ${r.notes}`);
  L.push('');
  L.push(`## Tickets in this release (${r.tickets.length})`);
  L.push('');
  if (!r.tickets.length) L.push('_No ticket table found in the description._');
  for (const t of r.tickets) L.push(`- ${t.key || t.label}${t.summary ? ` — ${t.summary}` : ''}${t.status ? ` [${t.status}]` : ''}${t.component ? ` · component: ${t.component}` : ''}${t.version ? ` · version: ${t.version}` : ''}${t.notes ? ` · notes: ${t.notes}` : ''}`);
  if (r.others?.length) {
    L.push('');
    L.push(`## Other tickets referenced in the description (${r.others.length})`);
    L.push('');
    for (const t of r.others) L.push(`- ${t.key}${t.summary ? ` — ${t.summary}` : ''}${t.status ? ` [${t.status}]` : ''}`);
  }
  L.push('');
  L.push('## Status history');
  L.push('');
  for (const h of r.statusHistory || []) L.push(`- ${h.on}: ${h.status}`);
  L.push('');
  L.push(`_First seen ${r.firstSeen}, last seen ${r.lastSeen}._`);
  return L.join('\n');
};

export const saveLedger = (ledger, today) => {
  fs.mkdirSync(MD_DIR, { recursive: true });
  ledger.updated = today;
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  const all = Object.values(ledger.releases).sort((a, b) => b.date.localeCompare(a.date) || a.tenant.localeCompare(b.tenant) || a.key.localeCompare(b.key));
  for (const r of all) fs.writeFileSync(path.join(MD_DIR, `${r.key}.md`), releaseMd(r));
  const idx = ['# NGK release ledger', '', `Updated ${today}. ${all.length} release tickets tracked (date = date in the release ticket title, else its due date; status = Jira status of the release ticket, which may lag the real deployment).`, '',
    '| Date | Tenant | Release ticket | Status | What | Components | Versions (UAT / PROD) | Tickets |', '|---|---|---|---|---|---|---|---|'];
  for (const r of all) idx.push(`| ${r.date} | ${cellMd(r.tenant)} | ${r.key}${r.env ? ` ${r.env}` : ''} | ${cellMd(r.status)} | ${cellMd(r.what)} | ${cellMd([r.titleComponents, r.components.join(', ')].filter(Boolean).join(' · '))} | ${cellMd(r.versions.slice(0, 6).map(versionText).join('; '))} | ${r.tickets.filter((t) => t.key).length} |`);
  fs.writeFileSync(path.join(REL_DIR, 'RELEASES.md'), idx.join('\n') + '\n');
  return { count: all.length, dir: REL_DIR };
};

/** One release can have a UAT/LAB ticket and a PROD ticket: merge release records with the same tenant, date and title into one group. */
export const groupReleases = (hits) => {
  const groups = new Map();
  for (const r of hits) {
    const k = `${r.tenant}|${r.date}|${r.what}`;
    if (!groups.has(k)) groups.set(k, { tenant: r.tenant, tenants: r.tenants, date: r.date, what: r.what, titleComponents: r.titleComponents, components: [], versions: [], tickets: [], items: [], notes: '', owner: '' });
    const g = groups.get(k);
    g.tickets.push({ key: r.key, env: r.env, status: r.status, statusCategory: r.statusCategory, done: r.done });
    for (const c of r.components) if (!g.components.includes(c)) g.components.push(c);
    for (const v of r.versions) if (!g.versions.some((x) => x.name.toLowerCase() === v.name.toLowerCase())) g.versions.push(v);
    for (const i of r.tickets) if (!g.items.some((x) => (x.key && x.key === i.key) || (!x.key && !i.key && x.label === i.label))) g.items.push(i);
    if (r.notes.length > g.notes.length) g.notes = r.notes;
    if (!g.owner && r.assignee) g.owner = r.assignee;
    if (r.titleComponents.length > g.titleComponents.length) g.titleComponents = r.titleComponents;
  }
  return [...groups.values()];
};

// ---------------------------------------------------------------- release-declared dependencies (ticket -> components, from the ledger)
export const canonComponent = (name) => canon(name);
/** Releases that carry a ticket, with the component/version rows the release description declares for it. Newest first. */
export const releasesForTicket = (ledger, key) => Object.values(ledger.releases || {})
  .filter((r) => (r.tickets || []).some((t) => t.key === key))
  .map((r) => ({ rec: r, rows: r.tickets.filter((t) => t.key === key) }))
  .sort((x, y) => y.rec.date.localeCompare(x.rec.date));

// ---------------------------------------------------------------- sync: Release tickets (Jira) -> ledger
// "[RELEASE] 2026.10.13_JM-UK: Menu(TCE) + SW + CONFIGs - Initial Implementation [UAT/LAB]" -> parts
export const parseSummary = (s) => {
  let x = s.replace(/^\s*\[RELEASE\]\s*/i, '').replace(/^\S+?_/, '');
  const env = (x.match(/\[([^\]]+)\]\s*$/) || [])[1] || '';
  x = x.replace(/\[[^\]]*\]\s*$/, '').trim();
  const colon = x.indexOf(':');
  const tenantTok = colon > 0 ? x.slice(0, colon).trim() : '';
  const rest = colon > 0 ? x.slice(colon + 1).trim() : x;
  const i = rest.indexOf(' - ');
  return { tenantTok, env, comps: i > 0 ? rest.slice(0, i).trim() : '', what: (i > 0 ? rest.slice(i + 3) : rest).replace(/(\s*\[[^\]]*\])+\s*$/, '').trim() };
};
/** A release ticket is dated by the date in its title, else its due date (never the fix version). */
export const dateOfRelease = (t) => { const m = t.summary.match(/(\d{4})[.-](\d{2})[.-](\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : t.due || null; };

const REL_FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'duedate', 'fixVersions', 'components', 'labels', 'description', 'parent', FIELDS.client, 'updated'];
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Fetch Release tickets dated minDate..maxDate, parse their descriptions (tickets + versions), look up the tickets they mention,
 * and upsert everything into the ledger (JSON + one markdown file per release). Returns the records and the raw lookups.
 * known: optional Map(key -> mapped issue) to avoid re-fetching tickets the caller already has.
 */
export const syncReleases = async ({ minDate, maxDate, day, aliases = {}, known = new Map() }) => {
  const normTenant = (t) => aliases[t] || t;
  const lookback = Math.max(30, Math.ceil((Date.now() - Date.parse(`${minDate}T00:00:00`)) / 86400000) + 7);
  const relRaw = await search(`project = ${PROJECT} AND issuetype = Release AND (updated >= -${lookback}d OR (duedate >= "${minDate}" AND duedate <= "${maxDate}")) ORDER BY key ASC`, REL_FIELDS);
  const relMapped = relRaw.map((raw) => ({ raw, t: mapIssue(raw) }));
  const recs = [];
  for (const { raw, t } of relMapped) {
    const date = dateOfRelease(t);
    if (!date || date > maxDate || date < minDate) continue;
    const ps = parseSummary(t.summary);
    const parsed = parseReleaseDescription(raw.fields.description);
    const tenants = [...new Set((t.clients.length ? t.clients : [ps.tenantTok.toUpperCase()]).filter(Boolean).map(normTenant))];
    recs.push({ key: t.key, url: jiraUrl(t.key), title: t.summary, what: ps.what || t.summary, env: ps.env, titleComponents: ps.comps, components: t.components,
      tenants: tenants.length ? tenants : ['(unclear tenant)'], tenant: tenants[0] || '(unclear tenant)', date, status: t.status, statusCategory: t.statusCategory, done: t.statusCategory === 'Done',
      assignee: t.assignee || '', fixVersions: t.fixVersions, versions: parsed.versions, rows: parsed.rows, otherKeys: parsed.otherKeys, notes: parsed.notes });
  }
  const kmap = new Map(known);
  const needKeys = [...new Set(recs.flatMap((r) => [...r.rows.flatMap((x) => x.keys), ...r.otherKeys]))].filter((k) => !kmap.has(k));
  for (const c of chunk(needKeys, 80)) for (const t of (await search(`key in (${c.join(',')})`)).map(mapIssue)) kmap.set(t.key, t);
  const tInfo = (k) => { const t = kmap.get(k); return t ? { summary: t.summary, status: t.status, statusCategory: t.statusCategory, assignee: t.assignee || '' } : {}; };
  for (const r of recs) {
    r.tickets = r.rows.flatMap((x) => (x.keys.length ? x.keys.map((k) => ({ key: k, ...tInfo(k), component: x.component, version: x.version, notes: x.notes })) : [{ key: null, label: x.label, component: x.component, version: x.version, notes: x.notes }]));
    r.others = r.otherKeys.map((k) => ({ key: k, ...tInfo(k) }));
  }
  const ledger = loadLedger();
  for (const r of recs) { const { rows, otherKeys, ...rec } = r; upsertRelease(ledger, rec, day); }
  const info = saveLedger(ledger, day);
  return { recs, relMapped, kmap, ledgerInfo: info, parseSummary };
};

/** Copy the markdown files to a RAG data-feed folder (only when the user supplies the path). */
export const copyToRag = (ragDir) => {
  const dest = path.join(ragDir, 'ngk-releases');
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(MD_DIR)) { fs.copyFileSync(path.join(MD_DIR, f), path.join(dest, f)); n++; }
  fs.copyFileSync(path.join(REL_DIR, 'RELEASES.md'), path.join(dest, 'RELEASES.md'));
  return { dest, files: n + 1 };
};
