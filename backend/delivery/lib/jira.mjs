// Zero-dependency Jira helper (Node 18+ built-ins only). Shared by all ngk-sprint scripts.
// Credentials come from process env, JIRA_ENV_FILE, or the MyTracker backend/.env. Never printed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR, BACKEND_ENV_FILE } from './paths.mjs';

export const CACHE_DIR = path.join(DATA_DIR, '.cache');

export const FIELDS = {
  client: 'customfield_16047',
  uat: 'customfield_16050',
  sprint: 'customfield_10007',
  qaNotes: 'customfield_17249',
};

const parseEnv = (file) => {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; } // missing or unreadable (e.g. sandbox deny)
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
};

const loadEnv = () => {
  const home = process.env.MYTRACKER_DIR || path.join(os.homedir(), 'Documents/git/projects/my-jira-tracker');
  const candidates = [process.env.JIRA_ENV_FILE, BACKEND_ENV_FILE, path.join(home, 'backend/.env')];
  for (const f of candidates.filter(Boolean)) {
    const parsed = parseEnv(f);
    if (parsed.JIRA_API_TOKEN) return { ...parsed, ...process.env };
  }
  return { ...process.env };
};

const ENV = loadEnv();
export const JIRA_HOST = (ENV.JIRA_HOST || '').replace(/\/$/, '');
export const TRACKER_API = ENV.TRACKER_API_URL || `http://localhost:${ENV.PORT || 3050}/api`;
export const PROJECT = ENV.JIRA_PROJECT_KEY || 'NGK';
export const SPRINT_FILTER = ENV.JIRA_FILTER_ID_SPRINT || '';

const AUTH = `Basic ${Buffer.from(`${ENV.JIRA_EMAIL}:${ENV.JIRA_API_TOKEN}`).toString('base64')}`;

