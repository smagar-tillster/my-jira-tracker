// PR review drafts. Claude writes a draft per (repo, PR, head commit); the user reviews it in the app and presses Post.
// This module owns: where drafts live, validating what Claude saves, redacting anything that looks like a secret or card number,
// and the guarded posting step. It never posts on its own: postReview() is only called from a user-confirmed request.
//
// Layout: <DATA_DIR>/reviews/<repo>/<number>__<sha7>.json   (one file per head commit, so a new push gets a new draft)
// status: draft -> posted | skipped | stale   (only draft is editable or postable)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, CONFIG_FILE } from './paths.mjs';

export const REVIEWS_DIR = path.join(DATA_DIR, 'reviews');
export const SCHEMA = 1;
const SEVERITIES = ['issue', 'suggestion', 'question', 'nit', 'note'];
const MAX_INLINE = 25;
const MAX_BODY = 60000; // GitHub's limit is 65536; leave room for the marker and the inline fallback

export const reviewConfig = () => {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).review || {}; } catch { /* no config yet */ }
  return {
    repos: c.repos || {},
    skipAuthors: (c.skipAuthors || []).map((a) => a.toLowerCase()),
    components: c.components || {}, // Jira component per repo, used to narrow defect candidates
    packetChars: c.packetChars || 60000,
    patchLines: c.patchLines || 400,
    skipTiers: Array.isArray(c.skipTiers) ? c.skipTiers : ['skip'], // PR tiers not worth a review (see reviewtier.mjs)
    // A PR touched in the last N minutes is still being pushed to: reviewing every intermediate head wastes a review per push.
    minAgeMinutes: Number.isFinite(c.minAgeMinutes) && c.minAgeMinutes >= 0 ? c.minAgeMinutes : 30,
    // "Initiate Code Review": one headless `claude -p` call per PR (reviewgen.mjs). haiku for ordinary changes, sonnet for deep ones.
    models: { light: c.models?.light || 'haiku', deep: c.models?.deep || 'sonnet' },
    maxParallel: Number.isInteger(c.maxParallel) && c.maxParallel > 0 ? Math.min(c.maxParallel, 6) : 3,
    maxBatch: Number.isInteger(c.maxBatch) && c.maxBatch > 0 ? c.maxBatch : 20,
    ragRoot: c.ragRoot || path.join(process.env.HOME || '', 'Documents', 'my-rag'), // my-rag checkout, read for capability maps and defect patterns
    contextChars: c.contextChars || 14000, // unchanged code around the changes, deep reviews only
    maxInputChars: c.maxInputChars || 90000,
    claudeTimeoutMs: c.claudeTimeoutMs || 300000,
  };
};

export const slugFor = (repo) => reviewConfig().repos[repo] || null;
export const marker = (repo, number, sha) => `<!-- mytracker-review:${repo}#${number}@${String(sha).slice(0, 7)} -->`;
export const reviewId = (repo, number, sha) => `${repo}__${number}__${String(sha).slice(0, 7)}`;

const fileFor = (repo, number, sha7) => path.join(REVIEWS_DIR, repo, `${number}__${sha7}.json`);
const safeName = (s) => /^[A-Za-z0-9._-]+$/.test(s);
const nowIso = () => new Date().toISOString();

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
  fs.renameSync(tmp, f); // atomic: the UI never reads a half-written draft
};

// ---------------------------------------------------------------- secret / card scanning
const luhn = (digits) => {
  let sum = 0; let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
};

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'Slack token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'JWT'],
  [/\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"',;]{6,}/gi, 'credential assignment'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi, 'URL with credentials'],
];

export const redactSecrets = (text) => {
  const hits = new Set();
  let out = String(text ?? '');
  for (const [re, label] of SECRET_PATTERNS) {
    out = out.replace(re, () => { hits.add(label); return '[redacted]'; });
  }
  // Card numbers: 13-19 digits (spaces/dashes allowed) that pass the Luhn check
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) { hits.add('possible card number'); return '[redacted]'; }
    return m;
  });
  return { text: out, hits: [...hits] };
};

