// The one place the defect analysis asks a model for judgment: turning the computed numbers into a short, ranked "where to focus" with next steps.
// Inputs are scrubbed of secret-like text and carry no people's names. The model's answer is checked (shape and lengths) and kept by a hash of the numbers
// it was written from, so the same numbers never cost a second call. If the model cannot be used the page still has the rule-based focus.
import crypto from 'node:crypto';
import { redactSecrets } from '../../../delivery/lib/reviews.mjs';
import { runClaude, parseModelJson } from '../../../delivery/lib/reviewgen.mjs';
import * as store from './store.js';

export const MODEL = 'sonnet';
export const TIMEOUT_MS = 180000;
const PROMPT_VERSION = 1;
export const MAX_FOCUS = 4;

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const safe = (s, n) => redactSecrets(clip(s, n)).text;

export const PROMPT = `You advise an engineering lead on how to reduce defects in a restaurant kiosk and ordering platform. On stdin is a JSON object of facts about the defects that were fixed ("done") in recent months: tiles (counts, share of all done tickets, median days to fix, share found in UAT), categories (count, share, change in defects per month between the earlier and recent half, median days to fix, example summaries), clients (defects per 100 done tickets, and how many times the average), repeats (phrases that recur across defect titles), a per-month series, and the scope the numbers are filtered to. Answer with ONE JSON object and nothing else (no prose, no code fence): {"headline","focus":[{"title","why","actions","measure"}],"caveats"}.

- headline: one sentence on the main thing the numbers say.
- focus: two to four items, most worthwhile first. Rank by how many defects an item could remove, how fast it is growing, and how fixable it looks, and say which of these drives the rank in why.
- title: short name of the focus area (a category, a client, or a repeat).
- why: one or two sentences using only numbers from stdin. Do not round a number into a different claim, and never state a number that is not on stdin.
- actions: two or three concrete steps a team could do in the next sprint or two (a test to add, a check to automate, a review to hold). Prefer steps that remove a whole class of defect over one-off fixes.
- measure: how the team would know it worked, as a number it can read off this same page.
- caveats: one to three short notes on what these numbers cannot show. The data is ticket titles, categories picked by keyword, and dates; it has no root causes, so cause statements must be marked as inference ("probably", "check whether").
Rules: use only what is on stdin; never invent a cause, a client, a ticket or a number. Never quote a secret, token, password, card number or personal data. Do not name any person. Keep every value short.`;

/** What is sent: the facts, trimmed, with example titles scrubbed, plus the scope as plain words. */
export const buildInput = (facts, scope = '') => JSON.stringify({
  scope: safe(scope, 200), months: facts.months, defectsPerMonth: facts.perMonth, tiles: facts.tiles, averageDefectsPer100Done: facts.averagePer100,
  categories: facts.categories.slice(0, 8).map((c) => ({ name: c.name, count: c.count, sharePct: c.share, changePctPerMonth: c.changePct, medianDaysToFix: c.medianDaysToFix, examples: c.examples.map((e) => safe(e.summary, 110)) })),
  clients: facts.clients.map((c) => ({ name: c.name, defects: c.defects, doneTickets: c.done, per100: c.per100, timesAverage: c.times })),
  repeats: facts.repeats.map((r) => ({ phrase: safe(r.phrase, 60), defects: r.count, clients: r.clients })),
  note: `Rates are only shown for clients with at least ${facts.minClientDone} done tickets. Types counted as defects: ${facts.typesCounted.join(', ')}.`,
});

/** The same numbers, the same prompt version and the same scope give the same hash. */
export const factsHash = (facts, scope = '') => crypto.createHash('sha256').update(JSON.stringify({ v: PROMPT_VERSION, scope, facts })).digest('hex');

const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => safe(x, len)).filter(Boolean).slice(0, n);

/** The checked answer, or null when it has no usable focus item. Unknown keys are dropped and every text is clipped. */
export const parseGuidance = (json) => {
  const focus = (Array.isArray(json?.focus) ? json.focus : []).map((f) => ({
    title: safe(f?.title, 80), why: safe(f?.why, 320), actions: list(f?.actions, 3, 220), measure: safe(f?.measure, 160),
  })).filter((f) => f.title && f.why && f.actions.length).slice(0, MAX_FOCUS);
  if (!focus.length) return null;
  return { headline: safe(json?.headline, 220), focus, caveats: list(json?.caveats, 3, 220) };
};

/** The saved answer for these numbers, or null. */
export const cachedGuidance = (facts, scope = '') => {
  const hit = store.getAi(factsHash(facts, scope));
  return hit ? { ...hit.value, cached: true, model: hit.model, at: hit.createdAt } : null;
};

/** Asks the model (unless these numbers were answered before) and keeps the checked answer. `claude` can be replaced in tests. */
export const generateGuidance = async ({ facts, scope = '', force = false, claude = runClaude, model = MODEL, now = () => new Date() }) => {
  if (!force) { const hit = cachedGuidance(facts, scope); if (hit) return { ok: true, ...hit }; }
  if (!facts.tiles.defects) return { ok: false, reason: 'There are no defects in these months and filters to analyze.' };
  const r = await claude({ prompt: PROMPT, input: buildInput(facts, scope), model, timeoutMs: TIMEOUT_MS });
  if (!r.ok) return { ok: false, reason: safe(r.reason || 'the model could not be reached', 200) };
  const parsed = parseGuidance(parseModelJson(r.text));
  if (!parsed) return { ok: false, reason: 'The model answered, but not in a usable form. Try again.' };
  const at = now().toISOString();
  store.putAi({ hash: factsHash(facts, scope), kind: 'defect-guidance', model, value: parsed, at });
  return { ok: true, ...parsed, cached: false, model, at };
};
