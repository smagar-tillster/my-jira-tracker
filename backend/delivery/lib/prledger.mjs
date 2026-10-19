// PR ledger: every merged PR the daily run has seen, with its tickets, tenants, dependency facts and (when written) the AI-assisted
// change understanding. Stored as prs/ledger.json plus one markdown file per PR and an index, so past changes can be queried
// (changes.mjs) or copied to the RAG data-feed folder. Mirrors the release ledger in lib/releases.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';

export const PR_DIR = path.join(DATA_DIR, 'prs');
const LEDGER = path.join(PR_DIR, 'ledger.json');
export const PR_MD_DIR = path.join(PR_DIR, 'md');
const ANALYSIS_DIR = path.join(DATA_DIR, 'pr-analysis');

export const loadPrLedger = () => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return { updated: null, prs: {} }; } };
export const loadAnalysis = (repo, n) => { try { return JSON.parse(fs.readFileSync(path.join(ANALYSIS_DIR, `${repo}__${n}.json`), 'utf8')); } catch { return null; } };

export const upsertPr = (ledger, rec, onDay) => {
  const prev = ledger.prs[rec.id];
  ledger.prs[rec.id] = { ...prev, ...rec, analysis: rec.analysis || prev?.analysis || null, firstSeen: prev?.firstSeen || onDay, lastSeen: onDay };
};

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const bullets = (arr) => (arr || []).map((s) => `- ${s}`);

export const prMd = (r) => {
  const a = r.analysis;
  const files = [...(r.files || [])].sort((x, y) => (y.add + y.del) - (x.add + x.del));
  const L = [`# ${r.repo}#${r.number} — ${r.line1} (merged ${String(r.mergedAt).slice(0, 10)})`, ''];
  L.push(`- PR: ${r.url} · author ${r.author} · merged ${r.mergedAt}`);
  L.push(`- Tickets: ${(r.tickets || []).map((t) => `${t.key}${t.summary ? ` (${t.summary})` : ''}`).join('; ') || 'none'}`);
  L.push(`- Tenants: ${(r.tenants || []).join(', ') || 'not set on the ticket'} · component (repo): ${r.component}`);
  L.push(`- What it builds: ${r.line1}${r.line2 ? `. ${r.line2}` : ''}`);
  if (a) L.push(`- Risk (AI-assisted): ${a.risk}`);
  L.push('');
  L.push('## Change understanding' + (a ? ' (AI-assisted reading of the diff and ticket; verify)' : ''));
  L.push('');
  if (a) { L.push(a.summary, '', 'How it works:', ...bullets(a.how), '', 'Dependencies (my reading):', ...bullets(a.dependencies)); }
  else L.push('_Not analyzed yet._');
  L.push('', '## Dependency facts (found by rules)', '');
  L.push(`- Version bumps: ${(r.bumps || []).length ? r.bumps.map((b) => `${b.name} ${b.from ?? 'new'} -> ${b.to ?? 'removed'} (${b.file})`).join('; ') : 'none'}`);
  L.push(`- PRs referenced: ${(r.refs || []).length ? r.refs.map((x) => `${String(x.slug).split('/')[1]}#${x.number} ${x.state}`).join(', ') : 'none'}`);
  L.push(`- Same ticket also merged in: ${(r.siblings || []).length ? r.siblings.map((s) => `${s.repo}#${s.number}`).join(', ') : 'no other repo'}`);
  L.push(`- Jira links: ${(r.links || []).length ? r.links.map((l) => `${l.rel} ${l.key} (${l.status})`).join('; ') : 'none'}`);
  L.push(`- Release declares: ${(r.declared || []).length ? r.declared.map((d) => `${d.release} ${d.status}: ${d.components.map((c) => c.name + (c.version ? ` (${c.version})` : '')).join(', ')}`).join('; ') : 'not in a release yet'}`);
  if ((r.needsOther || []).length) L.push(`- Components the release lists that these PRs do not cover: ${r.needsOther.map((c) => c.name).join(', ')}`);
  if (a?.confirm?.length) L.push('', '## Please confirm', '', ...bullets(a.confirm));
  L.push('', `## Files changed (${files.length}, +${files.reduce((s, f) => s + f.add, 0)}/-${files.reduce((s, f) => s + f.del, 0)})`, '', ...files.slice(0, 15).map((f) => `- ${f.name} +${f.add}/-${f.del}`));
  L.push('', `_First seen ${r.firstSeen}, last updated ${r.lastSeen}._`);
  return L.join('\n');
};

/** Tenant codes mentioned in a PR's title or ticket summaries (used when the Jira ticket has no Client). known = tenant codes seen in the release ledger. */
export const inferTenants = (r, known) => {
  const text = `${r.title} ${(r.tickets || []).map((t) => t.summary).join(' ')}`;
  const out = [];
  for (const t of known) {
    if (!t || t.startsWith('(')) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
    if (re.test(text)) out.push(t);
  }
  return out;
};

export const savePrLedger = (ledger, today, knownTenants = []) => {
  fs.mkdirSync(PR_MD_DIR, { recursive: true });
  ledger.updated = today;
  for (const r of Object.values(ledger.prs)) if (!(r.tenants || []).length && knownTenants.length) r.tenants = inferTenants(r, knownTenants);
  for (const r of Object.values(ledger.prs)) if (!r.analysis) r.analysis = loadAnalysis(r.repo, r.number); // pick up analyses written since
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  const all = Object.values(ledger.prs).sort((x, y) => String(y.mergedAt).localeCompare(String(x.mergedAt)));
  for (const r of all) fs.writeFileSync(path.join(PR_MD_DIR, `${r.repo}__${r.number}.md`), prMd(r));
  const idx = ['# Merged PR ledger', '', `Updated ${today}. ${all.length} merged PRs tracked; ${all.filter((r) => r.analysis).length} have an AI-assisted change understanding.`, '',
    '| Merged | PR | Tickets | Tenants | What it builds | Understanding | Risk |', '|---|---|---|---|---|---|---|'];
  for (const r of all) idx.push(`| ${String(r.mergedAt).slice(0, 10)} | ${r.repo}#${r.number} | ${cell(r.keys.join(', '))} | ${cell((r.tenants || []).join(', '))} | ${cell(r.line1)} | ${cell(r.analysis ? r.analysis.summary.slice(0, 160) : 'pending')} | ${r.analysis?.risk || '-'} |`);
  fs.writeFileSync(path.join(PR_DIR, 'PRS.md'), idx.join('\n') + '\n');
  return { count: all.length, analyzed: all.filter((r) => r.analysis).length, dir: PR_DIR };
};

/** Copy the PR markdown files to a RAG data-feed folder (only when the user supplies the path). */
export const copyPrsToRag = (ragDir) => {
  const dest = path.join(ragDir, 'ngk-prs');
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(PR_MD_DIR)) { fs.copyFileSync(path.join(PR_MD_DIR, f), path.join(dest, f)); n++; }
  fs.copyFileSync(path.join(PR_DIR, 'PRS.md'), path.join(dest, 'PRS.md'));
  return { dest, files: n + 1 };
};
