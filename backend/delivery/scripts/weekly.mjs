#!/usr/bin/env node
// Weekly report, engineering manager to lead: short and actionable, grouped by tenant (ask, where we are, risks and blockers, completed
// vs pending), then overall completed vs pending tickets and a defects comment. Important = focus items + tickets starred in My Tracker.
// Every build is saved per ISO week (in the reports folder next to the focus file) so any week can be queried later.
// Usage: node weekly.mjs build [--week 2026-W43]        gather facts, save, print the rules draft (default: this week, as of today)
//        node weekly.mjs show [--week W | --last N]      print the saved report (the polished narrative if one was saved, else the draft)
//        node weekly.mjs list                            saved weeks with the red/amber/green count
//        node weekly.mjs history "<initiative>" [--weeks 6]   how one initiative looked week by week
//        node weekly.mjs narrative <week> --file <path>  save the AI-polished text for that week
//        node weekly.mjs where                           folder where weekly entries are stored
import fs from 'node:fs';
import { parseArgs, today } from '../lib/jira.mjs';
import { buildWeek, loadWeek, listWeeks, renderDraft, saveNarrative, weekOf, WEEKLY_DIR } from '../lib/weekly.mjs';
import { addDays } from '../lib/weeks.mjs';
import { getFlags } from './flag.mjs';

const a = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = a._;
const T = today();
// With no --week: this week, except on a Monday (the week has barely started and would read as empty), when it is last week.
const weekArg = a.week && a.week !== true ? String(a.week) : (new Date(`${T}T12:00:00`).getDay() === 1 ? weekOf(addDays(T, -3)).id : null);
const show = (e) => console.log(e.narrative && !e.narrative.stale ? e.narrative.text : `${e.narrative?.stale ? '_(An earlier polished version exists but the facts were rebuilt since; ask for a fresh polish.)_\n\n' : ''}${renderDraft(e)}`);

if (cmd === 'build') {
  const e = await buildWeek({ id: weekArg, getFlags, T });
  console.log(renderDraft(e));
  console.log(`\n_Saved ${e.week} to ${WEEKLY_DIR}. Flagged tickets read from ${e.flagged.source} (${e.flagged.count}). The polished wording is not written yet._`);
} else if (cmd === 'show') {
  const ids = a.last && a.last !== true ? listWeeks().slice(-Number(a.last)) : [weekArg || weekOf(T).id];
  for (const id of ids) { const e = loadWeek(id); if (!e) { console.log(`No stored report for ${id}. Run: weekly.mjs build --week ${id}`); continue; } show(e); console.log(''); }
} else if (cmd === 'list') {
  const ids = listWeeks();
  console.log(ids.length ? ids.map((id) => { const e = loadWeek(id); const ts = e.tenants || e.initiatives || []; const c = ts.reduce((m, i) => { m[i.rag]++; return m; }, { red: 0, amber: 0, green: 0 }); return `- ${id} (${e.from} to ${e.to}): ${ts.length} ${e.tenants ? 'tenants' : 'initiatives'}, ${c.red} red / ${c.amber} amber / ${c.green} green${e.overall ? `, important ${e.overall.important.completed} done vs ${e.overall.important.pending} pending` : ''}${e.narrative && !e.narrative.stale ? ', polished' : ''}`; }).join('\n') : 'No weekly entries yet. Run: weekly.mjs build');
} else if (cmd === 'history') {
  const q = rest.join(' ').toLowerCase();
  if (!q) { console.error('Usage: weekly.mjs history "<initiative>" [--weeks 6]'); process.exit(2); }
  const ids = listWeeks().slice(-Number(a.weeks || 6));
  for (const id of ids) {
    const e = loadWeek(id); const i = (e.tenants || e.initiatives || []).find((x) => x.name.toLowerCase().includes(q));
    if (!i) continue;
    console.log(`## ${id} — ${i.name}: ${i.rag}, ${i.counts.completed !== undefined ? `${i.counts.completed} done / ${i.counts.pending} pending, ` : ''}moved forward ${i.counts.movedForward}, PRs ${i.counts.prsMerged}, blocked ${i.counts.blocked}, overdue ${i.counts.overdue}, waiting ${i.counts.waiting}`);
    i.risks.slice(0, 3).forEach((r) => console.log(`   risk: ${r.key} ${r.text}`));
  }
} else if (cmd === 'narrative') {
  const id = rest[0]; const file = a.file && a.file !== true ? String(a.file) : null;
  if (!id || !file) { console.error('Usage: weekly.mjs narrative <week> --file <path>'); process.exit(2); }
  saveNarrative(id, fs.readFileSync(file, 'utf8'));
  console.log(`Saved the polished report for ${id}.`);
} else if (cmd === 'where') {
  console.log(`Weekly entries: ${WEEKLY_DIR}`);
} else {
  console.error('Commands: build | show | list | history | narrative | where  (see the header of weekly.mjs)');
  process.exit(2);
}
