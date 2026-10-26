// Initiate Code Review: one headless model call per PR, everything else is plain code.
//   packet + matched defect patterns + (deep PRs) the code around each change  ->  `claude -p` with no tools  ->  JSON  ->  a draft
// The user reads the draft in the PR Reviews tab and posts it by hand; nothing here writes to GitHub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, DELIVERY_DIR } from './paths.mjs';
import { getReview, prepareDraft, commitDraft, anchorInline, reviewConfig } from './reviews.mjs';
import { kindOf } from './prpacket.mjs';

const execFileP = promisify(execFile);
export const PROMPT_FILE = path.join(DELIVERY_DIR, 'review-prompt.md');
export const REQUESTS_DIR = path.join(DATA_DIR, 'review-requests');

// ---------------------------------------------------------------- the prompt
const DEPTH = {
  light: 'This is an ordinary change. Keep to correctness, security and data, the Tillster rules that apply (money in integer cents, new behavior behind a flag with per-brand targeting, payment, cardholder and auth paths, dependency changes) and the defect patterns provided. At most 4 line comments. The overview is about 100 words; leave out Testing unless something is non-obvious.',
  deep: 'This is a larger or riskier change. Cover, in this order: (1) correctness: wrong conditions, off-by-one, null or missing-key access, mutated shared state, copy-paste errors, behavior that no longer matches the PR description; (2) failure and edge cases: failing or slow network, double submit, timeouts, error states the user can see, and what happens offline (kiosks must keep taking orders during a cloud outage, so a new hard cloud dependency in an in-store path is an issue); (3) kiosk-ui specifics (AngularJS 1.6, a kiosk stays up for days): listeners, $on, $watch, $interval and $timeout not cleaned up on $destroy, work outside the digest cycle, per-tenant config keys that exist for some tenants only, strings added without every locale, hardcoded text, currency or date formats, accessibility; (4) security and data: secrets, card data, guest PII, unescaped HTML, new third-party hosts; (5) Tillster rules where they apply: money as integer cents, UTC ISO-8601 timestamps, structured logs with a correlation id, queries and cache keys scoped by brand and restaurant, idempotency keys on mutations, new behavior behind a LaunchDarkly flag with per-brand targeting, dependency changes (flag copyleft licenses), payment, cardholder, auth, token or encryption paths (set touchesPaymentPaths); (6) tests: changed branches with no test, tests that cannot fail. At most 10 line comments, most important first. The overview is 120 to 150 words.',
};

export const buildPrompt = (tier, file = PROMPT_FILE) => fs.readFileSync(file, 'utf8').replace('{{DEPTH}}', DEPTH[tier === 'deep' ? 'deep' : 'light']);
export const chooseModel = (tier, cfg = reviewConfig()) => (tier === 'deep' ? cfg.models.deep : cfg.models.light);

/** The model's answer as an object, or null. Tolerates a code fence or a sentence around the JSON. */
export const parseModelJson = (text) => {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { const o = JSON.parse(s.slice(a, b + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
};

// ---------------------------------------------------------------- the model call (the same headless pattern analyze-pr.mjs uses)
export const runClaude = ({ prompt, input, model, timeoutMs = 300000 }) => new Promise((resolve) => {
  const bin = [path.join(os.homedir(), '.local', 'bin', 'claude'), 'claude'].find((b) => b === 'claude' || fs.existsSync(b));
  const env = { ...process.env, PATH: `${process.env.PATH || ''}:${path.join(os.homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin` };
  let out = ''; let err = ''; let done = false;
  const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
  let child;
  try { child = spawn(bin, ['-p', prompt, '--model', model, '--tools', '', '--no-session-persistence', '--output-format', 'text'], { env, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return resolve({ ok: false, reason: String(e.message || e), text: '' }); }
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, reason: `the claude CLI took longer than ${Math.round(timeoutMs / 1000)}s`, text: out }); }, timeoutMs);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => finish({ ok: false, reason: String(e.message || e), text: out }));
  child.on('close', (code) => {
    const why = `${err}${out}`.split('\n').map((l) => l.trim()).filter((l) => l && !/^Permission ask rule|MCP servers blocked/i.test(l))[0] || 'no usable answer from the claude CLI';
    finish(code === 0 && out.trim() ? { ok: true, text: out } : { ok: false, reason: why, text: out });
  });
  child.stdin.on('error', () => { /* the process exited before reading; close handles it */ });
  child.stdin.end(input);
});

