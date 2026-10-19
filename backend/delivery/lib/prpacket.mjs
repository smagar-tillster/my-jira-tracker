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

const PRIO = { build: 0, source: 1, config: 2, test: 3, translations: 4, styles: 5, assets: 9 };

export const packetFor = async ({ gh, slug, repo, number, budget: maxChars = 20000, patchLines = 70 }) => {
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
  const shown = rows.filter((r) => !SKIP.test(r.name) && r.patch).sort((a, b) => PRIO[a.kind] - PRIO[b.kind] || (b.add + b.del) - (a.add + a.del));
  let budget = maxChars; const patches = [];
  for (const r of shown) {
    const lines = r.patch.split('\n');
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
    '## PR description', (v.body || '(empty)').slice(0, 3000), '',
    `## Commits (${(v.commits || []).length})`, ...(v.commits || []).slice(0, 25).map((c) => `- ${c.messageHeadline}`), '',
    '## Dependency facts (by rules)',
    `- version bumps: ${bumps.length ? bumps.map((b) => `${b.name} ${b.from ?? 'new'} -> ${b.to ?? 'removed'} (${b.file})`).join('; ') : 'none'}`,
    `- PRs referenced: ${refs.length ? refs.map((r) => `${r.slug}#${r.number}`).join(', ') : 'none'}`, '',
    '## Changed files',
    ...rows.map((r) => `- ${r.name} [${r.kind}, ${r.status}] +${r.add}/-${r.del}`), '',
    `## Patches (trimmed; ${patches.length} of ${shown.length} files with patches)`, ...patches,
  ].join('\n');
  return { md, keys, files: rows.map(({ patch, ...r }) => r), bumps, refs, title: v.title, additions: v.additions, deletions: v.deletions };
};
