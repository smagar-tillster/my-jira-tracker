// The RAG's defects are curated review patterns: docs/defects/<id>.md, each with front matter (repos, paths, seen, tickets, status) and a short body.
// A defect is a REPEAT of a pattern when its fix PR (from the app's PR ledger, never fetched) changed a file the pattern's `paths` globs cover in a repo
// the pattern lists. The RAG's README says a repeat updates that file: seen + 1 and the ticket added to `tickets`, nothing else. That is all this module
// ever edits. A cluster of defects that touch the same files with no pattern is only a CANDIDATE for a new pattern: a person reviews a draft (see patternDraft.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TRIVIAL_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|pdf|md|txt)$)/i;
const FM = /^---\n([\s\S]*?)\n---\n/;
const norm = (f) => String(f || '').replace(/^\.?\//, '');

// ---------------------------------------------------------------- front matter (the small subset the template uses)
const parseValue = (raw) => {
  const v = raw.trim();
  if (v.startsWith('[')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean); }
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, '');
};

/** { meta, body } for a pattern or capability file, or null when there is no front matter. A list written over several lines is marked in meta._multiline. */
export const parseFrontMatter = (text) => {
  const m = FM.exec(String(text || ''));
  if (!m) return null;
  const meta = {}; let last = null;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) { meta[kv[1]] = kv[2] === '' ? '' : parseValue(kv[2]); last = kv[1]; }
    else if (/^\s+-\s|^-\s/.test(line) && last && !(meta._multiline || []).includes(last)) (meta._multiline ||= []).push(last);
  }
  return { meta, body: text.slice(m[0].length) };
};

// ---------------------------------------------------------------- reading the RAG
const defectsDir = (ragRoot) => path.join(ragRoot, 'docs', 'defects');

