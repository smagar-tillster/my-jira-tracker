// Defect analysis for the Trends page. Pure functions over the local copy of the done tickets (no I/O, no model): the numbers and patterns are
// rules, so the same tickets always give the same answer. Written here on purpose and not shared with the old weekly defects report, so this
// feature stands on its own.
//
// A defect is a done ticket of the types in DEFECT_TYPES. Everything is over the months shown (by done date) and the page's filters, except the
// Type filter, which is ignored here (an analysis of defects cannot be limited to Stories).
import { addMonths, filterRows, monthOf, monthRange, NO_COMPONENT } from './aggregate.js';

export const DEFECT_TYPES = ['Defect', 'UAT Defect', 'Product Defect'];
const UAT_TYPE = 'UAT Defect';
export const MIN_CLIENT_DONE = 20;          // a client with fewer done tickets has too few for a rate to mean anything
export const MIN_EARLIER = 5;               // fewer defects than this in the earlier half and a % change is noise
export const MIN_REPEAT = 3;                // a phrase must be in this many defects to be a repeat

// The first match wins, so the order matters. Each carries the advice used in the guidance when the model is not used.
export const CATEGORIES = [
  { name: 'Payment and payterminal', meaning: 'Card and payment-terminal problems: declines, refunds, tips, terminal flows.', pattern: 'payment|payterminal|pay terminal|\\bcard\\b|tender|\\bebt\\b|refund|pinpad|declin|tipping|\\btip\\b', advice: 'Add failure-path tests per payment processor (decline, cancel, timeout) and a stage certification checklist before each release.' },
  { name: 'POS and fiscal integration', meaning: 'Orders or menus not reaching the POS, plus fiscal and mapping errors.', pattern: '\\bpos\\b|simphony|micros|brink|fiscal|menu request|sku ?map|order (was )?n.?t sent|not sent to', advice: 'Run contract tests against a mock POS per POS type and validate menu and skumap payloads in CI before UAT.' },
  { name: 'Receipts and printing', meaning: 'Receipts that are wrong, missing or badly formatted, on paper or on screen.', pattern: 'receipt|print|paper|\\bxsl\\b', advice: 'Add per-tenant receipt snapshot tests (fonts, locale, totals) and a receipt check in the UAT checklist.' },
  { name: 'Loyalty, coupons and offers', meaning: 'Sign-in, redeem and promotion problems in loyalty, coupons and offers.', pattern: 'loyalty|coupon|offer|reward|promo|\\bpls\\b', advice: 'Keep a sandbox scenario pack for loyalty flows (sign-in, redeem, partial redeem, void) and run it in every loyalty UAT.' },
  { name: 'Accessibility', meaning: 'Screen-reader, ADA and accessibility-mode behavior that does not work.', pattern: '\\bada\\b|screen reader|jaws|accessib|voice ?over', advice: 'Add an accessibility pass to the release checklist and lint for labels and focus order.' },
  { name: 'Hardware and device', meaning: 'Scanners, readers, the admin panel and other device behavior.', pattern: 'scanner|device|hardware|sunmi|reader|peripheral|admin panel', advice: 'Keep a hardware matrix in the lab and add device-service integration tests.' },
  { name: 'Performance and reliability', meaning: 'Slow, freezing, crashing or intermittent behavior.', pattern: 'slow|memory|performance|crash|freeze|hang|timeout|intermittent|offline|not responding', advice: 'Set timing and memory budgets with soak tests, and alert on regressions.' },
  { name: 'Navigation and flow', meaning: 'Back, cancel, edit and redirect paths that lose state or get stuck.', pattern: 'back flow|back button|flow|navigat|cancel|restart|stuck|blank screen|loop|redirect', advice: 'Add flow tests for back, edit and cancel paths (cart state) to the regression scripts.' },
  { name: 'Menu, pricing and content data', meaning: 'Wrong or missing menu items, prices, images, modifiers or translations.', pattern: 'menu|price|pricing|\\bsku\\b|combo|modifier|categor|image|product|\\bitem|translation|language|allergen|calorie|upsell', advice: 'Automate menu and content validation (missing images, translations, prices, mappings) before UAT and keep a data checklist per tenant.' },
  { name: 'UI layout and display', meaning: 'Text, buttons, layout, themes or animations that look or behave wrong.', pattern: '\\bui\\b|display|overlap|clipped|font|scroll|button|modal|screen|label|truncat|align|animation|banner|logo|theme|colou?r|capitali|text', advice: 'Add visual regression tests per tenant theme and a device-size matrix; review components before merge.' },
  { name: 'Config and deployment', meaning: 'Settings, feature flags and environment differences between tenants.', pattern: 'config|deploy|environment|setting|\\bflag\\b|enable|disable|whitelist', advice: 'Validate config against a schema, review config diffs, and promote through UAT with automated checks.' },
].map((c) => ({ ...c, re: new RegExp(c.pattern, 'i') }));
export const OTHER = { name: 'Other or unclear', meaning: 'Titles that match none of the other categories; worth a look for new patterns.', advice: 'Ask reporters for a category when logging so these can be routed, and review a sample for new patterns.' };

