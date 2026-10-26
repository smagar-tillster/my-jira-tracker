// Builds an "analysis packet" for one PR: everything needed to read it quickly and write an informed analysis.
// Rules only (no AI): PR metadata, ticket text, commits, changed files by kind, dependency findings, and trimmed patches.
// The packet is a markdown file that Claude reads to write pr-analysis/<repo>__<number>.json (summary, how it works, things to confirm).
import { jira } from './jira.mjs';
import { adfText } from './releases.mjs';
import { parseBumps, refsIn } from './prdeps.mjs';

const SKIP = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|pdf|min\.js)$|(^|\/)(dist|build|node_modules)\/)/i;
const BUILD = /(^|\/)(pom\.xml|package\.json|build\.gradle|gradle\.properties)$/;

export const kindOf = (f) => (BUILD.test(f) ? 'build'
  : /(^|\/)(src\/test|tests?|__tests__|spec)\/|\.(spec|test)\.[jt]sx?$|Test\.java$/.test(f) ? 'test'
  : /(i18n|lang|locale|translations?)[^/]*\.json$|\/(i18n|locales?|translations?)\//i.test(f) ? 'translations'
  : /\.(scss|css)$/.test(f) ? 'styles'
  : /\.(png|jpe?g|gif|svg|webp)$/i.test(f) ? 'assets'
  : /\.(json|ya?ml|properties|xml|conf|cnf|env)$/.test(f) ? 'config' : 'source');

// Adds the file line number to every diff line so a reviewer can anchor an inline comment exactly:
//   R<n> = line n of the new file (side RIGHT; added or unchanged lines)   L<n> = line n of the old file (side LEFT; deleted lines)
export const numberPatch = (patch) => {
  let o = 0; let n = 0;
  return String(patch || '').split('\n').map((line) => {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { o = Number(h[1]); n = Number(h[2]); return line; }
    if (line.startsWith('\\')) return line; // "\ No newline at end of file"
    const tag = line[0];
    if (tag === '+') return `${`R${n++}`.padEnd(7)}${line}`;
    if (tag === '-') return `${`L${o++}`.padEnd(7)}${line}`;
    const out = `${`R${n}`.padEnd(7)}${line}`; o++; n++; return out;
  }).join('\n');
};

const PRIO = { build: 0, source: 1, config: 2, test: 3, translations: 4, styles: 5, assets: 9 };

// ---- keep the packet small: the reviewer pays for every line it reads
// PR template text that says nothing about the change: checklists, empty evidence sections, bare attachment links.
const BOILERPLATE_HEADING = /^(developer checklist|reviewer checklist|testing artifacts)\b/i;
const PLACEHOLDER_LINE = /^(provide a brief explanation of the issue\.?|screenshot\/recording of behavior)$/i;

