#!/usr/bin/env node
// AI analysis of ONE PR (merged or open), on request: rules build the packet and the related-PR context, a cheap model (haiku) writes the reading.
// Called by the My Tracker backend when the user clicks "Analyze with AI" on a PR; can also be run by hand.
//   node analyze-pr.mjs --repo kiosk-ui --pr 9287
// Needs Jira creds (backend/.env), the user's gh login, and the `claude` CLI signed in to the permitted organization.
// Exit codes: 0 analysis written, 3 the claude CLI is not usable (a request is saved in pr-analysis/requests/ so a Claude session can do it), 1 other failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArgs, today, CACHE_DIR } from '../lib/jira.mjs';
import { packetFor } from '../lib/prpacket.mjs';
import { tierOf, analysisConfig, writeAnalysis, ANALYSIS_DIR } from '../lib/triage.mjs';
import { relatedPrs, relatedMarkdown } from '../lib/prrelated.mjs';
import { loadPrLedger, savePrLedger } from '../lib/prledger.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const A = analysisConfig();
const a = parseArgs(process.argv.slice(2));
const repo = String(a.repo || ''); const number = Number(a.pr);
if (!cfg.repos.includes(repo) || !Number.isInteger(number) || number <= 0) { console.error('Usage: analyze-pr.mjs --repo <configured repo> --pr <number>'); process.exit(1); }
const root = String(cfg.root).replace(/^~/, os.homedir());
const gh = async (args) => JSON.parse((await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout || 'null');
const slug = execFileSync('git', ['-C', path.join(root, repo), 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim().replace(/^(git@github\.com:|https:\/\/github\.com\/)/, '').replace(/\.git$/, '');
const id = `${repo}#${number}`;

// 1. packet (small first; rebuilt bigger when the rules call the PR complex) + related earlier PRs (retrieval from the PR ledger)
let r = await packetFor({ gh, slug, repo, number, budget: A.standardBudget, patchLines: A.standardPatchLines });
const tier = tierOf(r);
if (tier.tier === 'complex') r = await packetFor({ gh, slug, repo, number, budget: A.complexBudget, patchLines: A.complexPatchLines });
const ledger = loadPrLedger();
const hits = relatedPrs(ledger, { id, repo, keys: r.keys, files: r.files }, A.relatedMax);
const packet = `${r.md}\n\n${relatedMarkdown(hits)}`;
const model = tier.tier === 'complex' ? A.complexModel : A.model;

const PROMPT = `You review one pull request for a Tillster engineer. Read the packet on stdin (ticket text, PR text, commits, changed files, dependency facts found by rules, trimmed patches, related earlier PRs) and reply with ONLY one JSON object, no prose, no code fence:
{"risk":"low|medium|high","summary":"2-3 sentences: what the change does","how":["bullets on the implementation"],"dependencies":["your reading beyond the rule facts: other components, deploy order, config or schema prerequisites"],"confirm":["specific things the engineer should verify: null/default handling, consumers of a changed API, unchecked checklist items, anything in the ticket the diff does not do"]}
Rules: base every statement on the packet; never claim something the diff or ticket does not show; put uncertainty in "confirm"; related earlier PRs are context only, not facts about this PR; American English; no card data, secrets or personal data.`;

// 2. the cheap model, headless. No tools: it only reads the packet.
const bin = [path.join(os.homedir(), '.local', 'bin', 'claude'), 'claude'].find((b) => b === 'claude' || fs.existsSync(b));
const env = { ...process.env, PATH: `${process.env.PATH || ''}:${path.join(os.homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin` };
const res = spawnSync(bin, ['-p', PROMPT, '--model', model, '--tools', '', '--no-session-persistence', '--output-format', 'text'], { input: packet, encoding: 'utf8', env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
const text = `${res.stdout || ''}`.trim();
const json = (() => { const s = text.indexOf('{'); const e = text.lastIndexOf('}'); if (s < 0 || e < s) return null; try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; } })();

if (res.status !== 0 || !json || !json.summary) {
  const why = (res.error?.message || `${res.stderr || ''}${text}`).split('\n').map((l) => l.trim()).filter((l) => l && !/^Permission ask rule|MCP servers blocked/i.test(l))[0] || 'no usable answer from the claude CLI';
  fs.mkdirSync(path.join(ANALYSIS_DIR, 'requests'), { recursive: true });
  fs.writeFileSync(path.join(ANALYSIS_DIR, 'requests', `${repo}__${number}.json`), JSON.stringify({ repo, number, requestedAt: new Date().toISOString(), reason: why, tier: tier.tier, packetKb: Math.round(packet.length / 102.4) / 10 }, null, 2));
  console.log(`CLI_UNAVAILABLE: ${why}`);
  console.log(`Saved a request for ${id}; ask Claude "analyze requested PRs".`);
  process.exit(3);
}

// 3. validate, store, and patch what the app reads
const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 8) : []);
const analysis = {
  repo, number, ticket: r.keys[0] || null, generatedAt: today(), ai: true, model, tier: tier.tier,
  basis: `packet: PR text, ticket, trimmed patches (${(packet.length / 1024).toFixed(1)} KB), ${hits.length} related earlier PR(s); read by ${model}`,
  risk: ['low', 'medium', 'high'].includes(json.risk) ? json.risk : 'medium', summary: String(json.summary).slice(0, 700), how: list(json.how), dependencies: list(json.dependencies), confirm: list(json.confirm),
};
writeAnalysis(analysis);
try { fs.rmSync(path.join(ANALYSIS_DIR, 'requests', `${repo}__${number}.json`), { force: true }); } catch { /* no request to clear */ }
if (ledger.prs[id]) { ledger.prs[id].analysis = analysis; savePrLedger(ledger, today(), []); }
const DELIVERY = path.join(CACHE_DIR, 'data', 'delivery.json');
try {
  const d = JSON.parse(fs.readFileSync(DELIVERY, 'utf8'));
  for (const row of [...d.prs, ...(d.openPrs || [])]) if (row.id === id) { row.analysis = analysis; row.risk = analysis.risk; row.rulesOnly = false; row.aiRecommended = false; }
  d.pendingAi = d.prs.filter((p) => p.day === d.day && p.aiRecommended).length;
  fs.writeFileSync(DELIVERY, JSON.stringify(d));
} catch { /* no data file yet: the next report run picks the analysis up */ }
console.log(`${id}: analyzed by ${model} (${analysis.risk} risk) from a ${(packet.length / 1024).toFixed(1)} KB packet with ${hits.length} related PR(s)`);