// ---------------------------------------------------------------- knowledge from the docs, read straight from disk
/** Maps the changed files to capabilities and defect patterns (scripts/capabilities_for_files.py in the my-rag checkout). null when unavailable. */
export const runHelper = async ({ ragRoot, repo, files, run = (cmd, args, opts) => execFileP(cmd, args, opts) }) => {
  try {
    const py = path.join(ragRoot, '.venv', 'bin', 'python');
    const script = path.join(ragRoot, 'scripts', 'capabilities_for_files.py');
    if (!fs.existsSync(py) || !fs.existsSync(script) || !files.length) return null;
    const { stdout } = await run(py, [script, '--repo', repo, ...files], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch { return null; }
};

/** The text of each matched defect pattern (without its front matter), for the prompt. Docs outside ragRoot/docs are never read. */
export const patternsMarkdown = ({ ragRoot, patterns }) => {
  const docs = path.resolve(ragRoot, 'docs');
  const parts = [];
  for (const p of patterns || []) {
    try {
      const file = path.resolve(docs, p.doc);
      if (!file.startsWith(docs + path.sep) || !file.endsWith('.md')) continue;
      const body = fs.readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim().slice(0, 1500);
      parts.push(`### Pattern ${p.id}\nChanged files it applies to: ${p.matched.join(', ')}\n${body}`);
    } catch { /* pattern doc missing: the review goes on without it */ }
  }
  return parts.join('\n\n');
};

// ---------------------------------------------------------------- the code around each change, for deep reviews
/** New-file line ranges of the hunks in a patch. */
export const hunkRanges = (patch) => {
  const out = [];
  for (const m of String(patch || '').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]); const len = m[2] === undefined ? 1 : Number(m[2]);
    if (len > 0) out.push([start, start + len - 1]);
  }
  return out;
};

const mergeRanges = (ranges) => {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]); const out = [];
  for (const r of sorted) { const last = out[out.length - 1]; if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push([...r]); }
  return out;
};

/**
 * Unchanged lines above and below each hunk of the biggest changed source files, numbered, at the PR head.
 * `prFiles` = [{ filename, status, additions, deletions, patch }]. Fetches with the backend's own GitHub login.
 */
export const contextFor = async ({ prFiles, gh, slug, sha, maxFiles = 6, budget = 14000, around = 25 }) => {
  const candidates = prFiles
    .filter((f) => f.status !== 'removed' && f.patch && ['source', 'config'].includes(kindOf(f.filename)) && !/\.(min\.js|lock|md|txt)$/i.test(f.filename))
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, maxFiles);
  const blocks = []; let left = budget;
  for (const f of candidates) {
    if (left <= 0) break;
    try {
      const enc = f.filename.split('/').map(encodeURIComponent).join('/');
      const file = await gh(['api', `repos/${slug}/contents/${enc}?ref=${sha}`]);
      if (!file || file.encoding !== 'base64' || file.size > 300000) continue;
      const lines = Buffer.from(file.content, 'base64').toString('utf8').split('\n');
      const changed = mergeRanges(hunkRanges(f.patch));
      const shown = [];
      for (const [s, e] of changed) {
        shown.push([Math.max(1, s - around), s - 1], [e + 1, Math.min(lines.length, e + around)]);
      }
      const ranges = mergeRanges(shown.filter(([a, b]) => b >= a)).map(([a, b]) => {
        // lines that are themselves changed are in the patch already
        const keep = []; for (let n = a; n <= b; n++) if (!changed.some(([s, e]) => n >= s && n <= e)) keep.push(n);
        return keep;
      }).filter((k) => k.length);
      let text = '';
      for (const keep of ranges) {
        text += `${keep.map((n) => `${String(n).padEnd(5)}${lines[n - 1].slice(0, 220)}`).join('\n')}\n…\n`;
      }
      const block = `#### ${f.filename} (unchanged lines around the changes, with their line numbers)\n\`\`\`\n${text}\`\`\`\n`;
      if (block.length > left && blocks.length) break;
      blocks.push(block.slice(0, Math.max(left, 2000))); left -= block.length;
    } catch { /* a file that cannot be read is simply left out */ }
  }
  return blocks.join('\n');
};

