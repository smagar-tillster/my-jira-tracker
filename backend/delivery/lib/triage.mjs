// Rules that decide how much reading a merged or open PR gets (no AI here). Thresholds live in config.json "analysis".
//   simple   tiny change, or only CI/docs/tests/styles/translations/assets: a rules-only entry is written, no AI, nothing pending
//   standard ordinary code change: no AI unless the user asks (button), nothing flagged as pending
//   complex  version bump, reference to other PRs, sensitive path, or a large runtime change: AI analysis recommended (still on request)
import fs from 'node:fs';
import path from 'node:path';
import { kindOf } from './prpacket.mjs';
import { DATA_DIR, CONFIG_FILE } from './paths.mjs';

export const ANALYSIS_DIR = path.join(DATA_DIR, 'pr-analysis');
const DEFAULTS = {
  standardBudget: 8000, standardPatchLines: 40, complexBudget: 16000, complexPatchLines: 70,
  complexIfRuntimeLines: 400, complexIfFiles: 15, complexPathPattern: 'payment|cardholder|auth|security|token|oauth|encrypt',
  simpleMaxFiles: 3, simpleMaxLines: 30, simpleNonRuntimeMaxLines: 800,
  model: 'haiku', complexModel: 'haiku', relatedMax: 3,
};
export const analysisConfig = () => {
  try { return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).analysis || {}) }; } catch { return { ...DEFAULTS }; }
};
export const TIER_NAMES = { skip: 'simple', light: 'standard', deep: 'complex' }; // names used by older ledger entries
export const normTier = (t) => TIER_NAMES[t] || t || null;

const NON_RUNTIME_KINDS = new Set(['translations', 'styles', 'assets', 'test']);
const nonRuntime = (f) => /(^|\/)\.github\//.test(f.name) || /\.(md|mdx|txt)$/i.test(f.name) || NON_RUNTIME_KINDS.has(f.kind);

/** p: { files: [{name, add, del, kind?}], bumps: [], refs: [] } -> { tier, why, lines, runtimeLines } */
export const tierOf = (p, A = analysisConfig()) => {
  const files = (p.files || []).map((f) => ({ ...f, kind: f.kind || kindOf(f.name) }));
  const size = (f) => (f.add || 0) + (f.del || 0);
  const lines = files.reduce((s, f) => s + size(f), 0);
  const runtimeLines = files.filter((f) => !nonRuntime(f)).reduce((s, f) => s + size(f), 0); // fixtures, docs, CI do not count as "large"
  const sensitive = new RegExp(A.complexPathPattern, 'i');
  const bumpOnly = (p.bumps || []).length > 0 && !(p.refs || []).length && files.length > 0 && files.every((f) => f.kind === 'build' || nonRuntime(f));
  if (bumpOnly) return { tier: 'simple', why: `version bump only (${p.bumps.map((b) => b.name).slice(0, 3).join(', ')})`, lines, runtimeLines }; // the bump itself is already shown by the rules
  const hard = [];
  // a bump alongside code is routine (the rules already list it); only a major-version jump or a new/removed dependency needs reading
  const major = (v) => parseInt(String(v ?? '').replace(/^\D+/, ''), 10);
  const bigBumps = (p.bumps || []).filter((b) => b.from == null || b.to == null || major(b.from) !== major(b.to));
  if (bigBumps.length) hard.push(`major or new/removed dependency (${bigBumps.map((b) => b.name).slice(0, 3).join(', ')})`);
  if ((p.refs || []).length) hard.push(`references ${p.refs.length} other PR(s)`);
  if (hard.length) return { tier: 'complex', why: hard.join('; '), lines, runtimeLines };
  if (files.length && files.every(nonRuntime) && lines <= A.simpleNonRuntimeMaxLines) {
    return { tier: 'simple', why: `CI, docs, tests, styles or translations only (${files.length} file(s), ${lines} lines)`, lines, runtimeLines };
  }
  const soft = [];
  if (files.some((f) => !nonRuntime(f) && sensitive.test(f.name))) soft.push('sensitive path');
  if (runtimeLines > A.complexIfRuntimeLines) soft.push(`large (${runtimeLines} runtime lines)`);
  if (files.length > A.complexIfFiles) soft.push(`${files.length} files`);
  if (soft.length) return { tier: 'complex', why: soft.join('; '), lines, runtimeLines };
  if (files.length <= A.simpleMaxFiles && lines <= A.simpleMaxLines) return { tier: 'simple', why: `tiny (${files.length} file(s), ${lines} lines)`, lines, runtimeLines };
  return { tier: 'standard', why: 'ordinary change', lines, runtimeLines };
};

/** The entry written for simple PRs: facts from the file list only, flagged ai:false so the UI never calls it a review. */
export const rulesEntry = ({ repo, number, ticket, files, bumps = [], today }) => {
  const rows = (files || []).map((f) => ({ ...f, kind: f.kind || kindOf(f.name) }));
  const add = rows.reduce((s, f) => s + (f.add || 0), 0);
  const del = rows.reduce((s, f) => s + (f.del || 0), 0);
  const ci = rows.length > 0 && rows.every((f) => /(^|\/)\.github\//.test(f.name));
  const what = ci ? 'CI/workflow files' : `only ${[...new Set(rows.map((f) => f.kind))].join('/')}`;
  const bumpText = bumps.map((b) => `${b.name} ${b.from ?? 'new'} → ${b.to ?? 'removed'}`).join('; ');
  return {
    repo, number, ticket: ticket || null, generatedAt: today, ai: false, tier: 'simple', basis: 'rules only (no AI): file list, sizes and version changes', risk: 'low',
    summary: bumps.length
      ? `Version bump: ${bumpText} (${rows.length} file(s), +${add}/-${del}). Not read in depth.`
      : `${ci ? 'Pipeline change' : 'Small change'} (${rows.length} file(s), +${add}/-${del}) touching ${what}: ${rows.map((f) => f.name).slice(0, 3).join(', ')}${rows.length > 3 ? ` +${rows.length - 3} more` : ''}. Not read in depth.`,
    how: [], dependencies: ['None found by the rules.'], confirm: [],
  };
};

export const writeAnalysis = (a) => {
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ANALYSIS_DIR, `${a.repo}__${a.number}.json`), JSON.stringify(a, null, 2));
};
