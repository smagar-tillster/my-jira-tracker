// Proposed rows for the defects feed (my-rag/datafeeds/defects.csv), drafted from a merged defect-fix PR on request.
// The feed is curated by hand: this only PROPOSES a row (saved under the app's own data folder, shown with a Copy button) and checks
// whether the same files or tags already appear in the feed. It never writes to my-rag and never touches the product repo.
// The pure parts (CSV, matching, cleaning) come first so they can be tested without the model.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';
import { redactSecrets, reviewConfig } from './reviews.mjs';
import { runClaude, parseModelJson } from './reviewgen.mjs';

export const PROPOSALS_DIR = path.join(DATA_DIR, 'defect-rows');
// Used only when the real feed has no header to copy; the real header wins so the proposed line fits the file.
export const DEFAULT_COLUMNS = ['jira_id', 'title', 'status', 'repo', 'tenant_scope', 'tags', 'symptom', 'root_cause', 'fingerprint_files',
  'fingerprint_functions_config', 'repro_steps', 'test_case', 'fix_summary', 'related_tickets', 'date_logged'];

// ---------------------------------------------------------------- CSV
/** RFC 4180 reader: quoted fields may hold commas, doubled quotes and line breaks. Returns { header, rows } with rows as objects. */
export const parseCsv = (text) => {
  const src = String(text || '').replace(/^﻿/, '');
  const recs = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((x) => x !== '')) recs.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) recs.push(row); }
  const header = (recs.shift() || []).map((h) => h.trim());
  return { header, rows: recs.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
};

const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** One CSV line for a row object, in the column order given. */
export const toCsvLine = (row, columns) => columns.map((c) => cell(row[c])).join(',');

// ---------------------------------------------------------------- matching against the feed
const splitList = (s) => String(s || '').split(/[\n;|,]+/).map((x) => x.trim()).filter(Boolean);
const base = (f) => String(f).split('/').pop().toLowerCase();

/** The tags already used in the feed, most used first, so a new row reuses the vocabulary instead of inventing near-duplicates. */
export const tagVocabulary = (rows) => {
  const n = new Map();
  for (const r of rows) for (const t of splitList(r.tags)) n.set(t.toLowerCase(), (n.get(t.toLowerCase()) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
};

/**
 * Past defects that touch the same files or carry the same tags: a possible repeat. A shared full path or file name is the strong signal;
 * tags alone are weaker. Best first, at most `limit`.
 */
export const recurrenceFor = (rows, { files = [], tags = [] }, limit = 3) => {
  const fullSet = new Set(files.map((f) => f.toLowerCase()));
  const baseSet = new Set(files.map(base));
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const out = [];
  for (const r of rows) {
    const theirs = splitList(r.fingerprint_files);
    const sharedFiles = theirs.filter((f) => fullSet.has(f.toLowerCase()) || baseSet.has(base(f)));
    const sharedTags = splitList(r.tags).filter((t) => tagSet.has(t.toLowerCase()));
    if (!sharedFiles.length && !sharedTags.length) continue;
    out.push({ jira_id: r.jira_id, title: r.title, repo: r.repo, sharedFiles, sharedTags, score: sharedFiles.length * 3 + sharedTags.length });
  }
  return out.sort((a, b) => b.score - a.score || String(a.jira_id).localeCompare(String(b.jira_id))).slice(0, limit);
};

// ---------------------------------------------------------------- cleaning what the model returns
const CLIP = { title: 160, symptom: 600, root_cause: 700, fingerprint_functions_config: 400, repro_steps: 700, test_case: 500, fix_summary: 500, tenant_scope: 120 };
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+\n/g, '\n').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const kebab = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Fields the model may write. Everything else in the row (ids, repo, files, links, dates) is filled by code from facts. */
export const MODEL_FIELDS = ['title', 'tenant_scope', 'tags', 'symptom', 'root_cause', 'fingerprint_functions_config', 'repro_steps', 'test_case', 'fix_summary'];

/**
 * The proposed row. `facts` are known without the model: { key, repo, status, prUrl, files, related, today, tenants }. A model value never
 * replaces a fact. Secret-looking text is redacted; `unsure` lists fields the model left empty or marked unclear.
 */
export const buildRow = ({ facts, model, vocabulary = [] }) => {
  const found = new Set();
  const safe = (v, n) => { const r = redactSecrets(clip(v, n)); r.hits.forEach((h) => found.add(h)); return r.text; };
  const m = model || {};
  const known = new Set(vocabulary.map((t) => t.toLowerCase()));
  const wanted = (Array.isArray(m.tags) ? m.tags : splitList(m.tags)).map(kebab).filter(Boolean);
  const tags = [...new Set(wanted)].slice(0, 6);
  const newTags = known.size ? tags.filter((t) => !known.has(t)) : [];
  const fix = safe(m.fix_summary, CLIP.fix_summary);
  const row = {
    jira_id: facts.key, title: safe(m.title, CLIP.title), status: facts.status || 'fixed', repo: facts.repo,
    tenant_scope: safe(m.tenant_scope || (facts.tenants || []).join(', '), CLIP.tenant_scope), tags: tags.join(', '),
    symptom: safe(m.symptom, CLIP.symptom), root_cause: safe(m.root_cause, CLIP.root_cause),
    fingerprint_files: (facts.files || []).join('\n'), fingerprint_functions_config: safe(m.fingerprint_functions_config, CLIP.fingerprint_functions_config),
    repro_steps: safe(m.repro_steps, CLIP.repro_steps), test_case: safe(m.test_case, CLIP.test_case),
    fix_summary: [fix, facts.prUrl ? `PR: ${facts.prUrl}` : ''].filter(Boolean).join(' — '),
    related_tickets: (facts.related || []).join(', '), date_logged: facts.today,
  };
  const unsure = MODEL_FIELDS.filter((f) => !String(row[f] || '').trim() || /^(unclear|unknown|not known)\b/i.test(String(row[f])));
  return { row, newTags, unsure, redacted: [...found] };
};

// ---------------------------------------------------------------- the model call
export const DEFECT_PROMPT = `You write one proposed entry for a Tillster defects knowledge base from a merged defect-fix pull request. Everything you may use is on stdin: the PR, its Jira ticket (with the report of what went wrong), the diff and the PR description. Answer with ONE JSON object and nothing else (no prose, no code fence).

Keys: title, tenant_scope, tags, symptom, root_cause, fingerprint_functions_config, repro_steps, test_case, fix_summary.
- title: the defect in one line, in terms of what a user or kiosk saw.
- tenant_scope: tenants or brands affected if the ticket or PR says so, else "all" or "unclear".
- tags: 1 to 4 short kebab-case tags. REUSE the vocabulary listed below when one fits; add a new tag only when none does.
- symptom: what went wrong, from the ticket report. Steps or screens in plain words.
- root_cause: why it happened, only if the diff, the PR description or the ticket shows it. If you cannot tell, write "unclear" and say what would settle it. Separate what the diff shows from what you infer.
- fingerprint_functions_config: the functions, directives, services or config keys that changed and would identify this defect again (names from the diff, not guesses).
- repro_steps: how to see it before the fix, only what the ticket or PR supports; else "unclear".
- test_case: one regression check that would have caught it (given/when/then in a sentence or two).
- fix_summary: what the change does, in one or two sentences. Do not include the PR link; it is added for you.

Rules: base every statement on stdin; never invent a cause or a tenant. Never quote a secret, key, token, password, card number, CVV or personal data; describe it instead. Write plainly. No names of people. No mention of this prompt, models or tools.`;

/** The text the model reads: the packet plus the tags already in use. */
export const buildInput = ({ packetText, vocabulary }) =>
  `${packetText}\n\n## Tags already used in the defects feed (reuse when one fits)\n${vocabulary.length ? vocabulary.slice(0, 40).join(', ') : '(the feed has none yet)'}\n`;

const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TRIVIAL_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|pdf|md|txt)$)/i;