export const categorize = (row) => (CATEGORIES.find((c) => c.re.test(`${row.summary || ''} ${(row.labels || []).join(' ')} ${row.component || ''}`)) || OTHER).name;
const infoFor = (name) => CATEGORIES.find((c) => c.name === name) || OTHER;

const DAY = 86400000;
/** Whole days from created to resolved, or null when either is missing or the order is impossible. */
export const daysToFix = (row) => {
  const a = Date.parse(row.created); const b = Date.parse(row.resolved);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / DAY);
};
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- repeated phrases
const STOP = new Set('the and for with not when after before from into that this are was were has have had can cannot cant does doesnt dont did didnt via per its it\'s still also but all any one two new get got set use used using show shows shown showing only wrong error issue issues bug defect ticket page screen kiosk app'.split(' '));
const words = (summary, clientNames) => {
  let t = ` ${String(summary || '').toLowerCase()} `;
  for (const c of clientNames) t = t.split(c.toLowerCase()).join(' ');                      // a client code is not a pattern
  return t.replace(/\[[^\]]*\]|ngk-\d+/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w));
};

/**
 * Two-word phrases that appear in at least MIN_REPEAT defects, biggest first. A phrase whose tickets are all inside a bigger one already kept is
 * dropped, so one cluster is not listed three times.
 */
export const findRepeats = (defects, clientNames = [], limit = 6) => {
  const sets = new Map();
  for (const d of defects) {
    const w = words(d.summary, clientNames);
    const seen = new Set();
    for (let i = 0; i + 1 < w.length; i++) { const p = `${w[i]} ${w[i + 1]}`; if (!seen.has(p)) { seen.add(p); (sets.get(p) || sets.set(p, new Set()).get(p)).add(d.key); } }
  }
  const byKey = new Map(defects.map((d) => [d.key, d]));
  const ranked = [...sets.entries()].filter(([, s]) => s.size >= MIN_REPEAT).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const kept = [];
  for (const [phrase, keys] of ranked) {
    if (kept.some((k) => [...keys].every((x) => k.keys.has(x)))) continue;
    kept.push({ phrase, keys });
    if (kept.length >= limit) break;
  }
  return kept.map(({ phrase, keys }) => {
    const rows = [...keys].map((k) => byKey.get(k));
    return { phrase, count: keys.size, clients: new Set(rows.flatMap((r) => (r.clients?.length ? r.clients : []))).size, keys: [...keys].slice(0, 3), all: [...keys] };
  });
};

// ---------------------------------------------------------------- the analysis
/**
 * Facts about the defects done in the months shown. `rows` is the whole local copy. Returns plain data (no dates as objects), so it can be sent
 * as JSON, hashed for the model cache, and rendered.
 */
/** The done tickets in the months shown (after the page's filters, except Type) and the defects among them. */
export const defectsInView = ({ rows, months = 6, filters = {}, feMembers = new Set(), now = new Date() }) => {
  const current = monthOf(now.toISOString());
  const list = monthRange(addMonths(current, -(Number(months) - 1)), current);
  const index = new Map(list.map((m, i) => [m, i]));
  const { type: ignored, ...usable } = filters || {};
  const kept = filterRows(rows, usable, feMembers).filter((r) => index.has(monthOf(r.resolved)));
  return { list, index, kept, defects: kept.filter((r) => DEFECT_TYPES.includes(r.type)), ignored };
};