// ---------------------------------------------------------------- turning the answer into a draft
/** Keeps the line comments that sit on real diff lines; the rest are moved into the overview so nothing the model found is lost. */
export const settleAnchors = (draft, files) => {
  const inline = []; const moved = [];
  for (const c of draft.inline) {
    const r = anchorInline([c], files);
    if (r.errors.length) moved.push(c); else inline.push(r.inline[0]);
  }
  draft.inline = inline;
  if (moved.length) {
    const bullets = moved.slice(0, 5).map((c) => `- \`${c.path}:${c.line}\` ${String(c.body).replace(/\s+/g, ' ').trim()}`);
    draft.body = `${draft.body.trimEnd()}\n\n### Also noticed\n${bullets.join('\n')}`;
    draft.inlineMovedToBody = true;
  }
  return { draft, moved: moved.length };
};

/**
 * Makes the model's line comments safe for the draft schema: numbers are coerced, and a startLine that is not before `line`
 * (models often send startLine = line for a single line) is dropped so the comment stays a single-line comment.
 * Comments with no path, line or text are dropped.
 */
export const cleanInline = (list) => {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const line = Number(c?.line);
    if (typeof c?.path !== 'string' || !c.path.trim() || !Number.isInteger(line) || line <= 0 || typeof c?.body !== 'string' || !c.body.trim()) continue;
    const start = Number(c.startLine);
    const { startLine, ...rest } = c;
    out.push({ ...rest, line, ...(Number.isInteger(start) && start > 0 && start < line ? { startLine: start } : {}) });
  }
  return out;
};

const TRIVIAL_FILE =/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|pdf)$)/i;

/**
 * The whole pipeline for one PR. Returns { state, message, draft? } with state done | exists | queued | failed.
 * queued = the claude CLI is not usable: a request is saved so `/pr-review kiosk-ui#N` can do it in a Claude session.
 */