export const cleanBody = (body) => {
  const out = []; let skipLevel = null; let links = 0;
  for (const line of String(body || '').replace(/\r\n?/g, '\n').split('\n')) { // GitHub PR bodies use CRLF
    const h = line.match(/^(#{1,6})\s*(.*)$/);
    if (h) {
      if (skipLevel !== null && h[1].length > skipLevel) continue; // a sub-heading of a dropped section
      skipLevel = BOILERPLATE_HEADING.test(h[2].trim()) ? h[1].length : null;
      if (skipLevel !== null) continue;
    } else if (skipLevel !== null) continue;
    const t = line.trim();
    if (/^https?:\/\/\S+$/.test(t)) { links++; continue; }
    if (PLACEHOLDER_LINE.test(t)) continue;
    out.push(line);
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return links ? `${text}\n\n(${links} attachment link${links > 1 ? 's' : ''} omitted)`.trim() : text;
};

// A one-line translation change (a new key) needs no diff context: it is listed in one line instead.
export const TRIVIAL_MAX_LINES = 2;
export const isTrivialChange = (r) => r.kind === 'translations' && (r.add || 0) + (r.del || 0) <= TRIVIAL_MAX_LINES;
export const changedLines = (patch) => String(patch || '').split('\n').filter((l) => /^[+-][^+-]/.test(l)).map((l) => l.trim().replace(/^([+-])\s+/, '$1')).join(' ; ').slice(0, 160);

export const packetFor = async ({ gh, slug, repo, number, budget: maxChars = 20000, patchLines = 70, lineNumbers = false }) => {
  const v = await gh(['pr', 'view', String(number), '--repo', slug, '--json', 'title,body,author,mergedAt,state,url,baseRefName,headRefName,commits,additions,deletions,changedFiles']);
  const files = await gh(['api', `repos/${slug}/pulls/${number}/files?per_page=100`]);
  const keys = [...new Set(`${v.title} ${v.headRefName}`.toUpperCase().match(/NGK-\d+/g) || [])];

  let ticketMd = '';
  for (const k of keys.slice(0, 2)) {
    try {
      const r = await jira('GET', `/issue/${k}?fields=summary,description,status,components,issuetype`);
      ticketMd += `### ${k}: ${r.fields.summary}\n- type ${r.fields.issuetype?.name || '?'} · status ${r.fields.status?.name || '?'} · components ${(r.fields.components || []).map((c) => c.name).join(', ') || '-'}\n\n${adfText(r.fields.description).trim().slice(0, 2000) || '(no description)'}\n\n`;
    } catch { ticketMd += `### ${k}\n(could not read the Jira ticket)\n\n`; }
  }

  const rows = files.map((f) => ({ name: f.filename, status: f.status, add: f.additions, del: f.deletions, kind: kindOf(f.filename), patch: f.patch || '' }));
  const own = slug.split('/')[1];
  const bumps = rows.filter((r) => BUILD.test(r.name)).flatMap((r) => parseBumps(r.name, r.patch, own));
  const refs = refsIn(`${v.title}\n${v.body}`, slug, number);

  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const collapsed = rows.filter((r) => !SKIP.test(r.name) && r.patch && isTrivialChange(r));
  const shown = rows.filter((r) => !SKIP.test(r.name) && r.patch && !isTrivialChange(r)).sort((a, b) => PRIO[a.kind] - PRIO[b.kind] || (b.add + b.del) - (a.add + a.del));
  let budget = maxChars; const patches = [];
  for (const r of shown) {
    const lines = (lineNumbers ? numberPatch(r.patch) : r.patch).split('\n');
    const cut = lines.slice(0, patchLines).join('\n') + (lines.length > patchLines ? `\n… (${lines.length - patchLines} more lines)` : '');
    const chunk = `#### ${r.name} (${r.kind}, +${r.add}/-${r.del})\n\`\`\`diff\n${cut}\n\`\`\`\n`;
    if (chunk.length > budget && patches.length) break;
    patches.push(chunk); budget -= chunk.length;
  }

  const md = [
    `# ${repo}#${number}: ${v.title}`,
    `${v.url} · ${v.state} · merged ${v.mergedAt || '-'} · author ${v.author?.login || '?'} · ${v.headRefName} -> ${v.baseRefName}`,
    `${v.changedFiles} files, +${v.additions}/-${v.deletions}; by kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}`,
    '', '## Ticket', ticketMd || '(no NGK ticket found in the title or branch)',
    '## PR description', cleanBody(v.body).slice(0, 3000) || '(empty)', '',
    `## Commits (${(v.commits || []).length})`, ...(v.commits || []).slice(0, 25).map((c) => `- ${c.messageHeadline}`), '',
    '## Dependency facts (by rules)',
    `- version bumps: ${bumps.length ? bumps.map((b) => `${b.name} ${b.from ?? 'new'} -> ${b.to ?? 'removed'} (${b.file})`).join('; ') : 'none'}`,
    `- PRs referenced: ${refs.length ? refs.map((r) => `${r.slug}#${r.number}`).join(', ') : 'none'}`, '',
    '## Changed files',
    ...rows.map((r) => `- ${r.name} [${r.kind}, ${r.status}] +${r.add}/-${r.del}`), '',
    `## Patches (trimmed; ${patches.length} of ${shown.length} files with patches)`,
    ...(lineNumbers ? ['Line numbers: `R<n>` = line n of the NEW file (use side RIGHT; added and unchanged lines), `L<n>` = line n of the OLD file (use side LEFT; deleted lines). Only lines shown below can take an inline comment.', ''] : []),
    ...patches,
    ...(collapsed.length ? ['', `## Small translation changes (${collapsed.length} file${collapsed.length > 1 ? 's' : ''}, one line each; no diff shown, so no inline anchors)`, ...collapsed.map((r) => `- ${r.name} +${r.add}/-${r.del}: ${changedLines(r.patch)}`)] : []),
  ].join('\n');
  return { md, keys, files: rows.map(({ patch, ...r }) => r), bumps, refs, title: v.title, additions: v.additions, deletions: v.deletions };
};