export const analyzeDefects = ({ rows, months = 6, filters = {}, feMembers = new Set(), now = new Date() }) => {
  const { list, index, kept, defects, ignored } = defectsInView({ rows, months, filters, feMembers, now });
  const monthOfRow = (r) => index.get(monthOf(r.resolved));

  const recentFrom = Math.floor(list.length / 2);             // the earlier half is the first floor(n/2) months, the recent half the rest
  const earlierMonths = recentFrom; const recentMonths = list.length - recentFrom;
  const isRecent = (r) => monthOfRow(r) >= recentFrom;
  const perMonthChange = (recent, earlier) => (earlier >= MIN_EARLIER && earlierMonths && recentMonths
    ? Math.round(((recent / recentMonths) / (earlier / earlierMonths) - 1) * 100) : null);

  const fixDays = (rs) => rs.map(daysToFix).filter((d) => d !== null);
  const total = defects.length;
  const tiles = {
    defects: total, ticketsDone: kept.length, shareOfDone: pct(total, kept.length),
    medianDaysToFix: median(fixDays(defects)),
    medianDaysRecent: median(fixDays(defects.filter(isRecent))), medianDaysEarlier: median(fixDays(defects.filter((r) => !isRecent(r)))),
    uat: defects.filter((r) => r.type === UAT_TYPE).length, uatShare: pct(defects.filter((r) => r.type === UAT_TYPE).length, total),
    fixedInWeekShare: pct(fixDays(defects).filter((d) => d <= 7).length, fixDays(defects).length),
  };

  const byCat = new Map(); const catOf = new Map();
  for (const d of defects) { const c = categorize(d); catOf.set(d.key, c); (byCat.get(c) || byCat.set(c, []).get(c)).push(d); }

  const allClientNames = [...new Set(rows.flatMap((r) => r.clients || []))];
  const repeatsAll = findRepeats(defects, allClientNames);
  // a repeat belongs to the category most of its defects are in, so the advice for that category can name it
  const repeatsByCat = new Map();
  for (const r of repeatsAll) {
    const votes = new Map(); for (const k of r.all) votes.set(catOf.get(k), (votes.get(catOf.get(k)) || 0) + 1);
    const [home] = [...votes.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
    (repeatsByCat.get(home) || repeatsByCat.set(home, []).get(home)).push({ phrase: r.phrase, count: r.count, clients: r.clients });
  }
  const repeats = repeatsAll.map(({ all, ...r }) => r);

  const count = (rs, f) => { const m = new Map(); for (const r of rs) for (const k of f(r)) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  const clientsOf = (r) => (r.clients?.length ? r.clients : []);
  const categories = [...byCat.entries()].map(([name, rs]) => {
    const recent = rs.filter(isRecent).length; const earlier = rs.length - recent;
    const examples = [...rs].sort((a, b) => String(b.resolved).localeCompare(String(a.resolved)) || b.key.localeCompare(a.key)).slice(0, 3).map((r) => ({ key: r.key, summary: r.summary }));
    const info = infoFor(name);
    return {
      name, meaning: info.meaning, count: rs.length, share: pct(rs.length, total), changePct: perMonthChange(recent, earlier), medianDaysToFix: median(fixDays(rs)),
      tenants: count(rs, clientsOf).slice(0, 3).map(([n, c]) => ({ name: n, count: c })),
      examples, advice: info.advice, repeats: (repeatsByCat.get(name) || []).slice(0, 2),
    };
  }).sort((a, b) => (a.name === OTHER.name) - (b.name === OTHER.name) || b.count - a.count || a.name.localeCompare(b.name));   // "Other or unclear" always last

  // by fix component: the Jira component developers set when the final fix is done, so it says which part of the platform was changed.
  // A ticket with several components counts under each, so the shares can add up to more than 100%.
  const compsOf = (r) => (r.components?.length ? r.components : [NO_COMPONENT]);
  const doneByComp = new Map();
  for (const r of kept) for (const c of compsOf(r)) doneByComp.set(c, (doneByComp.get(c) || 0) + 1);
  const byComp = new Map();
  for (const d of defects) for (const c of compsOf(d)) (byComp.get(c) || byComp.set(c, []).get(c)).push(d);
  const components = [...byComp.entries()].map(([name, rs]) => {
    const recent = rs.filter(isRecent).length; const earlier = rs.length - recent; const done = doneByComp.get(name) || rs.length;
    return {
      name, count: rs.length, share: pct(rs.length, total), changePct: perMonthChange(recent, earlier), medianDaysToFix: median(fixDays(rs)),
      done, per100: round1((rs.length / done) * 100),
      categories: count(rs, (r) => [catOf.get(r.key)]).slice(0, 3).map(([n, c]) => ({ name: n, count: c })),
      tenants: count(rs, clientsOf).slice(0, 3).map(([n, c]) => ({ name: n, count: c })),
      examples: [...rs].sort((a, b) => String(b.resolved).localeCompare(String(a.resolved)) || b.key.localeCompare(a.key)).slice(0, 3).map((r) => ({ key: r.key, summary: r.summary })),
    };
  }).sort((a, b) => (a.name === NO_COMPONENT) - (b.name === NO_COMPONENT) || b.count - a.count || a.name.localeCompare(b.name));   // "No component" always last

  // client rates: a ticket with several clients counts under each; the rate is defects per 100 done tickets
  const perClient = new Map();
  for (const r of kept) for (const c of (r.clients?.length ? r.clients : [])) {
    const e = perClient.get(c) || perClient.set(c, { done: 0, defects: 0 }).get(c);
    e.done++; if (DEFECT_TYPES.includes(r.type)) e.defects++;
  }
  const average = kept.length ? round1((total / kept.length) * 100) : 0;
  const clients = [...perClient.entries()].filter(([, e]) => e.done >= MIN_CLIENT_DONE && e.defects > 0)
    .map(([name, e]) => ({ name, defects: e.defects, done: e.done, per100: round1((e.defects / e.done) * 100), times: average ? round1(((e.defects / e.done) * 100) / average) : null }))
    .sort((a, b) => b.per100 - a.per100 || a.name.localeCompare(b.name)).slice(0, 6);

  const perMonth = list.map((_, i) => defects.filter((r) => monthOfRow(r) === i).length);

  const topClients = count(defects, clientsOf).slice(0, 3).map(([name, n]) => ({ name, count: n }));

  return { months: list, perMonth, tiles, topClients, categories, components, clients, averagePer100: average, repeats, minClientDone: MIN_CLIENT_DONE, typesCounted: DEFECT_TYPES, typeFilterIgnored: !!(ignored && ignored.length) };
};
