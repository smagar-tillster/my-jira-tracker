// Trends as a service: a manual read of the sprint tickets from Jira (one at a time), and the monthly counts built from the local copy.
import * as store from './store.js';
import { runTrendsSync } from './sync.js';
import { aggregate, BASES, GROUPS } from './aggregate.js';
import { getAllFETeamMembers } from '../feteamService.js';
import { analyzeDefects, ruleFocus } from './defects.js';
import { generateGuidance, cachedGuidance } from './guidance.js';

export const MONTH_CHOICES = [3, 6];

/** The scope in plain words for the model: counts only, never the names of clients or people. */
export const scopeText = (f = {}) => {
  const bits = [];
  if (f.feTeam) bits.push('FE team only');
  if (f.client?.length) bits.push(`${f.client.length} client${f.client.length === 1 ? '' : 's'} selected`);
  if (f.assignee?.length) bits.push(`${f.assignee.length} assignee${f.assignee.length === 1 ? '' : 's'} selected`);
  return bits.length ? bits.join('; ') : 'all done tickets';
};

export const createTrendsService = ({ sync = runTrendsSync, now = () => new Date(), feMembers = () => new Set(getAllFETeamMembers()), claude } = {}) => {
  let running = false;
  let guiding = false;

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

  const defectFacts = ({ months = 6, filters = {} } = {}) => analyzeDefects({ rows: store.allRows(), months, filters, feMembers: filters.feTeam ? feMembers() : new Set(), now: now() });

  /** The numbers and the rule-based focus, plus the model's guidance if these same numbers were answered before. Never calls the model. */
  const defectAnalysis = ({ months = 6, filters = {} } = {}) => {
    const facts = defectFacts({ months, filters });
    const scope = scopeText(filters);
    return { facts, scope, ruleFocus: ruleFocus(facts), guidance: cachedGuidance(facts, scope) };
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

  return { refresh, status, sprintTickets, defectAnalysis, defectGuidance, isRunning: () => running, isGuiding: () => guiding };
};

export const trendsService = createTrendsService();
export { BASES, GROUPS };