// ---------------------------------------------------------------- validation
const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validates and normalizes what the Claude session sends. The server, not the client, owns status, event, marker and timestamps. */
export const normalizeDraft = (input) => {
  const errors = [];
  const repo = str(input?.repo, 100);
  const slug = slugFor(repo);
  if (!repo || !safeName(repo) || !slug) errors.push(`repo must be one of: ${Object.keys(reviewConfig().repos).join(', ') || '(none configured)'}`);
  const number = Number(input?.number);
  if (!Number.isInteger(number) || number <= 0) errors.push('number must be a positive integer');
  const headSha = str(input?.headSha, 64).toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(headSha)) errors.push('headSha must be a 7-40 character hex commit id');
  let body = str(input?.body, MAX_BODY + 1);
  if (!body.trim()) errors.push('body is required');
  if (body.length > MAX_BODY) errors.push(`body is longer than ${MAX_BODY} characters`);

  const inline = [];
  for (const [i, c] of (Array.isArray(input?.inline) ? input.inline : []).entries()) {
    const line = Number(c?.line);
    const side = c?.side === 'LEFT' ? 'LEFT' : 'RIGHT';
    const startLine = c?.startLine === undefined || c?.startLine === null ? null : Number(c.startLine);
    if (!str(c?.path, 500) || !Number.isInteger(line) || line <= 0 || !str(c?.body, 5000).trim()) { errors.push(`inline[${i}] needs path, a positive line and body`); continue; }
    if (startLine !== null && (!Number.isInteger(startLine) || startLine <= 0 || startLine >= line)) { errors.push(`inline[${i}] startLine must be a positive line before line`); continue; }
    inline.push({
      path: str(c.path, 500), line, ...(startLine ? { startLine } : {}), side, body: str(c.body, 5000),
      severity: SEVERITIES.includes(c?.severity) ? c.severity : 'note',
      include: true, // the user can switch a comment off before posting
    });
  }
  if (inline.length > MAX_INLINE) errors.push(`at most ${MAX_INLINE} inline comments; keep the most important`);
  if (errors.length) return { errors };

  // Secret / card scan across everything that could be posted
  const found = new Set();
  const scrub = (t) => { const r = redactSecrets(t); r.hits.forEach((h) => found.add(h)); return r.text; };
  body = scrub(body);
  for (const c of inline) c.body = scrub(c.body);

  const mk = marker(repo, number, headSha);
  if (!body.includes(mk)) body = `${mk}\n${body}`;

  const sum = input?.summary || {};
  const list = (a, n = 60) => (Array.isArray(a) ? a.map((x) => str(x, 300)).filter(Boolean).slice(0, n) : []);
  const risk = ['low', 'medium', 'high'].includes(input?.risk) ? input.risk : null;
  const confidence = ['low', 'medium', 'high'].includes(input?.flags?.confidence) ? input.flags.confidence : 'medium';

  return {
    draft: {
      schema: SCHEMA,
      repo, slug, number, headSha,
      baseRef: str(input?.baseRef, 200), title: str(input?.title, 500), url: str(input?.url, 500), author: str(input?.author, 100),
      generatedAt: nowIso(), model: str(input?.model, 100),
      status: 'draft',
      event: 'COMMENT', // reviews are comment-only: never an approval and never "request changes"
      marker: mk,
      body, inline,
      summary: { changes: str(sum.changes, 3000), impact: str(sum.impact, 3000), risks: str(sum.risks, 3000), tests: str(sum.tests, 3000) },
      risk,
      tier: ['light', 'deep'].includes(input?.tier) ? input.tier : null, // how deep the review went (reviewtier.mjs)
      patterns: list(input?.patterns, 20), // ids of the defect patterns that applied (docs/defects in the knowledge base)
      components: list(input?.components),
      files: list(input?.files, 300),
      tickets: list(input?.tickets, 20),
      flags: {
        touchesPaymentPaths: !!input?.flags?.touchesPaymentPaths,
        // set by the server, never trusted from the client: true when something secret-like was found and redacted
        possibleSecrets: found.size > 0,
        redacted: [...found],
        confidence,
      },
      internalNotes: list(input?.internalNotes, 10), // for the user only: never part of what is posted
      related: (Array.isArray(input?.related) ? input.related : []).slice(0, 20).map((r) => ({ id: str(r?.id, 100), kind: r?.kind === 'defect' ? 'defect' : 'pr', why: str(r?.why, 400) })).filter((r) => r.id),
    },
  };
};

