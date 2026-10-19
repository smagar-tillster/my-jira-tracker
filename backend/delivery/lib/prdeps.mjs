// Deeper PR analysis: what each merged PR depends on, beyond its own repo. Deterministic and read-only.
//   1. Dependency bumps: version changes in pom.xml / package.json / build.gradle / gradle.properties (from the PR's file patches)
//   2. Cross-repo references: PRs mentioned in the PR title or description (org/repo#N or PR URLs), with their title and state
//   3. Sibling PRs: the same NGK ticket merged in other repos (which components must ship together)
//   4. Jira links: "blocks / is blocked by / depends on / relates to" on the PR's ticket, with the linked ticket's status
import { mapIssue, jiraUrl } from './jira.mjs';

const BUMP_FILES = /(^|\/)(pom\.xml|package\.json|build\.gradle|gradle\.properties)$/;

/** Version changes from one file's patch. Skips the module's own <version> (a release bump), keeps dependency/property versions. */
export const parseBumps = (file, patch, ownArtifact = '') => {
  if (!patch) return [];
  const removed = new Map(); const added = new Map();
  let lastArtifact = '';
  for (const line of patch.split('\n')) {
    const sign = line[0]; const body = line.slice(1);
    const art = body.match(/<artifactId>([^<]+)<\/artifactId>/);
    if (art) lastArtifact = art[1];
    else if (/<\/(dependency|plugin|parent)>/.test(body)) lastArtifact = ''; // a bare <version> after the block is not that dependency's
    if (sign !== '+' && sign !== '-') continue;
    let name = null; let ver = null; let m;
    if ((m = body.match(/<([\w.\-]+)>\s*([^<\s][^<]*?)\s*<\/\1>/)) && /version/i.test(m[1])) { name = m[1] === 'version' ? lastArtifact : m[1]; ver = m[2]; }
    else if ((m = body.match(/"([@\w./\-]+)"\s*:\s*"([\^~]?\d[^"]*)"/))) { name = m[1]; ver = m[2]; }
    else if ((m = body.match(/^\s*([\w.\-]+)\s*=\s*(\d[\w.\-]*)\s*$/))) { name = m[1]; ver = m[2]; }
    if (!name || name === ownArtifact || name === 'version') continue;
    (sign === '-' ? removed : added).set(name, ver);
  }
  const out = [];
  for (const [name, to] of added) { const from = removed.get(name) ?? null; if (from !== to) out.push({ file, name, from, to }); }
  for (const [name, from] of removed) if (!added.has(name)) out.push({ file, name, from, to: null });
  return out;
};

/** PRs mentioned in free text: https://github.com/org/repo/pull/N and org/repo#N. */
export const refsIn = (text, selfSlug, selfNumber) => {
  const seen = new Map();
  const add = (slug, n) => { if (slug.toLowerCase() === selfSlug.toLowerCase() && Number(n) === selfNumber) return; seen.set(`${slug}#${n}`, { slug, number: Number(n) }); };
  for (const m of String(text || '').matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)) add(m[1], m[2]);
  for (const m of String(text || '').matchAll(/(?<![\w/.-])([\w.-]+\/[\w.-]+)#(\d+)/g)) add(m[1], m[2]);
  return [...seen.values()];
};

const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); };

/**
 * merged: [{ repo, slug, number, keys, title, body, url }]
 * Returns Map("repo#number" -> { bumps, refs, siblings }) plus the referenced PR lookups.
 */
export const analyzeMerged = async ({ merged, gh }) => {
  const result = new Map();
  const refCache = new Map();
  await pool(merged, 4, async (p) => {
    const id = `${p.repo}#${p.number}`;
    const entry = { bumps: [], refs: [], siblings: [], files: [] };
    // 1. dependency bumps from file patches
    try {
      const files = await gh(['api', `repos/${p.slug}/pulls/${p.number}/files?per_page=100`]);
      const own = p.slug.split('/')[1];
      entry.files = files.map((f) => ({ name: f.filename, status: f.status, add: f.additions, del: f.deletions })); // for the PR modal
      for (const f of files) if (BUMP_FILES.test(f.filename)) entry.bumps.push(...parseBumps(f.filename, f.patch, own));
    } catch { /* patch unavailable: leave empty */ }
    // 2. cross-repo references
    for (const r of refsIn(`${p.title}\n${p.body}`, p.slug, p.number)) {
      const k = `${r.slug}#${r.number}`;
      if (!refCache.has(k)) {
        try { const v = await gh(['pr', 'view', String(r.number), '--repo', r.slug, '--json', 'title,state,mergedAt,url']); refCache.set(k, { ...r, title: v.title, state: v.state, mergedAt: v.mergedAt, url: v.url }); }
        catch { refCache.set(k, { ...r, title: '', state: 'UNKNOWN', url: `https://github.com/${r.slug}/pull/${r.number}` }); }
      }
      entry.refs.push(refCache.get(k));
    }
    result.set(id, entry);
  });
  // 3. sibling PRs: same ticket in other repos
  for (const p of merged) {
    const entry = result.get(`${p.repo}#${p.number}`);
    for (const k of p.keys) for (const o of merged) if (o.repo !== p.repo && o.keys.includes(k) && !entry.siblings.some((s) => s.repo === o.repo && s.number === o.number)) entry.siblings.push({ repo: o.repo, number: o.number, url: o.url, key: k });
  }
  return result;
};

/** Jira links on tickets: Map(key -> [{ rel, key, summary, status, statusCategory, url }]). */
export const jiraLinks = async ({ search, keys }) => {
  const out = new Map();
  const list = [...new Set(keys)];
  for (let i = 0; i < list.length; i += 80) {
    const raws = await search(`key in (${list.slice(i, i + 80).join(',')})`, ['summary', 'status', 'issuelinks', 'parent']);
    for (const raw of raws) {
      const links = [];
      for (const l of raw.fields.issuelinks || []) {
        const o = l.outwardIssue || l.inwardIssue;
        if (!o) continue;
        links.push({ rel: l.outwardIssue ? l.type.outward : l.type.inward, key: o.key, summary: o.fields?.summary || '', status: o.fields?.status?.name || '', statusCategory: o.fields?.status?.statusCategory?.name || '', url: jiraUrl(o.key) });
      }
      const par = raw.fields.parent;
      if (par) links.push({ rel: 'parent', key: par.key, summary: par.fields?.summary || '', status: par.fields?.status?.name || '', statusCategory: par.fields?.status?.statusCategory?.name || '', url: jiraUrl(par.key) });
      out.set(raw.key, links);
    }
  }
  void mapIssue;
  return out;
};