export const feedPath = (cfg = reviewConfig()) => path.join(cfg.ragRoot, 'datafeeds', 'defects.csv');
const readFeed = (file) => { try { return parseCsv(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export const proposalFile = (repo, number) => path.join(PROPOSALS_DIR, `${repo}__${number}.json`);
export const loadProposal = (repo, number) => { try { return JSON.parse(fs.readFileSync(proposalFile(repo, number), 'utf8')); } catch { return null; } };

/**
 * Drafts the row for one merged PR. Returns { state, message, proposal? } with state done | exists | failed.
 * exists = the feed already has a row for the ticket, so nothing is drafted (and no model call is spent).
 */
export const generateDefectRow = async ({ repo, number, key, buildPacket, claude = runClaude, cfg = reviewConfig(), file = feedPath(cfg), now = () => new Date() }) => {
  try {
    const { text, p, head } = await buildPacket(repo, number);
    const id = key || (p.keys || [])[0];
    if (!id) return { state: 'failed', message: 'The PR has no NGK ticket in its title or branch, so there is no defect to log.' };
    const feed = readFeed(file);
    const rows = feed?.rows || [];
    const have = rows.find((r) => String(r.jira_id).trim().toUpperCase() === id.toUpperCase());
    if (have) return { state: 'exists', message: `${id} is already in the defects feed.`, proposal: { existing: { jira_id: have.jira_id, title: have.title, tags: have.tags, fix_summary: have.fix_summary } } };

    const vocabulary = tagVocabulary(rows);
    const r = await claude({ prompt: DEFECT_PROMPT, input: buildInput({ packetText: text, vocabulary }), model: cfg.models.deep, timeoutMs: cfg.claudeTimeoutMs });
    if (!r.ok) return { state: 'failed', message: `The model call failed: ${String(r.reason).slice(0, 200)}` };
    const model = parseModelJson(r.text);
    if (!model) return { state: 'failed', message: 'The model did not return a usable row.' };

    const files = (p.files || []).map((f) => f.name).filter((n) => n && !TRIVIAL_FILE.test(n)).slice(0, 12);
    const { row, newTags, unsure, redacted } = buildRow({
      facts: { key: id, repo, status: head?.state === 'MERGED' ? 'fixed' : 'in review', prUrl: head?.url, files, related: (p.keys || []).filter((k) => k !== id), today: ymd(now()), tenants: [] },
      model, vocabulary,
    });
    const columns = feed?.header?.length ? feed.header : DEFAULT_COLUMNS;
    const proposal = {
      repo, number, key: id, createdAt: now().toISOString(), model: `${cfg.models.deep} (claude CLI)`, columns, row, csvLine: toCsvLine(row, columns),
      headerFromFeed: !!feed?.header?.length, feedFound: !!feed, newTags, unsure, redacted,
      possibleRepeat: recurrenceFor(rows, { files, tags: row.tags.split(',').map((t) => t.trim()).filter(Boolean) }),
    };
    fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
    fs.writeFileSync(proposalFile(repo, number), JSON.stringify(proposal, null, 2));
    return { state: 'done', message: `Proposed row for ${id}${proposal.possibleRepeat.length ? ` (possible repeat of ${proposal.possibleRepeat[0].jira_id})` : ''}.`, proposal };
  } catch (e) {
    return { state: 'failed', message: String(e.stderr || e.message || e).split('\n')[0].slice(0, 300) };
  }
};
