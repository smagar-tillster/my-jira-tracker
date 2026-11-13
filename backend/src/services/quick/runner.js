// One Quick Analysis run: read the sprint and my tickets, find what is new, analyze the new FE tickets, suggest who could take them,
// and group my open tickets. Jira, the model and the clock are passed in, so a run can be tested without any of them.
import fs from 'node:fs';
import { CONFIG_FILE } from '../../../delivery/lib/paths.mjs';
import { runClaude, parseModelJson } from '../../../delivery/lib/reviewgen.mjs';
import { redactSecrets } from '../../../delivery/lib/reviews.mjs';
import * as store from './store.js';
import {
  DEFAULT_SCHEDULE, bucketOf, isFE, isUnassigned, clientsOf, findNewKeys, teamWorkload, suggestAssignee, priorityOf, PRIORITY_RANK, fallbackGroups, dateOf,
} from './rules.js';
import { SIZE_PROMPT, buildSizeInput, parseSizeAnswer, plainAnalysis, GROUP_PROMPT, buildGroupInput, groupHash, resolveGroups } from './ai.js';

/** delivery/config.json "quickAnalysis": { startHour, endHour, intervalMinutes, weekdaysOnly, disabled, models: { size, group } }. */
export const quickConfig = () => {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).quickAnalysis || {}; } catch { /* no config: defaults */ }
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    schedule: {
      startHour: num(c.startHour, DEFAULT_SCHEDULE.startHour), endHour: num(c.endHour, DEFAULT_SCHEDULE.endHour),
      intervalMinutes: num(c.intervalMinutes, DEFAULT_SCHEDULE.intervalMinutes), weekdaysOnly: c.weekdaysOnly !== false,
    },
    disabled: c.disabled === true,
    models: { size: c.models?.size || 'haiku', group: c.models?.group || 'sonnet' },
    batch: num(c.sizeBatch, 10), timeoutMs: num(c.timeoutMs, 240000), readKeepDays: num(c.readKeepDays, 14),
  };
};

const snippet = (s, n = 280) => redactSecrets(String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)).text;

/** The parts of a Jira ticket the page needs. */
export const view = (i) => ({
  key: i.key, url: i.url, summary: i.summary, description: snippet(i.description), type: i.issueType, status: i.status, bucket: bucketOf(i),
  assignee: isUnassigned(i) ? '' : i.assignee, client: i.client || '', clients: clientsOf(i), components: i.components || [],
  created: i.created, updated: i.updated, dueDate: i.dueDate || null, releaseDate: i.releaseDate && i.releaseDate !== 'NA' ? i.releaseDate : null,
});

const failReason = (r) => String(r?.reason || 'no answer').slice(0, 160);

