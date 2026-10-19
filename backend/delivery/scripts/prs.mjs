#!/usr/bin/env node
// Step 1 of the delivery trace: PRs merged (and still open) across every repo in a folder, tied to NGK tickets.
// Read-only: only runs `gh pr list`. Uses the user's own gh login, so run it from the user's terminal.
// Usage: node prs.mjs [--repos kiosk-ui,kiosk-web-service,...] [--root ~/Documents/git/kiosk] [--since YYYY-MM-DD] [--include-forks]
//   --repos limits the scan to those folder names; default = every repo under --root.
//   default --root: $KIOSK_ROOT or ~/Documents/git/kiosk ; default --since: 14 days ago (local date)
// Writes .cache/prs.json and prints: per-repo counts, tickets with merged PRs, open PRs, merged PRs with no NGK key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { saveJson, parseArgs, md, today } from '../lib/jira.mjs';

const run = promisify(execFile);
const a = parseArgs(process.argv.slice(2));
const root = String(a.root || process.env.KIOSK_ROOT || path.join(os.homedir(), 'Documents/git/kiosk')).replace(/^~/, os.homedir());
const since = a.since || (() => { const d = new Date(Date.now() - 14 * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const slugOf = (dir) => {
  try {
    const url = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    return url.replace(/^(git@github\.com:|https:\/\/github\.com\/)/, '').replace(/\.git$/, '');
  } catch { return null; }
};

const repos = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, '.git')))
  .map((d) => ({ dir: d.name, slug: slugOf(path.join(root, d.name)) }))
  .filter((r) => r.slug);

// --repos limits the scan to those folder names (exact match).
const wanted = a.repos ? String(a.repos).split(',').map((x) => x.trim()).filter(Boolean) : null;
const unknown = wanted ? wanted.filter((w) => !repos.some((r) => r.dir === w)) : [];
if (unknown.length) console.error(`Not found under ${root}: ${unknown.join(', ')}`);
const skipped = [];
const scan = repos.filter((r) => !wanted || wanted.includes(r.dir)).filter((r) => {
  const isTillster = r.slug.toLowerCase().startsWith('tillster/');
  if (!isTillster && !a['include-forks']) { skipped.push(`${r.dir} (${r.slug}: not in tillster org, likely a fork; use --include-forks)`); return false; }
  return true;
});

const gh = async (args) => JSON.parse((await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout || '[]');
const keysOf = (...texts) => [...new Set(texts.join(' ').toUpperCase().match(/NGK-\d+/g) || [])];

const results = [];
const errors = [];
let i = 0;
const worker = async () => {
  while (i < scan.length) {
    const r = scan[i++];
    try {
      const merged = await gh(['pr', 'list', '--repo', r.slug, '--state', 'merged', '--search', `merged:>=${since}`, '--limit', '300',
        '--json', 'number,title,mergedAt,headRefName,baseRefName,author,url']);
      const open = await gh(['pr', 'list', '--repo', r.slug, '--state', 'open', '--limit', '100',
        '--json', 'number,title,createdAt,headRefName,baseRefName,author,isDraft,reviewDecision,url']);
      const shape = (p, state) => ({ repo: r.dir, slug: r.slug, state, number: p.number, title: p.title, branch: p.headRefName, base: p.baseRefName,
        author: p.author?.login || null, mergedAt: p.mergedAt || null, createdAt: p.createdAt || null, draft: !!p.isDraft,
        review: p.reviewDecision || null, url: p.url, keys: keysOf(p.title, p.headRefName) });
      results.push(...merged.map((p) => shape(p, 'merged')), ...open.map((p) => shape(p, 'open')));
    } catch (e) { errors.push(`${r.dir}: ${String(e.stderr || e.message).split('\n')[0]}`); }
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);

saveJson('prs.json', { today: today(), since, root, repos: scan.map((r) => r.dir), skipped, errors, prs: results });

const merged = results.filter((p) => p.state === 'merged');
const open = results.filter((p) => p.state === 'open');
const trunc = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

console.log(`# PR trace — merged since ${since}  (${scan.length} repos scanned)\n`);
const per = scan.map((r) => [r.dir, merged.filter((p) => p.repo === r.dir).length, open.filter((p) => p.repo === r.dir).length]).filter((x) => x[1] || x[2]).sort((x, y) => y[1] - x[1]);
console.log(md(per, ['Repo', 'Merged', 'Open']));

const byKey = new Map();
for (const p of merged) for (const k of p.keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
console.log(`\n## Tickets with merged PRs (${byKey.size})\n`);
console.log(md([...byKey.entries()].sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true })).map(([k, ps]) =>
  [k, ps.map((p) => `${p.repo}#${p.number}`).join(', '), ps.map((p) => p.mergedAt).sort().pop().slice(0, 10), trunc(ps[0].title)]), ['Ticket', 'PRs', 'Last merged', 'Title']));

console.log(`\n## Open PRs (${open.length})\n`);
console.log(md(open.sort((x, y) => x.repo.localeCompare(y.repo)).map((p) => [`${p.repo}#${p.number}`, p.keys.join(',') || '-', trunc(p.title, 60), p.author, p.draft ? 'draft' : (p.review || 'review pending'), (p.createdAt || '').slice(0, 10)]),
  ['PR', 'Ticket', 'Title', 'Author', 'State', 'Opened']));

const nokey = merged.filter((p) => !p.keys.length);
console.log(`\n## Merged PRs with no NGK key (${nokey.length})\n`);
console.log(md(nokey.map((p) => [`${p.repo}#${p.number}`, trunc(p.title), p.author, p.mergedAt.slice(0, 10)]), ['PR', 'Title', 'Author', 'Merged']));
if (skipped.length) console.log(`\nSkipped: ${skipped.join('; ')}`);
if (errors.length) console.log(`\nErrors: ${errors.join('; ')}`);
