// The defects knowledge base (my-rag/datafeeds/defects.csv) is a set of PATTERNS for pull-request reviews: which files a kind of defect touches.
// So a defect that touches only files an existing row already records teaches nothing and is not written. The app keeps the defects it analyzed
// in a local queue and, once a day, appends the new patterns to the feed and runs ingest.py once. No GitHub fetch and no model call: the row is
// built from the PR ledger (files, PR link, tenants) and the ticket (title, components, clients). A defect with no PR in the ledger is only
// ever part of the component analysis; it is not queued.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseCsv, toCsvLine } from '../../../delivery/lib/defectrow.mjs';
import { redactSecrets, reviewConfig } from '../../../delivery/lib/reviews.mjs';
import { CONFIG_FILE } from '../../../delivery/lib/paths.mjs';
import * as store from './store.js';

const TRIVIAL_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|pdf|md|txt)$)/i;
const kebab = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const splitFiles = (s) => String(s || '').split(/[\n;|]+/).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- settings
/** delivery/config.json "defectsKb": { disabled, hour } — the daily sync runs from `hour` (default 7, machine time) onwards. */
export const kbConfig = (readFile = (f) => fs.readFileSync(f, 'utf8')) => {
  let c = {};
  try { c = JSON.parse(readFile(CONFIG_FILE)).defectsKb || {}; } catch { /* defaults */ }
  const hour = Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23 ? c.hour : 7;
  return { disabled: !!c.disabled, hour };
};

/** Whether the daily sync is due: not disabled, past the hour, and not already run today. */
export const syncDue = ({ now, lastRunAt, hour, disabled = false }) =>
  !disabled && now.getHours() >= hour && (!lastRunAt || ymd(new Date(lastRunAt)) !== ymd(now));

// ---------------------------------------------------------------- candidates from the PR ledger
/** key -> the latest merged PR in the ledger that names it. Only what the ledger holds: nothing is fetched. */
export const ledgerIndex = (ledger) => {
  const idx = new Map();
  for (const pr of Object.values(ledger?.prs || {})) {
    for (const key of pr.keys || []) {
      const have = idx.get(key);
      if (!have || String(pr.mergedAt) > String(have.mergedAt)) idx.set(key, pr);
    }
  }
  return idx;
};

/** One queue candidate from a defect (a trend row) and its ledger PR, or null when the ledger has no PR for it or the PR touched no real files. */
export const candidateFor = (defect, pr) => {
  if (!pr) return null;
  const files = (pr.files || []).map((f) => (typeof f === 'string' ? f : f?.name)).filter((n) => n && !TRIVIAL_FILE.test(n)).slice(0, 12);
  if (!files.length) return null;
  return {
    key: defect.key, title: defect.summary || '', repo: pr.repo, prNumber: pr.number, prUrl: pr.url || '', prTitle: pr.title || '',
    files, components: defect.components?.length ? defect.components : (defect.component ? [defect.component] : []),
    tenants: defect.clients?.length ? defect.clients : (pr.tenants || []), category: defect.category || '', resolved: String(defect.resolved || '').slice(0, 10),
    related: (pr.keys || []).filter((k) => k !== defect.key),
  };
};

// ---------------------------------------------------------------- the row, and the pattern test
/** The feed row for a candidate. Fields that need the diff or the model (root cause, functions, repro, test case) are left empty, not guessed. */
export const buildKbRow = (c, today) => {
  const t = (v, n) => redactSecrets(clip(v, n)).text;
  const tags = [kebab(c.category), ...c.components.map(kebab)].filter(Boolean);
  return {
    jira_id: c.key, title: t(c.title, 160), status: 'fixed', repo: c.repo, tenant_scope: t(c.tenants.join(', '), 120), tags: [...new Set(tags)].join(', '),
    symptom: t(c.title, 300), root_cause: '', fingerprint_files: c.files.join('\n'), fingerprint_functions_config: '', repro_steps: '', test_case: '',
    fix_summary: [t(c.prTitle, 300), c.prUrl ? `PR: ${c.prUrl}` : ''].filter(Boolean).join(' — '), related_tickets: c.related.join(', '), date_logged: today,
  };
};

/**
 * The feed row that already records this pattern, or null: every real file the defect touched is listed in one existing row (same repo).
 * Such a defect adds nothing for a review to match on. Full paths only: a shared file name alone is not a pattern.
 */
export const patternMatch = (feedRows, c) => {
  const mine = c.files.map((f) => f.toLowerCase());
  if (!mine.length) return null;
  for (const r of feedRows) {
    if (r.repo && c.repo && String(r.repo).toLowerCase() !== String(c.repo).toLowerCase()) continue;
    const theirs = new Set(splitFiles(r.fingerprint_files).map((f) => f.toLowerCase()));
    if (mine.every((f) => theirs.has(f))) return r.jira_id || '(a row)';
  }
  return null;
};

