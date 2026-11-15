// The one place the defect analysis asks a model for judgment: turning the computed numbers into a short, ranked "where to focus" with next steps.
// Inputs are scrubbed of secret-like text and carry no people's names. The model's answer is checked (shape and lengths) and kept by a hash of the numbers
// it was written from, so the same numbers never cost a second call. If the model cannot be used the page still has the rule-based focus.
import crypto from 'node:crypto';
import { redactSecrets } from '../../../delivery/lib/reviews.mjs';
import { runClaude, parseModelJson } from '../../../delivery/lib/reviewgen.mjs';
import * as store from './store.js';

// Sonnet: it runs only when someone clicks AI analysis (never on a refresh or when the modal opens), so the extra cost per call is a choice made per click.
export const MODEL = 'sonnet';
export const TIMEOUT_MS = 180000;
const PROMPT_VERSION = 3;
export const MAX_FOCUS = 3;

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const safe = (s, n) => redactSecrets(clip(s, n)).text;

export const PROMPT = `You advise an engineering lead on how to cut defects in a restaurant kiosk and ordering platform. On stdin is a JSON object of facts about defects fixed ("done") in recent months: tiles (counts, share of all done tickets, median days to fix), topClients, categories (count, share, change in defects per month between the earlier and recent half, median days to fix, top tenants, repeated phrases, example titles), components (the Jira component developers set when the final fix is done, so it says which part of the platform was changed, for example FE or a service: defects, share, defects per 100 done tickets, trend, median days to fix, top categories), clients (defects per 100 done tickets and how many times the average), and the scope the numbers are filtered to. Be brief and concrete: the lead will act on this next sprint. Answer with ONE JSON object and nothing else (no prose, no code fence): {"headline","focus":[{"title","why","actions","measure"}],"caveats"}.

- headline: one sentence, at most 25 words, on the main thing the numbers say.
- focus: exactly three items, most worthwhile first. Rank by how many defects it could remove, how fast it is growing, and how fixable it looks.
- title: the category, component, client or repeat it is about, in a few words. When the same category or repeat shows up mostly in one component, say which component to change.
- why: one sentence, at most 25 words, using only numbers from stdin. Never state a number that is not on stdin.
- actions: one or two steps, each at most 20 words, that a team can do in the next sprint or two (a test to add, a check to automate, a review to hold). Prefer a step that removes a whole class of defect over a one-off fix.
- measure: at most 12 words: the number on this page that would show it worked.
- caveats: at most one short note on what the data cannot show. It has titles, keyword categories and dates only, no root causes, so a cause is only ever a thing to check ("check whether").
Rules: use only what is on stdin; never invent a cause, a client, a ticket or a number. Never quote a secret, token, password, card number or personal data. Do not name any person.`;

/** What is sent: the facts, trimmed, with example titles scrubbed, plus the scope as plain words. */
export const buildInput = (facts, scope = '') => JSON.stringify({
  scope: safe(scope, 200), months: facts.months, defectsPerMonth: facts.perMonth, tiles: facts.tiles, averageDefectsPer100Done: facts.averagePer100,
  topClients: facts.topClients,
  categories: facts.categories.slice(0, 8).map((c) => ({
    name: c.name, count: c.count, sharePct: c.share, changePctPerMonth: c.changePct, medianDaysToFix: c.medianDaysToFix,
    topTenants: c.tenants, repeats: c.repeats.map((r) => ({ phrase: safe(r.phrase, 60), defects: r.count, clients: r.clients })), examples: c.examples.map((e) => safe(e.summary, 110)),
  })),
  components: facts.components.slice(0, 6).map((c) => ({ name: c.name, defects: c.count, sharePct: c.share, per100DoneTickets: c.per100, changePctPerMonth: c.changePct, medianDaysToFix: c.medianDaysToFix, topCategories: c.categories, topTenants: c.tenants })),
  clients: facts.clients.slice(0, 4).map((c) => ({ name: c.name, defects: c.defects, doneTickets: c.done, per100: c.per100, timesAverage: c.times })),
  note: `Rates are only shown for clients with at least ${facts.minClientDone} done tickets. Types counted as defects: ${facts.typesCounted.join(', ')}.`,
});

/** The same numbers, the same prompt version, the same scope and the same model give the same hash. */
export const factsHash = (facts, scope = '', model = MODEL) => crypto.createHash('sha256').update(JSON.stringify({ v: PROMPT_VERSION, scope, model, facts })).digest('hex');

const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => safe(x, len)).filter(Boolean).slice(0, n);

/** The checked answer, or null when it has no usable focus item. Unknown keys are dropped and every text is clipped. */
export const parseGuidance = (json) => {
  const focus = (Array.isArray(json?.focus) ? json.focus : []).map((f) => ({
    title: safe(f?.title, 60), why: safe(f?.why, 200), actions: list(f?.actions, 2, 140), measure: safe(f?.measure, 100),
  })).filter((f) => f.title && f.why && f.actions.length).slice(0, MAX_FOCUS);
  if (!focus.length) return null;
  return { headline: safe(json?.headline, 180), focus, caveats: list(json?.caveats, 1, 160) };
};

/** The saved answer for these numbers, or null. */
export const cachedGuidance = (facts, scope = '', model = MODEL) => {
  const hit = store.getAi(factsHash(facts, scope, model));
  return hit ? { ...hit.value, cached: true, model: hit.model, at: hit.createdAt } : null;
};

/** Asks the model (unless these numbers were answered before) and keeps the checked answer. `claude` can be replaced in tests. */
export const generateGuidance = async ({ facts, scope = '', force = false, claude = runClaude, model = MODEL, now = () => new Date() }) => {
  if (!force) { const hit = cachedGuidance(facts, scope, model); if (hit) return { ok: true, ...hit }; }
  if (!facts.tiles.defects) return { ok: false, reason: 'There are no defects in these months and filters to analyze.' };
  const r = await claude({ prompt: PROMPT, input: buildInput(facts, scope), model, timeoutMs: TIMEOUT_MS });
  if (!r.ok) return { ok: false, reason: safe(r.reason || 'the model could not be reached', 200) };
  const parsed = parseGuidance(parseModelJson(r.text));
  if (!parsed) return { ok: false, reason: 'The model answered, but not in a usable form. Try again.' };
  const at = now().toISOString();
  store.putAi({ hash: factsHash(facts, scope, model), kind: 'defect-guidance', model, value: parsed, at });
  return { ok: true, ...parsed, cached: false, model, at };
};