/** The active-or-retired patterns in docs/defects (not the README or the template). Files that are not valid patterns are left out. */
export const loadPatterns = (ragRoot) => {
  let names = [];
  try { names = fs.readdirSync(defectsDir(ragRoot)).filter((n) => n.endsWith('.md') && !n.startsWith('_') && n !== 'README.md'); } catch { return { found: false, patterns: [] }; }
  const patterns = [];
  for (const n of names.sort()) {
    const file = path.join(defectsDir(ragRoot), n);
    let fm; try { fm = parseFrontMatter(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const m = fm?.meta;
    if (!m || m.type !== 'defect-pattern' || m.id !== n.slice(0, -3)) continue;
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    patterns.push({ id: m.id, file, repos: list(m.repos), paths: list(m.paths), keywords: list(m.keywords), tickets: list(m.tickets), seen: Number.isInteger(m.seen) ? m.seen : 1, status: m.status || 'active', multiline: m._multiline || [] });
  }
  return { found: true, patterns };
};

/** The capability names a pattern may use: docs/implementations/*.md with `type: capability`, by their `capability:` field. */
export const capabilityNames = (ragRoot) => {
  const dir = path.join(ragRoot, 'docs', 'implementations');
  const out = [];
  let names = []; try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return out; }
  for (const n of names) {
    try {
      const m = parseFrontMatter(fs.readFileSync(path.join(dir, n), 'utf8'))?.meta;
      if (m?.type === 'capability' && typeof m.capability === 'string' && m.capability) out.push(m.capability);
    } catch { /* skip unreadable */ }
  }
  return [...new Set(out)].sort();
};

// ---------------------------------------------------------------- matching a defect to a pattern
/** A glob as a case-insensitive RegExp: `*` inside one folder, `**` across folders, `?` one character. */
export const globToRegExp = (g) => {
  let re = '';
  const s = norm(g);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') { if (s[i + 1] === '*') { re += '.*'; i++; if (s[i + 1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
};

/** The files a defect's PR changed that one of the pattern's globs covers, when the pattern is active and lists the defect's repo. Else []. */
export const matchPattern = (pattern, { repo, files }) => {
  if (pattern.status !== 'active' || !pattern.paths.length) return [];
  if (!pattern.repos.some((r) => r.toLowerCase() === String(repo || '').toLowerCase())) return [];
  const rx = pattern.paths.map(globToRegExp);
  return (files || []).map(norm).filter((f) => rx.some((r) => r.test(f)));
};

/** The defects that have a PR in the ledger, as { key, title, repo, files, category }: the facts the matching needs. */
export const defectsWithFiles = (defects, prIndex, categorize) => {
  const out = [];
  for (const d of defects) {
    const pr = prIndex.get(d.key);
    const files = (pr?.files || []).map((f) => (typeof f === 'string' ? f : f?.name)).filter((n) => n && !TRIVIAL_FILE.test(n));
    if (pr && files.length) out.push({ key: d.key, title: d.summary || '', repo: pr.repo, files: files.map(norm), category: categorize(d, pr) });
  }
  return out;
};

/** Which defects repeat which pattern. A ticket already listed in a pattern is counted as recorded and is not planned again. */
export const planRepeats = (defects, patterns) => {
  const matches = []; const matched = new Set(); let recorded = 0;
  for (const p of patterns) {
    const fresh = [];
    for (const d of defects) {
      const hit = matchPattern(p, d);
      if (!hit.length) continue;
      matched.add(d.key);
      if (p.tickets.includes(d.key)) recorded++; else fresh.push({ key: d.key, title: d.title, files: hit });
    }
    if (fresh.length) matches.push({ patternId: p.id, seen: p.seen, tickets: fresh });
  }
  return { matches, matched, recorded };
};

// ---------------------------------------------------------------- recording repeats: seen + 1 and the ticket, nothing else
/**
 * The pattern text with `seen` raised and the new tickets added to `tickets`. Only those two lines change. Refuses (ok false, with a reason) when
 * either is not a single line, so a file written another way is left alone rather than rewritten.
 */
export const bumpPatternText = (text, newTickets) => {
  const m = FM.exec(text);
  if (!m) return { ok: false, reason: 'no front matter' };
  const lines = m[1].split('\n');
  const si = lines.findIndex((l) => /^seen:\s*\d+\s*$/.test(l));
  const ti = lines.findIndex((l) => /^tickets:\s*\[.*\]\s*$/.test(l));
  if (si < 0 || ti < 0) return { ok: false, reason: '`seen` or `tickets` is not on one line' };
  let have; try { have = JSON.parse(lines[ti].slice(lines[ti].indexOf('['))); } catch { return { ok: false, reason: '`tickets` could not be read' }; }
  if (!Array.isArray(have)) return { ok: false, reason: '`tickets` is not a list' };
  const add = [...new Set(newTickets)].filter((k) => !have.includes(k));
  if (!add.length) return { ok: true, text, added: [], seen: Number(lines[si].replace(/\D/g, '')) };
  const seen = Number(lines[si].replace(/\D/g, '')) + add.length;
  lines[si] = `seen: ${seen}`;
  lines[ti] = `tickets: [${[...have, ...add].map((k) => JSON.stringify(k)).join(', ')}]`;
  return { ok: true, text: `---\n${lines.join('\n')}\n---\n${text.slice(m[0].length)}`, added: add, seen };
};

/**
 * Writes the planned repeats into the pattern files, one atomic replace per file. Re-reads each file first, so a ticket that was added in the
 * meantime is not counted twice. Returns { updated: [{ id, added, seen }], skipped: [{ id, reason }] }.
 */
export const applyRepeats = (plan, patterns, ragRoot) => {
  const updated = []; const skipped = [];
  const dir = path.resolve(defectsDir(ragRoot));
  for (const m of plan.matches) {
    const p = patterns.find((x) => x.id === m.patternId);
    if (!p || path.dirname(path.resolve(p.file)) !== dir) { skipped.push({ id: m.patternId, reason: 'the pattern file is not in docs/defects' }); continue; }
    if (p.status !== 'active') { skipped.push({ id: p.id, reason: 'the pattern is retired' }); continue; }
    let text; try { text = fs.readFileSync(p.file, 'utf8'); } catch (e) { skipped.push({ id: p.id, reason: `could not be read (${e.code || 'error'})` }); continue; }
    const r = bumpPatternText(text, m.tickets.map((t) => t.key));
    if (!r.ok) { skipped.push({ id: p.id, reason: r.reason }); continue; }
    if (!r.added.length) continue;
    const tmp = `${p.file}.tmp-${process.pid}`;
    try { fs.writeFileSync(tmp, r.text); fs.renameSync(tmp, p.file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } skipped.push({ id: p.id, reason: `could not be written (${e.code || 'error'})` }); continue; }
    updated.push({ id: p.id, added: r.added, seen: r.seen });
  }
  return { updated, skipped };
};

// ---------------------------------------------------------------- clusters: candidates for a new pattern
const kebab = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const baseOf = (f) => f.split('/').pop();

/**
 * Defects with no pattern that changed the same file: at least `minSize` tickets in a repo. Biggest first; a cluster whose tickets are mostly in
 * a bigger one already kept is dropped, so one problem is not listed twice. Each carries the files most of its tickets share.
 */
export const findClusters = (defects, matchedKeys, { minSize = 3, limit = 3 } = {}) => {
  const open = defects.filter((d) => !matchedKeys.has(d.key));
  const by = new Map();
  for (const d of open) for (const f of new Set(d.files)) { const k = `${d.repo}\u0000${f}`; (by.get(k) || by.set(k, new Set()).get(k)).add(d.key); }
  const ranked = [...by.entries()].filter(([, s]) => s.size >= minSize).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const kept = [];
  for (const [k, keys] of ranked) {
    if (kept.some((c) => [...keys].filter((x) => c.keys.has(x)).length / keys.size >= 0.8)) continue;
    kept.push({ repo: k.split('\u0000')[0], keys });
    if (kept.length >= limit) break;
  }
  const byKey = new Map(open.map((d) => [d.key, d]));
  return kept.map(({ repo, keys }) => {
    const rows = [...keys].map((x) => byKey.get(x));
    const fileCount = new Map();
    for (const r of rows) for (const f of new Set(r.files)) fileCount.set(f, (fileCount.get(f) || 0) + 1);
    const files = [...fileCount.entries()].filter(([, n]) => n >= Math.ceil(rows.length * 0.6)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([f]) => f);
    const cats = new Map(); for (const r of rows) cats.set(r.category, (cats.get(r.category) || 0) + 1);
    const category = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const id = crypto.createHash('sha1').update(`${repo}|${files.join('|')}`).digest('hex').slice(0, 8);
    return { id, repo, files, category, count: rows.length, tickets: rows.slice(0, 10).map((r) => ({ key: r.key, title: r.title, category: r.category })), suggestedName: kebab(`${baseOf(files[0] || 'files').replace(/\.[^.]+$/, '')}-${category}`).slice(0, 60) };
  });
};
