#!/usr/bin/env node
// Sprint focus: remember what matters this sprint, line up the related tickets and show what happened last, so the user can act.
// Read-only for Jira. Items are stored in a JSON file (default backend/data/delivery/focus.json; `where --set` points it at OneDrive). Rules only, no AI.
// Usage: node focus.mjs add "PC-SV fiscal flow" [--keys NGK-102884,NGK-102887] [--tenant PC-SV] [--text fiscal,NIT] [--why "go-live blocker"]
//        node focus.mjs list
//        node focus.mjs show <name|all> [--stale-days 5] [--limit 40]       the line-up + what happened last + what to act on
//        node focus.mjs add-keys <name> NGK-1 NGK-2      node focus.mjs set <name> [--tenant ..] [--text ..] [--why ..]
//        node focus.mjs note <name> "text"      node focus.mjs drop <name>      node focus.mjs restore <name>
//        node focus.mjs where                    shows which file is used;  where --set "<OneDrive folder>/ngk-focus.json"  shares it between machines
import { parseArgs, today, md, jiraUrl } from '../lib/jira.mjs';
import { collect, first, trunc } from '../lib/focusdata.mjs';
import { loadFocus, saveFocus, findItem, slug, listArg, upperKeys, FOCUS_FILE, focusLocation, setFocusLocation } from '../lib/focus.mjs';

const a = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = a._;
const T = today();
const staleDays = Number(a['stale-days'] || 5);
const limit = Number(a.limit || 40);
const daysAgo = (day) => (day ? Math.floor((Date.parse(`${T}T12:00:00`) - Date.parse(`${String(day).slice(0, 10)}T12:00:00`)) / 86400000) : null);
const ago = (day) => { const n = daysAgo(day); return n === null ? '-' : n === 0 ? 'today' : n === 1 ? '1d ago' : `${n}d ago`; };

const data = loadFocus();
const need = (q) => { const r = findItem(data, q); if (r.error) { console.error(r.error); process.exit(1); } return r.item; };

const describe = (i) => `${i.name}${i.archived ? ' (dropped)' : ''}: ${[i.seeds.length ? `${i.seeds.length} ticket(s) ${i.seeds.join(', ')}` : '', i.tenants.length ? `tenant ${i.tenants.join(', ')}` : '', i.keywords.length ? `text ${i.keywords.join(', ')}` : ''].filter(Boolean).join(' · ') || 'no criteria yet'}${i.why ? ` — ${i.why}` : ''}`;

if (cmd === 'add') {
  const name = rest.join(' ').trim();
  if (!name) { console.error('Usage: focus.mjs add "Name" [--keys ..] [--tenant ..] [--text ..] [--why ".."]'); process.exit(2); }
  let item = data.items.find((i) => i.id === slug(name));
  if (!item) { item = { id: slug(name), name, why: '', seeds: [], tenants: [], keywords: [], notes: [], created: T, archived: false }; data.items.push(item); }
  item.archived = false;
  item.seeds = [...new Set([...item.seeds, ...upperKeys(a.keys)])];
  item.tenants = [...new Set([...item.tenants, ...listArg(a.tenant).map((t) => t.toUpperCase())])];
  item.keywords = [...new Set([...item.keywords, ...listArg(a.text)])];
  if (a.why && a.why !== true) item.why = String(a.why);
  saveFocus(data);
  console.log(`Remembered: ${describe(item)}\n(saved in ${FOCUS_FILE})`);
} else if (cmd === 'where') {
  if (a.set && a.set !== true) {
    try { console.log(`This machine now uses: ${setFocusLocation(String(a.set))}\nOther machines: run the same command with their own path to the same OneDrive file.`); }
    catch (e) { console.error(`Not changed: ${e.message}`); process.exit(1); }
  } else { const l = focusLocation(); console.log(`Focus file: ${l.file}\nChosen by: ${l.source}\n${l.source.startsWith('default') ? 'Local only. To share it between machines: focus.mjs where --set "<OneDrive folder>/ngk-focus.json"' : ''}`.trim()); }
} else if (cmd === 'list') {
  const items = data.items.filter((i) => a.all || !i.archived);
  console.log(items.length ? items.map((i) => `- ${describe(i)} [since ${i.created}]`).join('\n') : 'No focus items yet. Example: focus.mjs add "PC-SV fiscal flow" --tenant PC-SV --text fiscal');
} else if (cmd === 'add-keys') {
  const item = need(rest[0]);
  item.seeds = [...new Set([...item.seeds, ...upperKeys(rest.slice(1).join(','))])];
  saveFocus(data); console.log(`Updated: ${describe(item)}`);
} else if (cmd === 'set') {
  const item = need(rest.join(' '));
  if (a.tenant) item.tenants = listArg(a.tenant).map((t) => t.toUpperCase());
  if (a.text) item.keywords = listArg(a.text);
  if (a.why && a.why !== true) item.why = String(a.why);
  saveFocus(data); console.log(`Updated: ${describe(item)}`);
} else if (cmd === 'note') {
  const item = need(rest[0]);
  item.notes.push({ at: T, text: rest.slice(1).join(' ') });
  saveFocus(data); console.log(`Noted on ${item.name}.`);
} else if (cmd === 'drop' || cmd === 'restore') {
  const item = need(rest.join(' '));
  item.archived = cmd === 'drop';
  saveFocus(data); console.log(`${cmd === 'drop' ? 'Dropped' : 'Restored'}: ${item.name}`);
} else if (cmd === 'show') {
  const q = rest.join(' ') || 'all';
  const items = q.toLowerCase() === 'all' ? data.items.filter((i) => !i.archived) : [need(q)];
  if (!items.length) { console.log('No focus items yet. Use: focus.mjs add "Name" --keys .. --tenant .. --text ..'); process.exit(0); }
  for (const item of items) printItem(await collect(item, { limit, staleDays, T }));
  console.log('\n_Facts come from Jira, the PR ledger and the release ledger (last report run). Flags are rules, not judgment._');
} else {
  console.error('Commands: add | list | show | add-keys | set | note | drop | restore | where  (see the header of focus.mjs)');
  process.exit(2);
}