// ---------------------------------------------------------------- ingest
export const ingestPaths = (ragRoot) => ({ python: path.join(ragRoot, '.venv', 'bin', 'python'), script: path.join(ragRoot, 'ingest.py') });

/** Runs ingest.py once with the RAG's own Python. Never throws: { ok, reason }. `spawnFn` is replaced in tests. */
export const runIngest = ({ ragRoot, timeoutMs = 600000, spawnFn = spawn, exists = fs.existsSync }) => new Promise((resolve) => {
  const { python, script } = ingestPaths(ragRoot);
  if (!exists(python) || !exists(script)) return resolve({ ok: false, reason: 'ingest.py or the RAG virtual environment was not found' });
  let out = ''; let done = false;
  const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
  let child;
  try { child = spawnFn(python, [script], { cwd: ragRoot, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, reason: String(e.message || e).slice(0, 200) }); }
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, reason: `ingest took longer than ${Math.round(timeoutMs / 60000)} minutes` }); }, timeoutMs);
  child.stdout?.on('data', (d) => { out += d; }); child.stderr?.on('data', (d) => { out += d; });
  child.on('error', (e) => finish({ ok: false, reason: String(e.message || e).slice(0, 200) }));
  child.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, reason: `ingest exited with code ${code}: ${out.trim().split('\n').slice(-1)[0] || ''}`.slice(0, 240) }));
});

// ---------------------------------------------------------------- queue and sync
/** Queues the defects in view that have a PR in the ledger. Returns { queued, noPr }. Called when someone runs the AI analysis. */
export const queueDefects = ({ defects, ledger, categorize, now = () => new Date() }) => {
  const idx = ledgerIndex(ledger);
  const candidates = []; let noPr = 0;
  for (const d of defects) {
    const c = candidateFor({ ...d, category: categorize(d, idx.get(d.key)) }, idx.get(d.key));
    if (c) candidates.push(c); else noPr++;
  }
  return { queued: store.kbQueue(candidates, now().toISOString()), noPr };
};

/**
 * The daily sync. Appends the new patterns to the feed (never rewrites it), marks the rest, then runs ingest once if anything was written
 * or an earlier ingest failed. The feed must exist with a header: if it does not, nothing is written and the queue stays for the next run.
 */
export const syncKb = async ({ ragRoot = reviewConfig().ragRoot, now = () => new Date(), ingest = runIngest } = {}) => {
  const at = now().toISOString();
  const state = store.kbState();
  const file = path.join(ragRoot, 'datafeeds', 'defects.csv');
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* handled below */ }
  const feed = text === null ? null : parseCsv(text);
  const result = { at, written: 0, matched: 0, exists: 0, pending: 0, ingest: 'none', reason: '' };
  if (!feed?.header?.length) {
    result.reason = 'The defects feed was not found, so nothing was written. The queue is kept for the next run.';
    result.pending = store.kbPending().length;
    store.kbSaveRun({ at, result, ingestPending: state.ingestPending });
    return { ok: false, ...result };
  }
  const known = new Set(feed.rows.map((r) => String(r.jira_id).trim().toUpperCase()));
  const rows = [...feed.rows]; const lines = []; const today = ymd(now());
  for (const c of store.kbPending()) {
    if (known.has(c.key.toUpperCase())) { store.kbMark(c.key, 'exists', at, 'already in the feed'); result.exists++; continue; }
    const m = patternMatch(rows, c);
    if (m) { store.kbMark(c.key, 'matched', at, `same files as ${m}`); result.matched++; continue; }
    const row = buildKbRow(c, today);
    lines.push(toCsvLine(row, feed.header)); rows.push(row); known.add(c.key.toUpperCase());
    store.kbMark(c.key, 'written', at, null); result.written++;
  }
  if (lines.length) fs.appendFileSync(file, `${text.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`);
  let ingestPending = state.ingestPending;
  if (lines.length || state.ingestPending) {
    const r = await ingest({ ragRoot });
    result.ingest = r.ok ? 'ok' : 'failed'; if (!r.ok) result.reason = r.reason;
    ingestPending = !r.ok;
  }
  store.kbSaveRun({ at, result, ingestPending });
  return { ok: true, ...result };
};

export const kbStatus = () => ({ ...store.kbCounts(), ...(() => { const s = store.kbState(); return { lastRunAt: s.lastRunAt, lastResult: s.lastResult, ingestPending: s.ingestPending }; })() });
