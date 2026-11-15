// Trends as a service: a manual read of the sprint tickets from Jira (one at a time), and the monthly counts built from the local copy.
import * as store from './store.js';
import { runTrendsSync } from './sync.js';
import { aggregate, BASES, GROUPS } from './aggregate.js';
import { getAllFETeamMembers } from '../feteamService.js';
import { analyzeDefects, defectsInView, categorize } from './defects.js';
import { loadPatterns, capabilityNames, defectsWithFiles, planRepeats, applyRepeats, findClusters } from './patterns.js';
import { draftPattern } from './patternDraft.js';
import { runIngest } from './ragIngest.js';
import { reviewConfig } from '../../../delivery/lib/reviews.mjs';
import { loadPrLedger } from '../../../delivery/lib/prledger.mjs';
import { ledgerIndex } from './ledger.js';
import { jiraUrl } from '../../../delivery/lib/jira.mjs';
import { generateGuidance, cachedGuidance } from './guidance.js';

export const MONTH_CHOICES = [3, 6];

/** The scope in plain words for the model: counts only, never the names of clients or people. */
export const scopeText = (f = {}) => {
  const bits = [];
  if (f.feTeam) bits.push('FE team only');
  if (f.component?.length) bits.push(`fix component ${f.component.slice(0, 3).join(', ')}${f.component.length > 3 ? ' and more' : ''}`);   // component names are not personal data
  if (f.client?.length) bits.push(`${f.client.length} client${f.client.length === 1 ? '' : 's'} selected`);
  if (f.assignee?.length) bits.push(`${f.assignee.length} assignee${f.assignee.length === 1 ? '' : 's'} selected`);
  return bits.length ? bits.join('; ') : 'all done tickets';
};

