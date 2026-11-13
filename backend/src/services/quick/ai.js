// The two places Quick Analysis asks a model for judgment, and how its answers are checked. Everything else is rules (see rules.js).
//   1. size and a short analysis of each new FE ticket (cached per ticket until it is edited)
//   2. grouping my open tickets by meaning, with the next action and a priority (cached until the tickets change)
// Inputs are scrubbed of secret-like text and card numbers first. A model answer can add information but never lowers a priority that
// the due and release dates already make high or medium.
import crypto from 'node:crypto';
import { redactSecrets } from '../../../delivery/lib/reviews.mjs';
import { bucketOf, priorityOf, isStale, PRIORITY_RANK } from './rules.js';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const safe = (s, n) => redactSecrets(clip(s, n)).text;
const ymd = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
const iso = (v) => String(v || '').slice(0, 10);

// ---------------------------------------------------------------- 1. size and analysis of new FE tickets
export const SIZES = ['S', 'M', 'L', 'XL'];

export const SIZE_PROMPT = `You help a front-end (FE) team lead triage new Jira tickets for a kiosk ordering app. On stdin is a JSON list of tickets (key, type, summary, description, client, components, status). For EACH ticket write a quick analysis and a size. Answer with ONE JSON object and nothing else (no prose, no code fence): {"tickets":[{"key","size","sizeWhy","analysis","areas"}]}.

- size: "S" (about a day or less), "M" (two to three days), "L" (about a week), "XL" (more than a week, or it should be split first). Judge from what the ticket says; if the description is thin, say so in sizeWhy and lean to the smaller of two plausible sizes.
- sizeWhy: one short sentence naming what drives the size.
- analysis: two sentences at most: what is being asked, and where the work probably is (screens, configuration, tenant overrides). Mark inference as such ("probably", "the ticket does not say").
- areas: one to three short lowercase tags for the area touched (for example "menu", "cart", "promotion-config", "receipt", "translations").
Rules: use only what is on stdin; never invent a cause, a tenant or a file. Never quote a secret, token, password, card number or personal data. No names of people. Keep every value short.`;

export const buildSizeInput = (tickets) => JSON.stringify(tickets.map((t) => ({
  key: t.key, type: t.issueType, summary: safe(t.summary, 200), description: safe(t.description, 700),
  client: t.client || '', components: t.components || [], status: t.status,
})));

/** Map of key -> { size, sizeWhy, analysis, areas } for the keys that were asked about and answered sensibly. Anything else is left out. */
export const parseSizeAnswer = (json, keys) => {
  const want = new Set(keys);
  const out = new Map();
  for (const r of Array.isArray(json?.tickets) ? json.tickets : []) {
    const key = String(r?.key || '').toUpperCase();
    if (!want.has(key) || out.has(key)) continue;
    const size = String(r.size || '').toUpperCase();
    out.set(key, {
      size: SIZES.includes(size) ? size : null,
      sizeWhy: safe(r.sizeWhy, 200),
      analysis: safe(r.analysis, 400),
      areas: (Array.isArray(r.areas) ? r.areas : []).map((a) => String(a).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).slice(0, 3),
    });
  }
  return out;
};

/** What to show when the model could not be used: no size guess, just the opening of the description. */
export const plainAnalysis = (t) => ({ size: null, sizeWhy: '', analysis: safe(t.description, 220) || 'No description on the ticket.', areas: [] });

// ---------------------------------------------------------------- 2. grouping my open tickets
export const GROUP_PROMPT = `You help an engineer plan their open Jira tickets. On stdin is a JSON object: today's date and a list of the engineer's tickets that are not done (key, summary, status, bucket, client, components, due, release, parent). Group the tickets that belong together by meaning (the same feature, the same client and area, a ticket and its follow-ups) and say what to do next. Answer with ONE JSON object and nothing else (no prose, no code fence): {"groups":[{"title","priority","why","action","keys"}]}.

- Every ticket key appears in exactly one group. A ticket that fits nowhere goes in a group titled "Everything else". At most 10 groups.
- title: a short name for what the group is about (not just a client code).
- priority: "high", "medium" or "low". A ticket whose due or release date is tomorrow or earlier (and no more than 14 days overdue) makes its group high. A ticket more than 14 days overdue is stale: it needs a decision, so suggest re-dating or closing it, and it makes its group medium at most. Dates within 3 days or a blocked status make a group at least medium. Otherwise judge by how much waiting costs. Do not mark most groups high: high means do it first.
- why: one sentence on what ties the tickets together and why this priority.
- action: the single next step, concrete and short (for example "Ask the client to confirm the copy on NGK-1, then finish NGK-2").
- keys: the ticket keys, most urgent first.
Rules: use only what is on stdin; never invent a deadline, a person or a cause. Statuses named Blocked or Waiting need someone else: say who or what to chase only if the ticket says it. No names of people.`;

export const groupInput = (tickets, today) => ({
  today: ymd(today),
  tickets: tickets.map((t) => ({
    key: t.key, summary: safe(t.summary, 110), status: t.status, bucket: bucketOf(t), client: t.client || '', components: t.components || [],
    due: iso(t.dueDate), release: t.releaseDate && t.releaseDate !== 'NA' ? t.releaseDate : '', stale: isStale(t, today), parent: safe(t.parentSummary, 80),
  })),
});
export const buildGroupInput = (tickets, today) => JSON.stringify(groupInput(tickets, today));
export const groupHash = (tickets, today) => crypto.createHash('sha256').update(buildGroupInput(tickets, today)).digest('hex').slice(0, 16);

/**
 * Checks the model's groups against the real tickets and returns groups of { title, priority, why, action, keys } or null if unusable.
 * Unknown keys are dropped, a key listed twice stays in its first group, keys the model forgot go into "Everything else", and a group's
 * priority is never lower than what the dates and statuses of its tickets say.
 */
export const resolveGroups = (json, tickets, today = new Date()) => {
  if (!Array.isArray(json?.groups) || !json.groups.length) return null;
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const used = new Set();
  const groups = [];
  for (const g of json.groups.slice(0, 12)) {
    const keys = (Array.isArray(g?.keys) ? g.keys : []).map((k) => String(k).toUpperCase()).filter((k) => byKey.has(k) && !used.has(k));
    keys.forEach((k) => used.add(k));
    if (!keys.length) continue;
    groups.push({ title: safe(g.title, 80) || 'Group', priority: String(g.priority || '').toLowerCase(), why: safe(g.why, 240), action: safe(g.action, 240), keys });
  }
  if (!groups.length) return null;
  const left = tickets.filter((t) => !used.has(t.key)).map((t) => t.key);
  if (left.length) {
    const other = groups.find((g) => g.title.toLowerCase() === 'everything else');
    if (other) other.keys.push(...left); else groups.push({ title: 'Everything else', priority: 'low', why: 'Not placed in a group.', action: '', keys: left });
  }
  for (const g of groups) {
    const floor = g.keys.map((k) => priorityOf(byKey.get(k), today)).reduce((best, p) => (PRIORITY_RANK[p] < PRIORITY_RANK[best] ? p : best), 'low');
    if (!(g.priority in PRIORITY_RANK) || PRIORITY_RANK[floor] < PRIORITY_RANK[g.priority]) g.priority = floor;
  }
  return groups.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.keys.length - a.keys.length);
};
