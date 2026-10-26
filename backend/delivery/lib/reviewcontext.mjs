// Context for a review: which recent Jira defects might relate to this PR. Rules only (no AI). The review packet lists them as
// candidates; the reviewer cites one only when it is clearly about the same flow, tenant or files, and never claims a PR caused it.

// Tenant codes look like BK-UK, JM-UK, PLK-US, AVOL-US (letters, hyphen, letters). Ticket keys (NGK-123) have digits, so they do not match.
// `known` (the tenants the release ledger has seen) filters out look-alikes such as the "SIDE-BY" in "side-by-side".
export const tenantCodes = (texts, known) => {
  const found = new Set();
  for (const t of texts) {
    for (const m of String(t || '').toUpperCase().matchAll(/\b([A-Z]{2,5}-[A-Z]{2,4})\b/g)) {
      if (!known || known.size === 0 || known.has(m[1])) found.add(m[1]);
    }
  }
  return [...found].slice(0, 3);
};

const STOP = new Set([
  'partial', 'tillster', 'config', 'configs', 'index', 'theme', 'themes', 'layout', 'variables', 'default', 'template', 'templates',
  'main', 'common', 'shared', 'utils', 'helper', 'helpers', 'service', 'services', 'component', 'components', 'directive', 'directives',
  'controller', 'controllers', 'style', 'styles', 'sass', 'scss', 'json', 'translations', 'locale', 'portrait', 'landscape', 'test', 'tests',
]);

// Distinctive words from the names of the changed source and style files: payment.partial.tillster.v1.tpl.html -> "payment".
export const areaWords = (files, max = 3) => {
  const count = new Map();
  for (const f of files) {
    const name = String(f.name || f);
    if ((f.kind || 'source') === 'translations' || /\/i18n\//.test(name)) continue;
    const base = name.split('/').pop().toLowerCase().replace(/\.(tpl\.html|html|js|ts|scss|css|json)$/, '');
    for (const w of base.split(/[^a-z]+/)) if (w.length >= 5 && !STOP.has(w)) count.set(w, (count.get(w) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, max);
};

const phrase = (s) => `summary ~ "\\"${s}\\""`;

/** JQL for defects created in the last `days` days that mention one of the terms in their summary, newest first. `component` narrows it (e.g. FE). */
export const defectJql = (terms, days = 180, component = null) => {
  const safe = terms.filter((t) => /^[A-Za-z0-9-]+$/.test(t));
  if (!safe.length) return null;
  const comp = component && /^[A-Za-z0-9 ()-]+$/.test(component) ? ` AND component = "${component}"` : '';
  return `project = NGK AND issuetype = Defect AND created >= -${days}d${comp} AND (${safe.map(phrase).join(' OR ')}) ORDER BY created DESC`;
};

export const linkedDefectJql = (key) => (/^[A-Z]+-\d+$/.test(key) ? `issue in linkedIssues("${key}") AND issuetype = Defect` : null);

const fmt = (i, why) => `- ${i.key} (${why}; ${i.fields.status?.name || '?'}; created ${String(i.fields.created || '').slice(0, 10)}): ${i.fields.summary}`;

/**
 * Builds the "Known defects" packet section. `search` is the Jira search function (injected for tests).
 * Each query fails on its own, so a Jira hiccup never blocks the packet.
 */
export const MAX_DEFECT_CANDIDATES = 3; // the reviewer cites at most 3 and only the clearly related, so a longer list is wasted reading
export const knownDefectsMarkdown = async ({ search, keys, title, ticketSummary, files, knownTenants, component = null, limit = MAX_DEFECT_CANDIDATES }) => {
  const FIELDS = ['summary', 'status', 'created'];
  const seen = new Set(); const lines = []; const notes = [];
  const add = async (jql, why, max) => {
    if (!jql) return;
    try {
      for (const i of await search(jql, FIELDS, max)) { if (!seen.has(i.key)) { seen.add(i.key); lines.push(fmt(i, why)); } }
    } catch (e) { notes.push(String(e.message || e).slice(0, 100)); }
  };
  for (const k of keys.slice(0, 3)) await add(linkedDefectJql(k), `linked to ${k}`, 5);
  const tenants = tenantCodes([title, ticketSummary], knownTenants);
  await add(defectJql(tenants), `same tenant ${tenants.join('/')}, last 180 days`, 5);
  const words = areaWords(files);
  await add(defectJql(words, 180, component), `same area "${words.join('"/"')}"${component ? `, ${component}` : ''}, last 180 days`, 4);

  lines.splice(limit); // linked defects come first, then same tenant, then same area
  const head = '## Known defects that may relate (candidates only)\nCite one only if it is clearly about the same flow, tenant or files, and never say this PR or an earlier one caused it.';
  if (!lines.length) return `${head}\nNone found${notes.length ? ` (some Jira queries failed: ${notes[0]})` : ''}.\n`;
  return `${head}\n${lines.join('\n')}${notes.length ? `\n(some Jira queries failed: ${notes[0]})` : ''}\n`;
};
