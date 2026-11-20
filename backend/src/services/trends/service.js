// Trends as a service: a manual read of the sprint tickets from Jira (one at a time), and the monthly counts built from the local copy.
import * as store from './store.js';
import { runTrendsSync } from './sync.js';
import { aggregate, ticketsInView, resolveMonths, BASES, GROUPS } from './aggregate.js';
import { getAllFETeamMembers } from '../feteamService.js';
import { analyzeDefects, defectsInView, categorize } from './defects.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadPatterns, capabilityNames, defectsWithFiles, planRepeats, applyRepeats, findClusters, parseFrontMatter } from './patterns.js';
import { draftPattern, validatePattern } from './patternDraft.js';
import { runIngest } from './ragIngest.js';
import { reviewConfig } from '../../../delivery/lib/reviews.mjs';
import { loadPrLedger } from '../../../delivery/lib/prledger.mjs';
import { ledgerIndex } from './ledger.js';
import { jiraUrl } from '../../../delivery/lib/jira.mjs';
import { generateGuidance, cachedGuidance } from './guidance.js';

export const MONTH_CHOICES = [3, 6, 'ytd'];

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
  let adding = false;
  // the RAG's ingest runs in the background: files are written at once, and ingest is queued behind whatever is already running (one at a time,
  // and anything queued while it runs is covered by one more run). The state lives in this process: closing the page does not stop it.
  const job = { running: false, pending: false, startedAt: null, finishedAt: null, result: null };
  const stamp = () => new Date(now()).toISOString();
  const queueIngest = (root) => {
    if (job.running) { job.pending = true; return; }
    const run = () => {
      job.running = true; job.pending = false; job.startedAt = stamp();
      Promise.resolve().then(() => ingest({ ragRoot: root })).catch((e) => ({ ok: false, reason: String(e?.message || e).slice(0, 200) }))
        .then((r) => { job.running = false; job.finishedAt = stamp(); job.result = { ok: !!r?.ok, reason: r?.reason || '' }; if (job.pending) run(); });
    };
    run();
  };
  /** { state: running | done | failed | idle, startedAt, finishedAt, reason }: what the page shows as "Queued, done when done". */
  const ingestStatus = () => ({ state: job.running ? 'running' : job.result ? (job.result.ok ? 'done' : 'failed') : 'idle', startedAt: job.startedAt, finishedAt: job.finishedAt, reason: job.result?.reason || '' });

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

  const ticketList = ({ basis = 'resolved', months = 6, filters = {} } = {}) => {
    const host = String(process.env.JIRA_HOST || '').replace(/\/$/, '');
    return ticketsInView({ rows: store.allRows(), basis, months, filters, feMembers: filters.feTeam ? feMembers() : new Set(), now: now() })
      .map((t) => ({ ...t, url: host ? `${host}/browse/${t.key}` : '' }));
  };

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
  // a group the model said is not a pattern worth recording stays decided, so reopening the modal does not offer to ask (and pay) again
  const declinedKey = (clusterId) => `pattern-declined:${clusterId}`;
  const declinedFor = (clusterId) => { const h = store.getAi(declinedKey(clusterId)); return h ? { reason: h.value.reason, at: h.createdAt } : null; };
  const patternView = (st) => ({
    ragFound: st.found, ragRoot: st.root, patternCount: st.patterns.length,
    known: st.patterns.map((p) => ({ id: p.id, seen: p.seen, tickets: p.tickets.length, status: p.status, repos: p.repos })), defects: st.defects.length, withPr: st.withFiles.length, recorded: st.plan.recorded,
    ingest: ingestStatus(),
    matches: st.plan.matches.map((m) => ({ patternId: m.patternId, seen: m.seen, tickets: m.tickets.map((t) => ({ key: t.key, title: t.title })) })), clusters: st.clusters.map((c) => ({ ...c, declined: declinedFor(c.id) })),
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
      if (res.updated.length) queueIngest(st.root);                                  // the files are updated; ingest follows in the background
      return { ok: true, ...res, ingest: res.updated.length ? 'queued' : 'none', queuedAt: stamp(), ingestStatus: ingestStatus() };
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
      const out = await draft({ cluster: cl, tickets, capabilities: capabilityNames(st.root), existingIds: st.patterns.map((p) => p.id), today, ...(claude ? { claude } : {}) });
      if (out.notAPattern) store.putAi({ hash: declinedKey(cl.id), kind: 'pattern-declined', model: 'sonnet', value: { reason: out.reason }, at: new Date(now()).toISOString() });
      else if (out.ok) store.deleteAi(declinedKey(cl.id));       // drafted this time: the earlier "not a pattern" no longer stands
      return out;
    } finally { drafting = false; }
  };

  /**
   * Adds a reviewed pattern to the RAG as docs/defects/<id>.md, then runs ingest once. The text is checked again here against the RAG's own rules, whatever
   * was shown before, because a person may have edited it. Never overwrites: an id that already has a file is refused.
   */
  const addPattern = async ({ text } = {}) => {
    if (adding) return { busy: true };
    adding = true;
    try {
      const root = ragRoot();
      const { found, patterns } = loadPatterns(root);
      if (!found) return { ok: false, reason: `The RAG's defect patterns folder was not found at ${root}/docs/defects` };
      const body = String(text || '');
      const problems = validatePattern(body, { capabilities: capabilityNames(root) });
      if (problems.length) return { ok: false, reason: `The RAG's checks would fail: ${problems.join('; ')}`, problems };
      const meta = parseFrontMatter(body)?.meta || {};
      const id = String(meta.id || '');
      if (meta.type !== 'defect-pattern' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) return { ok: false, reason: 'The pattern needs type: defect-pattern and an id of lowercase words joined by hyphens', problems: [] };
      const dir = path.resolve(root, 'docs', 'defects');
      const file = path.join(dir, `${id}.md`);
      if (patterns.some((p) => p.id === id) || fs.existsSync(file)) return { ok: false, reason: `A pattern named ${id} already exists in the RAG; it was not overwritten. Change the id, or record the repeat on the existing one.`, problems: [] };
      try { fs.writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`, { flag: 'wx' }); }
      catch (e) { return { ok: false, reason: `The pattern could not be written (${e.code || 'error'})`, problems: [] }; }
      queueIngest(root);                                                             // the file is in the RAG now; ingest follows in the background
      return { ok: true, id, path: file, ingest: 'queued', addedAt: stamp(), ingestStatus: ingestStatus() };
    } finally { adding = false; }
  };

  // every public call may be given 'ytd' (this year so far) for months; the work below counts real months
  const inMonths = (fn) => (o = {}) => fn({ ...o, months: resolveMonths(o.months ?? 6, now()) });
  return { refresh, status, sprintTickets: inMonths(sprintTickets), ticketList: inMonths(ticketList), defectAnalysis: inMonths(defectAnalysis), defectGuidance: inMonths(defectGuidance), recordRepeats: inMonths(recordRepeats), draftForCluster: inMonths(draftForCluster), addPattern, ingestStatus, isRunning: () => running, isGuiding: () => guiding };
};

export const trendsService = createTrendsService();
export { BASES, GROUPS };