export const generateReview = async ({ repo, number, gh, buildPacket, prFiles, claude = runClaude, helper = runHelper, cfg = reviewConfig() }) => {
  const slug = cfg.repos[repo];
  if (!slug) return { state: 'failed', message: `${repo} is not a configured repo` };
  try {
    const { text, p, head, tier: exact } = await buildPacket(repo, number);
    if (head.state !== 'OPEN') return { state: 'failed', message: `The PR is ${String(head.state).toLowerCase()}` };
    const have = getReview(repo, number, head.headRefOid);
    if (have) return { state: 'exists', message: `A ${have.status} review already exists for this commit; open it in the list` };

    const tier = exact.tier === 'deep' ? 'deep' : 'light'; // a PR the rules would skip is still reviewed when the user asks
    const model = chooseModel(tier, cfg);
    const names = p.files.map((f) => f.name);
    const notes = [];

    const found = await helper({ ragRoot: cfg.ragRoot, repo, files: names });
    if (!found) notes.push('Knowledge helper unavailable: no defect patterns were checked.');
    else {
      if (found.capabilities?.length) notes.push(`Capabilities touched: ${found.capabilities.slice(0, 4).map((c) => c.capability).join(', ')}`);
      if (found.shared_files?.length) notes.push(`Shared files (many owners): ${found.shared_files.map((s) => s.file.split('/').pop()).join(', ')}`);
    }
    const matched = found?.defect_patterns || [];
    const patterns = patternsMarkdown({ ragRoot: cfg.ragRoot, patterns: matched });

    const files = await prFiles(slug, number);
    const context = tier === 'deep' ? await contextFor({ prFiles: files, gh, slug, sha: head.headRefOid, budget: cfg.contextChars }) : '';
    if (tier === 'deep' && !context) notes.push('The code around the changes could not be fetched; the review is from the diff only.');

    const input = [
      text,
      patterns ? `\n## Defect patterns that apply to this change (mandatory checks)\n${patterns}` : '',
      context ? `\n## Code around the changes at the PR head (unchanged lines, for context only)\n${context}` : '',
    ].join('\n').slice(0, cfg.maxInputChars);

    const r = await claude({ prompt: buildPrompt(tier), input, model, timeoutMs: cfg.claudeTimeoutMs });
    if (!r.ok) {
      fs.mkdirSync(REQUESTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(REQUESTS_DIR, `${repo}__${number}.json`), JSON.stringify({ repo, number, requestedAt: new Date().toISOString(), reason: r.reason, tier, hint: `run /pr-review ${repo}#${number} in a Claude session` }, null, 2));
      return { state: 'queued', message: `Could not start automatically; request saved (${repo}#${number}).` };
    }
    const j = parseModelJson(r.text);
    if (!j || typeof j.body !== 'string' || !j.body.trim()) return { state: 'failed', message: 'The model did not return a usable review' };

    const known = new Set(matched.map((m) => m.id));
    const prep = prepareDraft({
      repo, number, headSha: head.headRefOid, baseRef: head.baseRefName, title: head.title, url: head.url, author: head.author?.login || '',
      model: `${model} (claude CLI)`, body: j.body,
      inline: cleanInline(j.inline).slice(0, tier === 'deep' ? 10 : 4),
      summary: j.summary, risk: j.risk, tier, patterns: (Array.isArray(j.patterns) ? j.patterns : []).filter((id) => known.has(id)),
      components: j.components, flags: j.flags, related: j.related,
      files: names.filter((n) => !TRIVIAL_FILE.test(n)).slice(0, 100), tickets: p.keys,
      internalNotes: [...(Array.isArray(j.internalNotes) ? j.internalNotes : []), ...notes],
    });
    if (!prep.ok) return { state: 'failed', message: (prep.errors || []).join('; ').slice(0, 300) };
    const { draft, moved } = settleAnchors(prep.draft, files);
    commitDraft(draft);
    return { state: 'done', message: `Draft saved (${tier}, ${model}): ${draft.inline.length} line comment(s)${moved ? `, ${moved} moved into the overview` : ''}`, draft };
  } catch (e) {
    return { state: 'failed', message: String(e.stderr || e.message || e).split('\n')[0].slice(0, 300) };
  }
};

// ---------------------------------------------------------------- several PRs at a time
/** A small in-memory queue: at most `maxParallel` reviews run at once, the rest wait. State is per PR id ("kiosk-ui#9325"). */
export const createJobRunner = ({ maxParallel = 3, work, keepMs = 30 * 60 * 1000, now = () => Date.now() }) => {
  const jobs = new Map(); const waiting = []; let running = 0; let idleWaiters = [];
  const iso = () => new Date(now()).toISOString();
  const view = (j) => ({ id: j.id, state: j.state, message: j.message, queuedAt: j.queuedAt, startedAt: j.startedAt, finishedAt: j.finishedAt });
  const settle = () => { if (!running && !waiting.length) { idleWaiters.forEach((f) => f()); idleWaiters = []; } };
  const start = (id) => {
    const j = jobs.get(id); j.state = 'running'; j.startedAt = iso(); running++;
    Promise.resolve().then(() => work(j.args))
      .then((r) => { j.state = r.state; j.message = r.message || ''; })
      .catch((e) => { j.state = 'failed'; j.message = String(e?.message || e).slice(0, 300); })
      .finally(() => { j.finishedAt = iso(); running--; pump(); });
  };
  const pump = () => { while (running < maxParallel && waiting.length) start(waiting.shift()); settle(); };
  return {
    enqueue(id, args) {
      const cur = jobs.get(id);
      if (cur && (cur.state === 'waiting' || cur.state === 'running')) return view(cur);
      const j = { id, args, state: 'waiting', message: 'Waiting for a free slot', queuedAt: iso(), startedAt: null, finishedAt: null };
      jobs.set(id, j); waiting.push(id); pump();
      return view(j);
    },
    status() {
      for (const [id, j] of jobs) if (j.finishedAt && now() - Date.parse(j.finishedAt) > keepMs) jobs.delete(id);
      return Object.fromEntries([...jobs].map(([id, j]) => [id, view(j)]));
    },
    whenIdle: () => (running || waiting.length ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
  };
};