// ---------------------------------------------------------------- storage
export const listReviews = () => {
  const out = [];
  let repos = [];
  try { repos = fs.readdirSync(REVIEWS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const repo of repos) {
    for (const f of fs.readdirSync(path.join(REVIEWS_DIR, repo))) {
      if (!f.endsWith('.json')) continue;
      const r = readJson(path.join(REVIEWS_DIR, repo, f));
      if (r?.schema === SCHEMA) out.push(r);
    }
  }
  return out.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
};

export const getReview = (repo, number, sha) => {
  if (!safeName(String(repo)) || !/^\d+$/.test(String(number)) || !/^[0-9a-f]{7,40}$/i.test(String(sha))) return null;
  return readJson(fileFor(repo, number, String(sha).slice(0, 7).toLowerCase()));
};

const save = (r) => writeJson(fileFor(r.repo, r.number, r.headSha.slice(0, 7)), r);

// ---------------------------------------------------------------- anchoring inline comments to the real diff
/** Parses a unified-diff patch into lines with their old/new file line numbers, grouped by hunk. */
export const parsePatch = (patch) => {
  const hunks = [];
  let cur = null; let o = 0; let n = 0;
  for (const raw of String(patch || '').split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { o = Number(h[1]); n = Number(h[2]); cur = []; hunks.push(cur); continue; }
    if (!cur || raw.startsWith('\\')) continue;
    const t = raw[0]; const text = raw.slice(1);
    if (t === '+') cur.push({ type: 'add', oldN: null, newN: n++, text });
    else if (t === '-') cur.push({ type: 'del', oldN: o++, newN: null, text });
    else cur.push({ type: 'ctx', oldN: o++, newN: n++, text });
  }
  return hunks;
};

const lineOn = (l, side) => (side === 'LEFT' ? (l.type !== 'add' ? l.oldN : null) : (l.type !== 'del' ? l.newN : null));
const ranges = (nums) => {
  const out = []; let a = null; let b = null;
  for (const x of [...new Set(nums)].sort((p, q) => p - q)) { if (a === null) { a = b = x; } else if (x === b + 1) b = x; else { out.push(a === b ? `${a}` : `${a}-${b}`); a = b = x; } }
  if (a !== null) out.push(a === b ? `${a}` : `${a}-${b}`);
  return out.join(', ');
};

/**
 * Checks every inline comment against the PR's real patches. A comment can only sit on a line that is part of the diff
 * (GitHub rejects the whole review otherwise). Valid comments get the surrounding code attached so the user can read each
 * one next to its code. `files` = [{ filename, patch }] from the PR files API.
 */
export const anchorInline = (inline, files) => {
  const errors = []; const out = [];
  const byName = new Map(files.map((f) => [f.filename, parsePatch(f.patch)]));
  for (const [i, c] of inline.entries()) {
    const tag = `inline[${i}] ${c.path}:${c.startLine ? `${c.startLine}-` : ''}${c.line} (${c.side})`;
    const hunks = byName.get(c.path);
    if (!hunks) { errors.push(`${tag}: ${c.path} is not a changed file with a patch in this PR`); continue; }
    const hunk = hunks.find((h) => h.some((l) => lineOn(l, c.side) === c.line));
    if (!hunk) {
      const avail = ranges(hunks.flatMap((h) => h.map((l) => lineOn(l, c.side)).filter((x) => x !== null)));
      errors.push(`${tag}: that line is not part of the diff. ${c.side === 'RIGHT' ? 'Right' : 'Left'}-side lines available in this file: ${avail || 'none'}`);
      continue;
    }
    const endIdx = hunk.findIndex((l) => lineOn(l, c.side) === c.line);
    let startIdx = endIdx;
    if (c.startLine) {
      startIdx = hunk.findIndex((l) => lineOn(l, c.side) === c.startLine);
      const span = startIdx >= 0 ? hunk.slice(startIdx, endIdx + 1).map((l) => lineOn(l, c.side)).filter((x) => x !== null) : [];
      if (startIdx < 0 || startIdx >= endIdx || span.length !== c.line - c.startLine + 1) { errors.push(`${tag}: startLine and line must be in the same hunk with no gap`); continue; }
    }
    const from = Math.max(0, startIdx - 3); const to = Math.min(hunk.length, endIdx + 3);
    const diffContext = hunk.slice(from, to).slice(0, 16).map((l) => ({
      n: lineOn(l, c.side) ?? l.newN ?? l.oldN, type: l.type, text: l.text.slice(0, 300),
      anchor: hunk.indexOf(l) >= startIdx && hunk.indexOf(l) <= endIdx,
    }));
    out.push({ ...c, diffContext });
  }
  return { errors, inline: out };
};

/** Validates input and builds the draft without saving it (so the route can anchor comments against the PR first). */
export const prepareDraft = (input) => {
  const n = normalizeDraft(input);
  if (n.errors) return { ok: false, status: 400, errors: n.errors };
  const existing = getReview(n.draft.repo, n.draft.number, n.draft.headSha);
  if (existing && existing.status !== 'draft') return { ok: false, status: 409, errors: [`A ${existing.status} review already exists for this commit`] };
  if (existing) n.draft.regeneratedFrom = existing.generatedAt;
  return { ok: true, draft: n.draft };
};

export const commitDraft = (draft) => { save(draft); return { ok: true, draft }; };

/** prepare + commit without diff anchoring (used by tests; the API route anchors first). */
export const saveDraft = (input) => {
  const p = prepareDraft(input);
  return p.ok ? commitDraft(p.draft) : p;
};

/**
 * The user's edits before posting: the overview text, and per inline comment its text and whether it is included.
 * `inline` is matched by position and must be the same length; anchors (path, line, side) can never be changed here.
 */
export const editDraft = (repo, number, sha, { body, inline } = {}) => {
  const r = getReview(repo, number, sha);
  if (!r) return { ok: false, status: 404, errors: ['Draft not found'] };
  if (r.status !== 'draft') return { ok: false, status: 409, errors: [`Only a draft can be edited (this one is ${r.status})`] };
  const found = new Set(r.flags.redacted || []);
  if (body !== undefined) {
    const text = str(body, MAX_BODY + 1);
    if (!text.trim() || text.length > MAX_BODY) return { ok: false, status: 400, errors: [`body must be 1-${MAX_BODY} characters`] };
    const red = redactSecrets(text);
    red.hits.forEach((h) => found.add(h));
    r.body = red.text.includes(r.marker) ? red.text : `${r.marker}\n${red.text}`;
  }
  if (inline !== undefined) {
    if (!Array.isArray(inline) || inline.length !== r.inline.length) return { ok: false, status: 400, errors: ['inline must list every comment, in order'] };
    inline.forEach((e, i) => {
      if (typeof e?.include === 'boolean') r.inline[i].include = e.include;
      if (e?.body !== undefined) {
        const t = str(e.body, 5000);
        if (t.trim()) { const red = redactSecrets(t); red.hits.forEach((h) => found.add(h)); r.inline[i].body = red.text; r.inline[i].edited = true; }
      }
    });
  }
  r.edited = true; r.editedAt = nowIso();
  if (found.size) { r.flags.possibleSecrets = true; r.flags.redacted = [...found]; }
  save(r);
  return { ok: true, draft: r };
};

export const markSkipped = (repo, number, sha) => {
  const r = getReview(repo, number, sha);
  if (!r) return { ok: false, status: 404, errors: ['Draft not found'] };
  if (r.status !== 'draft') return { ok: false, status: 409, errors: [`Already ${r.status}`] };
  r.status = 'skipped'; r.skippedAt = nowIso();
  save(r);
  return { ok: true, draft: r };
};

// ---------------------------------------------------------------- posting
const inFlight = new Set();

const included = (draft) => (draft.inline || []).filter((c) => c.include !== false);

const toGitHubComment = (c) => ({
  path: c.path, line: c.line, side: c.side, body: c.body,
  ...(c.startLine ? { start_line: c.startLine, start_side: c.side } : {}),
});

const withInlineFallback = (draft) => {
  const list = included(draft);
  if (!list.length) return draft.body;
  return `${draft.body}\n\n**Line comments**\n${list.map((c) => `- \`${c.path}:${c.startLine ? `${c.startLine}-` : ''}${c.line}\` — ${c.body}`).join('\n')}`;
};

/**
 * Posts one draft as a COMMENT review. Only call this from a request the user explicitly confirmed.
 * Checks, in order: still a draft, secrets acknowledged, PR still open, head commit unchanged, not already posted.
 * `gh(args, {input})` runs the GitHub CLI and returns parsed JSON; injected so it can be tested without GitHub.
 */
export const postReview = async ({ repo, number, sha, gh, dryRun = false, acknowledgeSecrets = false }) => {
  const r = getReview(repo, number, sha);
  if (!r) return { ok: false, status: 404, error: 'Draft not found' };
  if (r.status !== 'draft') return { ok: false, status: 409, error: `This review is already ${r.status}` };
  const slug = slugFor(r.repo);
  if (!slug || slug !== r.slug) return { ok: false, status: 400, error: 'Repo is not configured for reviews' };
  if (r.flags?.possibleSecrets && !acknowledgeSecrets) {
    return { ok: false, status: 422, error: `Possible secret or card data was found and redacted (${(r.flags.redacted || []).join(', ')}). Read the draft, then confirm again to post.`, needsAcknowledge: true };
  }
  const id = reviewId(r.repo, r.number, r.headSha);
  if (inFlight.has(id)) return { ok: false, status: 409, error: 'Already posting this review' };
  inFlight.add(id);
  try {
    const pr = await gh(['pr', 'view', String(r.number), '--repo', slug, '--json', 'state,isDraft,headRefOid,url']);
    if (pr.state !== 'OPEN') {
      r.status = 'stale'; r.staleReason = `PR is ${String(pr.state).toLowerCase()}`; r.staleAt = nowIso(); save(r);
      return { ok: false, status: 409, error: `PR is ${String(pr.state).toLowerCase()}; the draft was marked stale`, draft: r };
    }
    if (!String(pr.headRefOid).startsWith(r.headSha.slice(0, 7))) {
      r.status = 'stale'; r.staleReason = 'new commits were pushed after this draft'; r.staleAt = nowIso(); save(r);
      return { ok: false, status: 409, error: 'New commits were pushed after this draft was written; it was marked stale', draft: r };
    }
    // Already posted (for example from an earlier click that failed after GitHub accepted it)?
    const existing = (await gh(['api', `repos/${slug}/pulls/${r.number}/reviews?per_page=100`])) || [];
    const dup = existing.find((x) => typeof x.body === 'string' && x.body.includes(r.marker));
    if (dup) {
      r.status = 'posted'; r.postedAt = nowIso(); r.reviewUrl = dup.html_url || null; r.alreadyOnGitHub = true; save(r);
      return { ok: true, alreadyPosted: true, draft: r };
    }

    const payload = { commit_id: pr.headRefOid, event: 'COMMENT', body: r.body };
    const chosen = included(r);
    if (chosen.length) payload.comments = chosen.map(toGitHubComment);
    if (dryRun) return { ok: true, dryRun: true, wouldPost: { slug, number: r.number, event: payload.event, commit_id: payload.commit_id, bodyChars: payload.body.length, inlineComments: chosen.length, inlineSkipped: r.inline.length - chosen.length } };

    const call = (p) => gh(['api', '-X', 'POST', `repos/${slug}/pulls/${r.number}/reviews`, '--input', '-'], { input: JSON.stringify(p) });
    let res; let inlineMovedToBody = false;
    try {
      res = await call(payload);
    } catch (e) {
      // GitHub rejects inline comments on lines that are not part of the diff (422). Keep the content: move it into the body.
      if (chosen.length && /422|Unprocessable|pull_request_review_thread|line/i.test(String(e.stderr || e.message))) {
        res = await call({ commit_id: pr.headRefOid, event: 'COMMENT', body: withInlineFallback(r) });
        inlineMovedToBody = true;
      } else throw e;
    }
    r.status = 'posted'; r.postedAt = nowIso(); r.reviewUrl = res?.html_url || null; r.inlineMovedToBody = inlineMovedToBody;
    save(r);
    return { ok: true, draft: r };
  } catch (e) {
    return { ok: false, status: 502, error: `GitHub call failed: ${String(e.stderr || e.message).split('\n')[0].slice(0, 300)}` };
  } finally {
    inFlight.delete(id);
  }
};

// ---------------------------------------------------------------- memory (used when building a review packet)
const TRIVIAL = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?)$)/i;

/** Earlier reviews of the same repo that touched the same files or tickets, for "this changed before, and then..." context. */
export const relatedReviews = ({ repo, number, files = [], tickets = [] }, max = 5) => {
  const mine = new Set(files.map((f) => f.name || f).filter((n) => !TRIVIAL.test(n)));
  const scored = [];
  for (const r of listReviews()) {
    if (r.repo !== repo || r.number === number || r.status === 'skipped') continue;
    const sharedFiles = (r.files || []).filter((n) => mine.has(n));
    const sharedTickets = tickets.filter((k) => (r.tickets || []).includes(k));
    const score = sharedTickets.length * 5 + Math.min(4, sharedFiles.length * 2);
    if (score >= 2) scored.push({ r, score, why: [sharedTickets.length ? `same ticket ${sharedTickets.join(', ')}` : '', sharedFiles.length ? `same file${sharedFiles.length > 1 ? 's' : ''}: ${sharedFiles.slice(0, 2).join(', ')}` : ''].filter(Boolean).join('; ') });
  }
  return scored.sort((a, b) => b.score - a.score || String(b.r.generatedAt).localeCompare(String(a.r.generatedAt))).slice(0, max);
};

export const relatedReviewsMarkdown = (hits) => {
  if (!hits.length) return '## Earlier reviews touching these files or tickets\nNone.\n';
  return ['## Earlier reviews touching these files or tickets (context only, not facts about this PR)',
    ...hits.map(({ r, why }) => `- ${r.repo}#${r.number} (${String(r.generatedAt).slice(0, 10)}, ${why}; ${r.status}${r.risk ? `, risk ${r.risk}` : ''}): ${r.summary?.changes || r.title}${r.summary?.risks ? ` Risks noted then: ${r.summary.risks.slice(0, 240)}` : ''}`), ''].join('\n');
};
