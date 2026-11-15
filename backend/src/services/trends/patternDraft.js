// Drafting a NEW defect pattern for the RAG (docs/defects/<id>.md) from a cluster of defects that touch the same files. One model call, only when
// someone clicks Draft pattern. The result is a DRAFT: it is checked against the same rules the RAG's own tests enforce, saved in this app's data
// folder, shown for review, and never written into the RAG by this code. A person reads it, fixes it, and copies it into docs/defects.
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../../../delivery/lib/reviews.mjs';
import { runClaude, parseModelJson } from '../../../delivery/lib/reviewgen.mjs';
import { DATA_DIR } from '../../../delivery/lib/paths.mjs';

export const MODEL = 'sonnet';
export const TIMEOUT_MS = 180000;
export const DRAFTS_DIR = path.join(DATA_DIR, 'defect-patterns');
export const MAX_BODY_LINES = 20;
export const MAX_EXAMPLE_LINES = 5;
const WIDTH = 100;

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const safe = (s, n) => redactSecrets(clip(s, n)).text;
const kebab = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export const PROMPT = `You write one entry for a Tillster defect-pattern knowledge base used when reviewing pull requests. On stdin are defects that were fixed by changing the same files, with their titles, short descriptions and the files, and the capability names you may use. Answer with ONE JSON object and nothing else (no prose, no code fence).

First decide whether this is a pattern worth recording. Record one only when ALL are true: a reviewer could plausibly miss it again; CI, lint or the compiler would not already catch it; and it can be stated as a smell (what to look for in a diff) and a check (what to ask), in a few lines. If it is not (the defects are unrelated, a one-off, or only share a busy file), answer {"notAPattern": true, "reason": "<one short sentence>"} and stop.

Otherwise answer {"name","title","capabilities","keywords","smell","why","check","example"}:
- name: the pattern id, lowercase words joined by hyphens, at most 60 characters.
- title: a short name of the mistake, in one line.
- capabilities: one or two names, copied exactly from the list on stdin; use [] if none fits.
- keywords: three to six words a reviewer would search for, taken from the defects or the files.
- smell: what to look for in a diff, in terms of code or configuration shape. At most 240 characters.
- why: the consequence, at most 240 characters.
- check: the question a reviewer asks, or the search they run, before approving. At most 300 characters.
- example: optional, at most four short lines, naming a ticket if it helps. No card data, secrets, customer data or real order payloads. Use "" for none.
Rules: base everything on stdin; never invent a cause, a ticket or a file. State the pattern in general terms (the shape of the mistake), not as the history of one ticket. Never quote a secret, token, password, card number or personal data. No names of people. Write plainly.`;

/** What the model reads. Descriptions and titles are scrubbed and clipped. */
export const buildInput = ({ cluster, tickets, capabilities, existingIds }) => JSON.stringify({
  repo: cluster.repo, files: cluster.files, mostlyCategory: cluster.category,
  defects: tickets.map((t) => ({ key: t.key, title: safe(t.title, 140), description: safe(t.description, 360), pullRequest: safe(t.prTitle, 120) })),
  capabilityNames: capabilities, existingPatternIds: existingIds,
});

/** The checked draft, or { notAPattern, reason }, or null when the answer is unusable. Unknown capability names are dropped, texts clipped. */
export const parseDraft = (json, { capabilities = [], existingIds = [] } = {}) => {
  if (!json || typeof json !== 'object') return null;
  if (json.notAPattern === true) return { notAPattern: true, reason: safe(json.reason, 240) || 'The model did not think this is a reviewable pattern.' };
  const smell = safe(json.smell, 240); const why = safe(json.why, 240); const check = safe(json.check, 300);
  if (!smell || !why || !check) return null;
  let name = kebab(json.name) || kebab(json.title);
  if (!name) return null;
  const taken = new Set(existingIds);
  if (taken.has(name)) { let i = 2; while (taken.has(`${name}-${i}`)) i++; name = `${name}-${i}`; }
  const caps = (Array.isArray(json.capabilities) ? json.capabilities : []).filter((c) => capabilities.includes(c)).slice(0, 2);
  const keywords = (Array.isArray(json.keywords) ? json.keywords : []).map((k) => safe(k, 40)).filter(Boolean).slice(0, 6);
  const example = String(json.example || '').split('\n').map((l) => safe(l, 160)).filter(Boolean).slice(0, 4);
  return { name, title: safe(json.title, 100) || name, capabilities: caps, keywords: keywords.length ? keywords : [name.split('-')[0]], smell, why, check, example };
};

// ---------------------------------------------------------------- the file
const wrap = (text) => {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if (line && `${line} ${w}`.length > WIDTH) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
};
const arr = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;

