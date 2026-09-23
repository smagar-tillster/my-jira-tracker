import { getIssuesFromFilter, extractReleaseDate } from './jiraService.js';
import { getAllImportantFlags } from './importantService.js';

// Client custom field: customfield_16047.
// This was confirmed correct against a live ticket fetch on 2026-09-14
// (see ../../.briefing-cache/sprint-60259.json, clientFieldMeta.jiraField)
// and it is already the field jiraService.getIssuesByJQL requests and maps
// onto each issue's `client` property, so no extra Jira field wiring is
// needed here — we just consume issue.client.
export const CLIENT_FIELD_ID = 'customfield_16047';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "Ready for QA" is treated as effectively Done for risk/reporting purposes
 * per Sandi's explicit instruction (2026-09-14) — it reduces noise in the
 * daily briefing since those tickets are functionally off developers' plates.
 */
const isDoneType = (issue) =>
  issue.statusCategory === 'Done' || issue.status === 'Ready for QA';


/**
 * Parses a date-only string (YYYY-MM-DD from Jira duedate, or YYYY.MM.DD as
 * produced by jiraService.extractReleaseDate) into a day-diff from today.
 * Returns null when the string isn't a usable date.
 */
const dayDiffFromToday = (dateStr) => {
  if (!dateStr || dateStr === 'NA') return null;
  const normalized = dateStr.replace(/\./g, '-');
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((parsed.getTime() - todayMidnight.getTime()) / MS_PER_DAY);
};

/**
 * Risk rules (agreed with Sandi):
 *  - done      -> statusCategory is Done, or status is "Ready for QA"
 *  - urgent    -> due or release date is today/tomorrow (or overdue), and not done-type
 *  - attention -> due or release date within 3 days, and not done-type
 *  - none      -> otherwise
 */
export const classifyRisk = (issue) => {
  if (isDoneType(issue)) return 'done';

  const diffs = [dayDiffFromToday(issue.dueDate), dayDiffFromToday(issue.releaseDate)].filter(
    (d) => d !== null
  );
  if (diffs.length === 0) return 'none';

  const minDiff = Math.min(...diffs);
  if (minDiff <= 1) return 'urgent'; // today, tomorrow, or already overdue
  if (minDiff <= 3) return 'attention';
  return 'none';
};

/**
 * Derives { client, clientGroup } from the mapped issue's `client` string
 * (which jiraService joins from customfield_16047 option values, e.g.
 * "BK-KW" or "BK-KW, PLK-US"). We take the first value as the ticket's
 * primary client, and the brand prefix before the first "-" as the group.
 * No client value -> client: null, clientGroup: "Unclassified" so these
 * tickets sort to the end rather than being dropped or scattered.
 */
export const deriveClient = (issue) => {
  const raw = issue.client ? issue.client.split(',')[0].trim() : '';
  if (!raw) return { client: null, clientGroup: 'Unclassified' };

  const dashIndex = raw.indexOf('-');
  const clientGroup = dashIndex > 0 ? raw.slice(0, dashIndex) : raw;
  return { client: raw, clientGroup };
};

const enrichIssue = (issue, importantFlags) => {
  const { client, clientGroup } = deriveClient(issue);
  return {
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    statusCategory: issue.statusCategory,
    issueType: issue.issueType,
    assignee: issue.assignee,
    dueDate: issue.dueDate,
    releaseDate: issue.releaseDate && issue.releaseDate !== 'NA' ? issue.releaseDate : null,
    fixVersions: issue.fixVersions,
    risk: classifyRisk(issue),
    client,
    clientGroup,
    isImportant: !!importantFlags[issue.key],
    url: issue.url,
  };
};

const emptyCounts = () => ({ urgent: 0, attention: 0, done: 0, inProgress: 0, toDo: 0 });

const tallyCounts = (counts, ticket) => {
  if (ticket.risk === 'urgent') counts.urgent += 1;
  if (ticket.risk === 'attention') counts.attention += 1;
  if (ticket.risk === 'done') counts.done += 1;
  if (ticket.statusCategory === 'In Progress') counts.inProgress += 1;
  if (ticket.statusCategory === 'To Do') counts.toDo += 1;
  return counts;
};

const RISK_ORDER = { urgent: 0, attention: 1, none: 2, done: 3 };
const byRiskThenKey = (a, b) =>
  (RISK_ORDER[a.risk] ?? 99) - (RISK_ORDER[b.risk] ?? 99) || a.key.localeCompare(b.key);