function printItem({ item, matchNote, rows, events }) {
  const real = rows.filter((r) => r.t);
  console.log(`\n# Focus: ${item.name}${item.why ? ` — ${item.why}` : ''}\n`);
  console.log(`${real.length} ticket(s) lined up (${item.seeds.length} named${matchNote ? `; ${matchNote}` : ''}; plus linked/parent/subtasks). Today ${T}.`);
  if (item.notes.length) console.log(`Notes: ${item.notes.slice(-3).map((n) => `${n.at}: ${n.text}`).join(' | ')}`);
  const flagged = real.filter((r) => r.flags.length).length;
  console.log(`${flagged} need attention: ${['blocked', 'waiting', 'overdue', 'quiet', 'due', 'PR'].map((w) => `${real.filter((r) => r.flags.some((f) => f.startsWith(w))).length} ${w}`).filter((s) => !s.startsWith('0 ')).join(', ') || 'none'}.\n`);

  console.log('## What happened last (newest first)\n');
  console.log(md([...events].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 10).map((e) => [e.at, `[${e.key}](${jiraUrl(e.key)})`, `${e.text} (${e.by})`]), ['When', 'Ticket', 'What']) || '_No recent activity._');

  console.log('\n## Tickets (most urgent first)\n');
  console.log(md(rows.map((r) => r.err ? [`[${r.key}](${jiraUrl(r.key)})`, '(could not read)', r.err, '', '', '', ''] : [`[${r.key}](${jiraUrl(r.key)})`, trunc(r.t.summary, 60), r.t.status, first(r.t.assignee || ''), r.t.due || '-', r.last ? `${ago(r.last.at)}: ${trunc(r.last.text, 70)}` : ago(r.lastAct), r.flags.join('; ') || '-']),
    ['Ticket', 'Summary', 'Status', 'Owner', 'Due', 'Last activity', 'Flags']));

  const withPrs = real.filter((r) => r.prs.length);
  if (withPrs.length) { console.log('\n## PRs on these tickets\n'); console.log(md(withPrs.flatMap((r) => r.prs.map((p) => [`[${r.key}](${jiraUrl(r.key)})`, `[${p.id}](${p.url})`, p.state + (p.draft ? ' (draft)' : ''), p.at, p.review || '-'])), ['Ticket', 'PR', 'State', 'Date', 'Review'])); }
  const withRels = real.filter((r) => r.rels.length);
  if (withRels.length) { console.log('\n## Releases carrying them\n'); console.log(md(withRels.flatMap((r) => r.rels.map((x) => [`[${r.key}](${jiraUrl(r.key)})`, `[${x.key}](${jiraUrl(x.key)})`, x.tenant, x.date, x.env || '-', x.status])), ['Ticket', 'Release', 'Tenant', 'Date', 'Env', 'Status'])); }

  console.log('\n## Act on\n');
  const acts = [];
  for (const r of real.filter((x) => x.flags.length)) {
    for (const f of r.flags) {
      const who = first(r.t.assignee || '') || 'the owner';
      const todo = f.startsWith('blocked') ? `unblock: ${f}` : f.startsWith('waiting') ? `nudge the client (${f})` : f.startsWith('overdue') ? `re-date or escalate (${f})` : f.startsWith('quiet') ? `ask ${who} for an update (${f})` : f.startsWith('due') ? `confirm ${who} will make it (${f})` : `get the PR moving: ${f}`;
      acts.push(`- [${r.key}](${jiraUrl(r.key)}) ${trunc(r.t.summary, 50)}: ${todo}`);
    }
  }
  console.log(acts.length ? acts.join('\n') : 'Nothing flagged: no blockers, waits, overdue dates, quiet tickets or stuck PRs.');
}