export const jira = async (method, url, body) => {
  if (!JIRA_HOST || !ENV.JIRA_EMAIL || !ENV.JIRA_API_TOKEN) {
    throw new Error('Missing JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN (set in env or backend/.env)');
  }
  const res = await fetch(`${JIRA_HOST}/rest/api/3${url}`, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${method} ${url} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
};

/** Jira Software (agile) API: boards and sprints. Same credentials, different base path. */
export const jiraAgile = async (method, url) => {
  if (!JIRA_HOST || !ENV.JIRA_EMAIL || !ENV.JIRA_API_TOKEN) throw new Error('Missing JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN (set in env or backend/.env)');
  const res = await fetch(`${JIRA_HOST}/rest/agile/1.0${url}`, { method, headers: { Authorization: AUTH, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira agile ${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

export const SEARCH_FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee', 'duedate', 'fixVersions', 'components',
  'labels', 'created', 'updated', 'parent', 'statuscategorychangedate', FIELDS.client, FIELDS.uat, FIELDS.sprint,
];

/** Paginated JQL search (nextPageToken). Retries the known flaky empty first page. */
export const search = async (jql, fields = SEARCH_FIELDS, max = Infinity) => {
  const all = [];
  let token = null;
  let emptyRetries = 0;
  for (;;) {
    const body = { jql, maxResults: 100, fields };
    if (token) body.nextPageToken = token;
    const data = await jira('POST', '/search/jql', body);
    if (!data.issues?.length && all.length === 0 && emptyRetries < 5) {
      emptyRetries++;
      await new Promise((r) => setTimeout(r, 500 * emptyRetries));
      continue;
    }
    all.push(...(data.issues || []));
    token = data.nextPageToken;
    if (data.isLast || !token || !data.issues?.length || all.length >= max) break;
  }
  return all.slice(0, max);
};

const releaseFrom = (text) => {
  const m = (text || '').match(/(\d{4})[.-](\d{2})[.-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const unescape = (t) => String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export const mapIssue = (i) => {
  const f = i.fields;
  const sprints = Array.isArray(f[FIELDS.sprint]) ? f[FIELDS.sprint] : [];
  const releases = (f.fixVersions || []).map((v) => releaseFrom(v.name)).filter(Boolean);
  return {
    key: i.key,
    summary: unescape(f.summary),
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.name || '',
    type: f.issuetype?.name || '',
    priority: f.priority?.name || '',
    assignee: f.assignee?.displayName || null,
    due: f.duedate || null,
    uat: f[FIELDS.uat] || null,
    release: releases.sort()[0] || releaseFrom(f.summary), // fixVersion date, else "[RELEASE] 2026.10.12_" in summary
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    fixVersionsFull: (f.fixVersions || []).map((v) => ({ name: v.name, date: releaseFrom(v.name) || v.releaseDate || null, released: !!v.released })),
    components: (f.components || []).map((c) => c.name),
    labels: f.labels || [],
    clients: (f[FIELDS.client] || []).map((c) => c.value),
    parentKey: f.parent?.key || null,
    sprints: sprints.map((s) => ({ name: s.name, state: s.state })), // state: active | future | closed
    sprint: sprints.filter((s) => s.state !== 'closed').map((s) => s.name).join(', '), // open/future only; closed history is noise
    created: f.created?.slice(0, 10),
    updated: f.updated?.slice(0, 10),
    statusChanged: f.statuscategorychangedate?.slice(0, 10) || null,
  };
};

/** Repo rule: Ready for QA is treated as done for risk/reporting. */
export const isDoneType = (t) => t.statusCategory === 'Done' || t.status === 'Ready for QA';
export const isClosed = (t) => t.statusCategory === 'Done';

// Local calendar date (the user's "today"), not UTC; UTC would roll to tomorrow in the US evening.
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

export const adfDoc = (text) => ({
  type: 'doc',
  version: 1,
  content: String(text).split(/\n{2,}/).map((p) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: p }],
  })),
});

export const snapshotPath = () => path.join(CACHE_DIR, 'snapshot.json');
export const loadSnapshot = () => {
  if (!fs.existsSync(snapshotPath())) throw new Error('No snapshot yet. Run scripts/snapshot.mjs first.');
  return JSON.parse(fs.readFileSync(snapshotPath(), 'utf8'));
};
export const saveJson = (name, data) => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const p = path.join(CACHE_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
};

export const parseArgs = (argv) => {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
};

export const md = (rows, headers) => {
  const esc = (v) => String(v ?? '-').replace(/\|/g, '/').replace(/\n/g, ' ');
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
};

export const jiraUrl = (key) => `${JIRA_HOST}/browse/${key}`;

// ---- Client-suggestion lookup: small aggregate, cached 7 days (.cache/universe.json) ----
// clients: all valid Client option values (field options API; falls back to a recent sample).
// tokens: leading title token -> { client: count }, learned from the newest SAMPLE client-labelled tickets.
// Leading title code (e.g. RCUSSD, RBE, TI-XX). Only ALL-CAPS tokens count, so words like "Kiosk"/"Move" are ignored.
export const leadToken = (s) => {
  const raw = (String(s).match(/^\W*([A-Za-z]{2,10}(?:-?[A-Za-z0-9]{1,4})?)[-\s:|]/) || [])[1];
  return raw && raw === raw.toUpperCase() ? raw : null;
};
const SAMPLE = 1500;

export const loadUniverse = async ({ refresh = false, skip = false } = {}) => {
  if (skip) return { clients: [], tokens: {}, note: 'skipped' };
  const file = path.join(CACHE_DIR, 'universe.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!refresh && c.version === 2 && Date.now() - new Date(c.takenAt) < 7 * 86400000) return { ...c, note: `cached ${c.takenAt.slice(0, 10)}` };
  } catch {}

  const clients = new Set();
  try { // cheap: the field's option list
    const ctxs = (await jira('GET', `/field/${FIELDS.client}/context`)).values || [];
    for (const ctx of ctxs) {
      let start = 0;
      for (;;) {
        const r = await jira('GET', `/field/${FIELDS.client}/context/${ctx.id}/option?startAt=${start}&maxResults=100`);
        (r.values || []).forEach((o) => !o.disabled && clients.add(o.value));
        if (r.isLast || !(r.values || []).length) break;
        start += r.values.length;
      }
    }
  } catch {}
  const sample = (await search(`project = ${PROJECT} AND cf[16047] is not EMPTY ORDER BY updated DESC`, ['summary', FIELDS.client], SAMPLE)).map(mapIssue);
  const tokens = {};
  for (const u of sample) {
    u.clients.forEach((c) => clients.add(c));
    const tok = leadToken(u.summary);
    if (tok && u.clients[0]) {
      tokens[tok] ||= {};
      tokens[tok][u.clients[0]] = (tokens[tok][u.clients[0]] || 0) + 1;
    }
  }
  const out = { version: 2, takenAt: new Date().toISOString(), clients: [...clients].sort(), tokens };
  saveJson('universe.json', out);
  return { ...out, note: `fetched (${out.clients.length} clients, ${sample.length} sampled tickets)` };
};