/**
 * Groups "other" (non-important) tickets by clientGroup. Populated groups
 * come first (by ticket count, descending); "Unclassified" always sorts
 * last regardless of its count, per Sandi's instruction.
 */
const groupByClient = (tickets) => {
  const byGroup = new Map();
  for (const ticket of tickets) {
    if (!byGroup.has(ticket.clientGroup)) byGroup.set(ticket.clientGroup, []);
    byGroup.get(ticket.clientGroup).push(ticket);
  }

  const groups = Array.from(byGroup.entries()).map(([clientGroup, groupTickets]) => ({
    clientGroup,
    tickets: groupTickets.sort(byRiskThenKey),
    counts: groupTickets.reduce(tallyCounts, emptyCounts()),
  }));

  groups.sort((a, b) => {
    if (a.clientGroup === 'Unclassified') return 1;
    if (b.clientGroup === 'Unclassified') return -1;
    return b.tickets.length - a.tickets.length;
  });

  return groups;
};

/**
 * Per-assignee workload snapshot for the daily standup / team plan.
 */
const buildTeamPlan = (tickets) => {
  const byAssignee = new Map();
  for (const ticket of tickets) {
    const name = ticket.assignee || 'Unassigned';
    if (!byAssignee.has(name)) {
      byAssignee.set(name, { assignee: name, active: 0, blocked: 0, done: 0, needsAttention: [] });
    }
    const entry = byAssignee.get(name);

    if (ticket.risk === 'done') {
      entry.done += 1;
    } else if ((ticket.status || '').toLowerCase().includes('blocked')) {
      entry.blocked += 1;
    } else {
      entry.active += 1;
    }

    if ((ticket.status || '').toLowerCase().includes('blocked')) {
      entry.needsAttention.push(`${ticket.key}: blocked`);
    } else if (ticket.risk === 'urgent') {
      entry.needsAttention.push(
        `${ticket.key}: due/release ${ticket.dueDate || ticket.releaseDate} (urgent)`
      );
    } else if (ticket.risk === 'attention') {
      entry.needsAttention.push(
        `${ticket.key}: due/release ${ticket.dueDate || ticket.releaseDate} (approaching)`
      );
    }
  }

  return Array.from(byAssignee.values()).sort((a, b) => b.active - a.active);
};

/**
 * Data-hygiene one-liners, grouped by issue type. Deliberately ignores
 * fixVersion/release-date gaps (e.g. "TBD" placeholders are normal and
 * noisy to flag) — only calls out missing assignee / missing due date on
 * tickets that are still open work.
 */
const buildTicketHygiene = (tickets) => {
  const byType = new Map();
  for (const ticket of tickets) {
    const type = ticket.issueType || 'Unknown';
    if (!byType.has(type)) byType.set(type, { unassigned: 0, missingDueDate: 0 });
    const entry = byType.get(type);

    if (!ticket.assignee || ticket.assignee === 'Unassigned') entry.unassigned += 1;
    if (ticket.risk !== 'done' && !ticket.dueDate) entry.missingDueDate += 1;
  }

  const lines = [];
  for (const [type, { unassigned, missingDueDate }] of byType.entries()) {
    if (unassigned > 0) lines.push(`${type}: ${unassigned} ticket(s) unassigned`);
    if (missingDueDate > 0) lines.push(`${type}: ${missingDueDate} open ticket(s) missing a due date`);
  }
  return lines;
};

/**
 * Builds the full daily briefing payload: fetches the sprint filter via the
 * existing jiraService, merges in local IMP flags, classifies risk, groups
 * by client, and derives a per-assignee team plan plus hygiene notes.
 */
export const buildDailyBriefing = async (sprintFilterId) => {
  const rawIssues = await getIssuesFromFilter(sprintFilterId);
  const importantFlags = getAllImportantFlags();

  const tickets = rawIssues.map((issue) => enrichIssue(issue, importantFlags));

  const impTickets = tickets.filter((t) => t.isImportant).sort(byRiskThenKey);
  const otherTickets = tickets.filter((t) => !t.isImportant);

  return {
    generatedAt: new Date().toISOString(),
    sprintFilterId,
    totalTickets: tickets.length,
    impTickets,
    otherTicketsByClient: groupByClient(otherTickets),
    teamPlan: buildTeamPlan(tickets),
    ticketHygiene: buildTicketHygiene(tickets),
  };
};

// Re-exported purely so callers/tests can reuse jiraService's date-extraction
// logic without importing jiraService directly.
export { extractReleaseDate };
