#!/usr/bin/env node
// Build analysis packets (markdown) for merged PRs that rules say need an AI read, with related earlier PRs from the ledger as context.
// Rules only; needs Jira creds and the user's gh login, so run it from the user's terminal.
// Usage: node pr-packet.mjs --missing                       every merged PR in .cache/daily.json that has no analysis yet
//        node pr-packet.mjs --repo kiosk-web-service --pr 493,495   specific PRs of one repo
//        add --complex to force the complex tier, --standard to force the standard tier (overrides triage)
// Triage (lib/triage.mjs, thresholds in config.json "analysis"): simple = rules-only entry written (no AI), standard = small packet,
// complex = bigger packet (version bump, other-PR references, sensitive path, large runtime change). daily.mjs already writes the simple entries.
// A named PR (--repo/--pr) always gets a packet, whatever its tier, because the user asked for it.
// Packets go to .cache/pr-packets/<repo>__<number>.md ; analyses live in pr-analysis/<repo>__<number>.json ; the plan to .cache/pr-packets/triage.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArgs, CACHE_DIR, today } from '../lib/jira.mjs';
import { packetFor } from '../lib/prpacket.mjs';
import { tierOf, rulesEntry, writeAnalysis, analysisConfig, ANALYSIS_DIR } from '../lib/triage.mjs';
import { relatedPrs, relatedMarkdown } from '../lib/prrelated.mjs';
import { loadPrLedger } from '../lib/prledger.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const A = analysisConfig();
const root = String(cfg.root).replace(/^~/, os.homedir());
const a = parseArgs(process.argv.slice(2));
const gh = async (args) => JSON.parse((await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout || 'null');
const slugOf = (dir) => execFileSync('git', ['-C', path.join(root, dir), 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim().replace(/^(git@github\.com:|https:\/\/github\.com\/)/, '').replace(/\.git$/, '');

let todo = [];
if (a.missing) {
  const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'daily.json'), 'utf8'));
  for (const r of d.mergedByRepo) for (const p of r.prs) if (!fs.existsSync(path.join(ANALYSIS_DIR, `${p.repo}__${p.number}.json`))) todo.push({ repo: p.repo, number: p.number, ticket: (p.keys || [])[0] || null });
} else if (a.repo && a.pr) {
  todo = String(a.pr).split(',').map((n) => ({ repo: String(a.repo), number: Number(n.trim()), ticket: null }));
} else { console.error('Usage: pr-packet.mjs --missing | --repo REPO --pr N[,N]  [--deep|--light]'); process.exit(2); }

const out = path.join(CACHE_DIR, 'pr-packets');
fs.mkdirSync(out, { recursive: true });
const ledger = loadPrLedger();
const plan = [];
for (const t of todo) {
  try {
    const slug = slugOf(t.repo);
    // first pass with the small budget; deep PRs are rebuilt with the bigger one
    let r = await packetFor({ gh, slug, repo: t.repo, number: t.number, budget: A.standardBudget, patchLines: A.standardPatchLines });
    let { tier, why } = tierOf(r);
    if (a.complex || a.deep) { tier = 'complex'; why = 'forced (--complex)'; } else if (a.standard || a.light) { tier = 'standard'; why = 'forced (--standard)'; }
    if (tier === 'complex') r = await packetFor({ gh, slug, repo: t.repo, number: t.number, budget: A.complexBudget, patchLines: A.complexPatchLines });
    const ticket = t.ticket || r.keys[0] || null;
    if (tier === 'simple' && !a.repo) {
      writeAnalysis(rulesEntry({ repo: t.repo, number: t.number, ticket, files: r.files, bumps: r.bumps, today: today() }));
      plan.push({ ...t, ticket, tier, why, packet: null, kb: 0, related: 0 });
      console.log(`${t.repo}#${t.number}: SKIP  (${why}) -> rules-only entry written`);
      continue;
    }
    const hits = relatedPrs(ledger, { id: `${t.repo}#${t.number}`, repo: t.repo, keys: r.keys, files: r.files }, A.relatedMax);
    const md = `${r.md}\n\n${relatedMarkdown(hits)}`;
    const f = path.join(out, `${t.repo}__${t.number}.md`);
    fs.writeFileSync(f, md);
    plan.push({ ...t, ticket, tier, why, packet: f, kb: Math.round(md.length / 102.4) / 10, related: hits.length, model: tier === 'complex' ? A.complexModel : A.model });
    console.log(`${t.repo}#${t.number}: ${tier.toUpperCase().padEnd(5)} (${why}) ${(md.length / 1024).toFixed(1)} KB, ${hits.length} related -> ${f}`);
  } catch (e) { console.log(`${t.repo}#${t.number}: FAILED ${String(e.stderr || e.message).split('\n')[0]}`); }
}
fs.writeFileSync(path.join(out, 'triage.json'), JSON.stringify({ generatedAt: new Date().toISOString(), plan }, null, 2));
const n = (k) => plan.filter((p) => p.tier === k).length;
const kb = plan.reduce((s, p) => s + p.kb, 0);
console.log(`\n${todo.length} PRs: ${n('simple')} simple (no AI), ${n('standard')} standard, ${n('complex')} complex. Packets total ${kb.toFixed(1)} KB (~${Math.round(kb * 1024 / 4 / 1000)}k tokens to read). Model: ${A.model}/${A.complexModel}.`);
console.log(`Plan: ${path.join(out, 'triage.json')}. Next: a ${A.model} subagent reads each packet and writes ${ANALYSIS_DIR}/<repo>__<number>.json, then re-run the report.`);