/** The pattern file text in the RAG's template format. The facts (repos, paths, seen, tickets, date) come from the cluster, not from the model. */
export const renderPattern = (draft, cluster, today) => {
  const body = [`# ${draft.title}`, '', '## Smell', ...wrap(draft.smell), '', '## Why it bites', ...wrap(draft.why), '', '## Check', ...wrap(draft.check)];
  if (draft.example.length) body.push('', '## Example', ...draft.example.slice(0, MAX_EXAMPLE_LINES));
  // the RAG allows 20 non-blank lines in all: drop the example first if the text is long
  const nonBlank = (xs) => xs.filter((l) => l.trim()).length;
  while (nonBlank(body) > MAX_BODY_LINES && body.includes('## Example')) body.splice(body.indexOf('## Example') - 1);
  const front = [
    '---', 'type: defect-pattern', `id: ${draft.name}`, `capabilities: ${arr(draft.capabilities)}`, `repos: ${arr([cluster.repo])}`, `paths: ${arr(cluster.files)}`,
    `keywords: ${arr(draft.keywords)}`, `seen: ${cluster.tickets.length}`, `recorded: ${today}`, `tickets: ${arr(cluster.tickets.map((t) => t.key))}`, 'status: active', '---',
  ];
  return `${front.join('\n')}\n${body.join('\n')}\n`;
};

// the same things the RAG's tests/test_defects.py checks
const FORBIDDEN = { 'card-like number': /\b(?:\d[ -]?){13,19}\b/, 'anthropic key': /sk-ant-/, 'slack token': /xox[bap]-/, 'aws key id': /AKIA[0-9A-Z]{12,}/, 'encrypted secret marker': /\[nec\]/, 'email address': /[\w.+-]+@[\w-]+\.[\w.]+/ };
const SECTIONS = ['## Smell', '## Why it bites', '## Check'];
/** Problems a reviewer must fix before the file goes into docs/defects (empty means it passes the RAG's checks). */
export const validatePattern = (text, { capabilities = [] } = {}) => {
  const problems = [];
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return ['no front matter'];
  const meta = Object.fromEntries(m[1].split('\n').map((l) => { const kv = /^([\w-]+):\s*(.*)$/.exec(l); return kv ? [kv[1], kv[2]] : [l, '']; }));
  for (const f of ['type', 'id', 'capabilities', 'repos', 'paths', 'keywords', 'seen', 'recorded', 'tickets', 'status']) if (!(f in meta)) problems.push(`missing ${f}`);
  if (meta.type !== 'defect-pattern') problems.push('type must be defect-pattern');
  const list = (k) => { try { return JSON.parse(meta[k]); } catch { return null; } };
  for (const f of ['capabilities', 'repos', 'keywords', 'tickets']) { const v = list(f); if (!Array.isArray(v) || !v.length) problems.push(f === 'capabilities' ? 'capabilities is empty: pick one capability name from docs/implementations' : `${f} must be a non-empty list`); }
  const caps = list('capabilities') || [];
  const unknown = caps.filter((c) => capabilities.length && !capabilities.includes(c));
  if (unknown.length) problems.push(`unknown capability: ${unknown.join(', ')}`);
  if (!Array.isArray(list('paths'))) problems.push('paths must be a list');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.recorded || '')) problems.push('recorded must be YYYY-MM-DD');
  if (!(Number(meta.seen) >= 1)) problems.push('seen must be 1 or more');
  const body = m[2];
  const pos = SECTIONS.map((h) => body.indexOf(h));
  if (pos.includes(-1) || pos.join() !== [...pos].sort((a, b) => a - b).join()) problems.push('sections Smell, Why it bites, Check must all appear, in order');
  const lines = body.split('\n').filter((l) => l.trim());
  if (lines.length > MAX_BODY_LINES) problems.push(`body has ${lines.length} lines, max ${MAX_BODY_LINES}`);
  if (body.includes('## Example')) {
    const ex = body.split('## Example')[1].split('\n').filter((l) => l.trim() && !l.startsWith('Source:'));
    if (ex.length > MAX_EXAMPLE_LINES) problems.push(`example has ${ex.length} lines, max ${MAX_EXAMPLE_LINES}`);
  }
  for (const [label, rx] of Object.entries(FORBIDDEN)) if (rx.test(text)) problems.push(`contains a ${label}`);
  return problems;
};

/** Where a draft is kept for review: this app's data folder, never the RAG. */
export const stageDraft = (id, text, dir = DRAFTS_DIR) => {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.md`);
  fs.writeFileSync(file, text);
  return file;
};

/**
 * Drafts a pattern for a cluster. Returns { ok: true, id, text, path, problems, needsCapability } or { ok: false, reason, notAPattern? }.
 * `claude` and `stage` are replaced in tests.
 */
export const draftPattern = async ({ cluster, tickets, capabilities, existingIds, today, claude = runClaude, model = MODEL, stage = stageDraft }) => {
  const r = await claude({ prompt: PROMPT, input: buildInput({ cluster, tickets, capabilities, existingIds }), model, timeoutMs: TIMEOUT_MS });
  if (!r.ok) return { ok: false, reason: safe(r.reason || 'the model could not be reached', 200) };
  const draft = parseDraft(parseModelJson(r.text), { capabilities, existingIds });
  if (!draft) return { ok: false, reason: 'The model answered, but not in a usable form. Try again.' };
  if (draft.notAPattern) return { ok: false, notAPattern: true, reason: draft.reason };
  const text = renderPattern(draft, cluster, today);
  const problems = validatePattern(text, { capabilities });
  return { ok: true, id: draft.name, text, path: stage(draft.name, text), problems, needsCapability: !draft.capabilities.length };
};
