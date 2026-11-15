// Trends as a service: a manual read of the sprint tickets from Jira (one at a time), and the monthly counts built from the local copy.
import * as store from './store.js';
import { runTrendsSync } from './sync.js';
import { aggregate, BASES, GROUPS } from './aggregate.js';
import { getAllFETeamMembers } from '../feteamService.js';
import { analyzeDefects, defectsInView, categorize } from './defects.js';
import { loadPrLedger } from '../../../delivery/lib/prledger.mjs';
import { queueDefects, ledgerIndex, syncKb, kbStatus, kbConfig, syncDue } from './kb.js';
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

export const createTrendsService = ({ sync = runTrendsSync, now = () => new Date(), feMembers = () => new Set(getAllFETeamMembers()), claude, ledger = loadPrLedger, kbSync = syncKb, kbTickMs = 3600000 } = {}) => {
  let running = false;
  let guiding = false;
  let kbRunning = false;
  let kbTimer = null;

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

  /** The numbers and the rule-based focus, plus the model's guidance if these same numbers were answered before. Never calls the model. */
  const defectAnalysis = ({ months = 6, filters = {} } = {}) => {
    const facts = defectFacts({ months, filters });
    const scope = scopeText(filters);
    const guidance = cachedGuidance(facts, scope);
    // links are added to what the page gets, after the numbers are fixed: they are not part of what the model sees or what its answer is saved under
    const linked = { ...facts, categories: facts.categories.map((c) => ({ ...c, examples: c.examples.map((e) => ({ ...e, url: jiraUrl(e.key) })) })) };
    return { facts: linked, scope, guidance };
  };

  /** Asks the model for the guidance (one at a time). `busy` when another is already running. */
  const defectGuidance = async ({ months = 6, filters = {}, force = false } = {}) => {
    if (guiding) return { busy: true };
    guiding = true;
    try {
      const facts = defectFacts({ months, filters });
      // the defects looked at are queued for the defects knowledge base (those with a PR in the ledger); written later, once a day
      try {
        const { defects } = defectsInView({ rows: store.allRows(), months, filters, feMembers: filters.feTeam ? feMembers() : new Set(), now: now() });
        queueDefects({ defects, ledger: ledger(), categorize, now });
      } catch (e) { console.error('Queueing defects for the knowledge base failed:', e?.message || e); }
      return await generateGuidance({ facts, scope: scopeText(filters), force, now, ...(claude ? { claude } : {}) });
    } finally { guiding = false; }
  };

  /** Writes the new patterns to the defects feed and runs ingest. One at a time. `busy` when a sync is already going. */
  const kbSyncNow = async () => {
    if (kbRunning) return { busy: true };
    kbRunning = true;
    try { return await kbSync({ now }); } finally { kbRunning = false; }
  };
  const kbTick = () => {
    const cfg = kbConfig(); const st = kbStatus();
    if (kbRunning || !syncDue({ now: now(), lastRunAt: st.lastRunAt, hour: cfg.hour, disabled: cfg.disabled })) return;
    if (!st.pending && !st.ingestPending) return;                       // nothing waiting: not a run
    kbSyncNow().catch((e) => console.error('Defects knowledge base sync failed:', e?.message || e));
  };

  return {
    refresh, status, sprintTickets, defectAnalysis, defectGuidance, kbSyncNow, kbTick, kbStatus: () => ({ ...kbStatus(), hour: kbConfig().hour, disabled: kbConfig().disabled }),
    isRunning: () => running, isGuiding: () => guiding,
    // the defects knowledge base sync is the one thing that runs on a timer (checked hourly, runs at most once a day); nothing else does
    startKb: () => { if (kbTimer) return; kbTimer = setInterval(kbTick, kbTickMs); kbTimer.unref?.(); },
    stopKb: () => { clearInterval(kbTimer); kbTimer = null; },
  };
};

export const trendsService = createTrendsService();
export { BASES, GROUPS };