export const createTrendsService = ({ sync = runTrendsSync, now = () => new Date(), feMembers = () => new Set(getAllFETeamMembers()), claude, ledger = loadPrLedger, ragRoot = () => reviewConfig().ragRoot, ingest = runIngest, draft = draftPattern } = {}) => {
  let running = false;
  let guiding = false;
  let recording = false;
  let drafting = false;

  /** Starts a read from Jira unless one is going. Returns true when started. */
  const refresh = () => {
    if (running) return false;
    running = true;
    let p;
    try { p = Promise.resolve(sync({ now })); } catch (e) { p = Promise.reject(e); }
    p.catch((e) => console.error('Trends sync failed:', e?.message || e)).finally(() => { running = false; });
    return true;
  };

  const status = () => {
    const s = store.getSync();
    return { running, lastSyncAt: s.lastSyncAt, lastStatus: running ? 'running' : s.lastStatus, lastError: s.lastError, lastDurationMs: s.lastDurationMs, tickets: store.count(), firstLoad: !s.lastSyncAt };
  };

  const sprintTickets = ({ basis = 'resolved', group = 'all', months = 6, filters = {} } = {}) =>
    aggregate({ rows: store.allRows(), basis, group, months, filters, feMembers: filters.feTeam ? feMembers() : new Set(), now: now() });

  const defectFacts = ({ months = 6, filters = {} } = {}) => analyzeDefects({ rows: store.allRows(), months, filters, feMembers: filters.feTeam ? feMembers() : new Set(), prs: ledgerIndex(ledger()), now: now() });

  // ---- the RAG's defect patterns: which defects repeat one, and which clusters might deserve a new one (never touches the RAG here)
  const patternState = ({ months = 6, filters = {} } = {}) => {
    const root = ragRoot();
    const { found, patterns } = loadPatterns(root);
    const { defects } = defectsInView({ rows: store.allRows(), months, filters, feMembers: filters.feTeam ? feMembers() : new Set(), now: now() });
    const withFiles = defectsWithFiles(defects, ledgerIndex(ledger()), categorize);
    const plan = planRepeats(withFiles, patterns);
    return { root, found, patterns, defects, withFiles, plan, clusters: findClusters(withFiles, plan.matched) };
  };
  const patternView = (st) => ({
    ragFound: st.found, ragRoot: st.root, patternCount: st.patterns.length, defects: st.defects.length, withPr: st.withFiles.length, recorded: st.plan.recorded,
    matches: st.plan.matches.map((m) => ({ patternId: m.patternId, seen: m.seen, tickets: m.tickets.map((t) => ({ key: t.key, title: t.title })) })), clusters: st.clusters,
  });

  /** The numbers, plus the model's guidance if these same numbers were answered before. Never calls the model. */
  const defectAnalysis = ({ months = 6, filters = {} } = {}) => {
    const facts = defectFacts({ months, filters });
    const scope = scopeText(filters);
    const guidance = cachedGuidance(facts, scope);
    // links are added to what the page gets, after the numbers are fixed: they are not part of what the model sees or what its answer is saved under
    const linked = { ...facts, categories: facts.categories.map((c) => ({ ...c, examples: c.examples.map((e) => ({ ...e, url: jiraUrl(e.key) })) })) };
    let patterns = null;
    try { patterns = patternView(patternState({ months, filters })); } catch (e) { console.error('Reading the defect patterns failed:', e?.message || e); }
    return { facts: linked, scope, guidance, patterns };
  };

  /** Asks the model for the guidance (one at a time). `busy` when another is already running. */
  const defectGuidance = async ({ months = 6, filters = {}, force = false } = {}) => {
    if (guiding) return { busy: true };
    guiding = true;
    try {
      const facts = defectFacts({ months, filters });
      return await generateGuidance({ facts, scope: scopeText(filters), force, now, ...(claude ? { claude } : {}) });
    } finally { guiding = false; }
  };

  /** Records the repeats in the pattern files (seen + 1, the ticket added) and runs the RAG's ingest once. One at a time. */
  const recordRepeats = async ({ months = 6, filters = {} } = {}) => {
    if (recording) return { busy: true };
    recording = true;
    try {
      const st = patternState({ months, filters });
      if (!st.found) return { ok: false, reason: `The RAG's defect patterns folder was not found at ${st.root}/docs/defects` };
      if (!st.plan.matches.length) return { ok: true, updated: [], skipped: [], ingest: 'none', reason: '' };
      const res = applyRepeats(st.plan, st.patterns, st.root);
      let ing = 'none'; let reason = '';
      if (res.updated.length) { const r = await ingest({ ragRoot: st.root }); ing = r.ok ? 'ok' : 'failed'; reason = r.reason || ''; }
      return { ok: true, ...res, ingest: ing, reason };
    } finally { recording = false; }
  };

  /** One model call: a draft pattern for a cluster in view, saved for review in the app's data folder (never in the RAG). */
  const draftForCluster = async ({ months = 6, filters = {}, cluster } = {}) => {
    if (drafting) return { busy: true };
    drafting = true;
    try {
      const st = patternState({ months, filters });
      if (!st.found) return { ok: false, reason: `The RAG's defect patterns folder was not found at ${st.root}/docs/defects` };
      const cl = st.clusters.find((c) => c.id === cluster);
      if (!cl) return { ok: false, reason: 'That group of defects is no longer in view. Reload the analysis.' };
      const rows = new Map(store.allRows().map((r) => [r.key, r]));
      const idx = ledgerIndex(ledger());
      const tickets = cl.tickets.map((t) => ({ key: t.key, title: t.title, description: rows.get(t.key)?.description || '', prTitle: idx.get(t.key)?.title || '' }));
      const d = new Date(now());
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return await draft({ cluster: cl, tickets, capabilities: capabilityNames(st.root), existingIds: st.patterns.map((p) => p.id), today, ...(claude ? { claude } : {}) });
    } finally { drafting = false; }
  };

  return { refresh, status, sprintTickets, defectAnalysis, defectGuidance, recordRepeats, draftForCluster, isRunning: () => running, isGuiding: () => guiding };
};

export const trendsService = createTrendsService();
export { BASES, GROUPS };