export const runQuickAnalysis = async ({
  fetchSprint, fetchMine, feMembers, claude = runClaude, cfg = quickConfig(), now = () => new Date(),
}) => {
  const started = now();
  const startedIso = started.toISOString();
  const t0 = Date.now();
  store.startRun(startedIso);
  try {
    const [sprint, mine] = await Promise.all([fetchSprint(), fetchMine()]);
    const notes = [];
    const sprintByKey = new Map(sprint.map((i) => [i.key, i]));

    // 1. what is new: sprint tickets not seen at an earlier run
    const known = store.knownKeys();
    const { newKeys, baseline } = findNewKeys({ currentIssues: sprint, knownKeys: known, now: started });
    store.addKnown(sprint.map((i) => i.key), startedIso);
    store.addNew(newKeys, startedIso);
    if (baseline) notes.push('First run: tickets already in the sprint are taken as known. Only tickets created in the last 2 days count as new.');

    const keepSince = started.getTime() - cfg.readKeepDays * 86400000;
    const rows = store.newRows().filter((r) => sprintByKey.has(r.key) && (!r.readAt || Date.parse(r.readAt) >= keepSince));
    const newTickets = rows.map((r) => ({ ...view(sprintByKey.get(r.key)), firstSeenAt: r.firstSeenAt, read: !!r.readAt, fe: isFE(sprintByKey.get(r.key)) }));
    const unreadKeys = new Set(rows.filter((r) => !r.readAt).map((r) => r.key));

    // 2. FE candidates: unread new FE tickets, and my own open FE tickets that someone on the FE team could take
    const candidates = [];
    for (const t of newTickets.filter((n) => !n.read && n.fe && n.bucket !== 'done')) candidates.push({ issue: sprintByKey.get(t.key), origin: 'new' });
    const have = new Set(candidates.map((c) => c.issue.key));
    for (const i of mine.filter((m) => isFE(m) && bucketOf(m) !== 'done' && !have.has(m.key))
      .sort((a, b) => PRIORITY_RANK[priorityOf(a, started)] - PRIORITY_RANK[priorityOf(b, started)] || (dateOf(a)?.getTime() ?? Infinity) - (dateOf(b)?.getTime() ?? Infinity))) {
      candidates.push({ issue: i, origin: 'mine' });
    }

    // size and a short analysis: cached per ticket until it is edited, so most runs make no model call
    const analysis = new Map();
    const missing = [];
    for (const c of candidates) {
      const hit = store.getAnalysis(c.issue.key, c.issue.updated);
      if (hit) analysis.set(c.issue.key, hit); else missing.push(c.issue);
    }
    let sizeFailed = 0; let sizeReason = '';
    for (let i = 0; i < missing.length; i += cfg.batch) {
      const batch = missing.slice(i, i + cfg.batch);
      const r = await claude({ prompt: SIZE_PROMPT, input: buildSizeInput(batch), model: cfg.models.size, timeoutMs: cfg.timeoutMs });
      const parsed = r.ok ? parseSizeAnswer(parseModelJson(r.text), batch.map((b) => b.key)) : new Map();
      if (!r.ok) sizeReason = failReason(r);
      for (const t of batch) {
        const a = parsed.get(t.key);
        if (a) { analysis.set(t.key, a); store.putAnalysis(t.key, t.updated, a, startedIso); }
        else { analysis.set(t.key, plainAnalysis(t)); sizeFailed++; }
      }
    }
    if (sizeFailed) notes.push(`Size and analysis could not be written for ${sizeFailed} ticket${sizeFailed === 1 ? '' : 's'}${sizeReason ? ` (${sizeReason})` : ''}; the start of the description is shown instead.`);

    // 3. who could take them: by load and related work, from the sprint
    const workloads = teamWorkload(sprint, feMembers);
    if (!feMembers.length) notes.push('No FE team members are set. Mark them with the FE Team filter on the Tasks page to get assignment suggestions.');
    const feCandidates = candidates.map((c) => ({
      ...view(c.issue), origin: c.origin, ...(analysis.get(c.issue.key) || plainAnalysis(c.issue)),
      suggestion: feMembers.length ? suggestAssignee(c.issue, workloads, { exclude: [c.issue.assignee] }) : null,
    }));

    // 4. my open tickets, grouped by meaning with a next step and a priority (not the unread new ones, which are in section 1)
    const open = mine.filter((m) => bucketOf(m) !== 'done' && !unreadKeys.has(m.key));
    const openByKey = new Map(open.map((m) => [m.key, m]));
    let groups = null; let source = 'ai'; let newHash; let storedGroups;
    if (open.length) {
      const hash = groupHash(open, started);
      const prev = store.getState();
      if (prev.groupHash === hash && prev.groups) groups = prev.groups;
      else {
        const r = await claude({ prompt: GROUP_PROMPT, input: buildGroupInput(open, started), model: cfg.models.group, timeoutMs: cfg.timeoutMs });
        groups = r.ok ? resolveGroups(parseModelJson(r.text), open, started) : null;
        if (groups) { newHash = hash; storedGroups = groups; }
        else notes.push(`My tickets are grouped by client and date only: the model could not be used (${failReason(r)}).`);
      }
      if (!groups) { groups = fallbackGroups(open, started); source = 'rules'; }
    } else groups = [];
    const myGroups = groups.map((g) => ({
      title: g.title, priority: g.priority, why: g.why, action: g.action,
      tickets: g.keys.filter((k) => openByKey.has(k)).map((k) => ({ ...view(openByKey.get(k)), priority: priorityOf(openByKey.get(k), started) })),
    })).filter((g) => g.tickets.length);

    const report = {
      generatedAt: startedIso, durationSec: Math.round((Date.now() - t0) / 100) / 10, baseline,
      counts: { sprint: sprint.length, newUnread: unreadKeys.size, feCandidates: feCandidates.length, myOpen: open.length },
      newTickets, feCandidates,
      feTeam: workloads.map((w) => ({ name: w.name, aligned: w.aligned, blocked: w.blocked, clients: Object.entries(w.clients).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })), tickets: w.tickets })),
      myTickets: { source, groups: myGroups }, notes,
    };
    store.finishRun({ status: 'ok', durationMs: Date.now() - t0, report, ...(newHash ? { groupHash: newHash, groups: storedGroups } : {}) });
    return { ok: true, report };
  } catch (e) {
    const error = String(e?.message || e).split('\n')[0].slice(0, 300);
    store.finishRun({ status: 'failed', error, durationMs: Date.now() - t0 });
    return { ok: false, error };
  }
};
