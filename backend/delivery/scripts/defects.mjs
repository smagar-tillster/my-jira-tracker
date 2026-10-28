#!/usr/bin/env node
// Weekly defects data report: trend, type of issues, tenants, age and recommendations. Rules only; the wording can be polished by AI.
// Saved per ISO week (reports folder next to the focus file), so any week can be queried later. Defect = Jira type "Defect" in NGK, all components.
// Usage: node defects.mjs build [--week 2026-W44] [--weeks 12]   read Jira, save the entry, print the rules draft
//        node defects.mjs show [--week W | --last N]               print the saved report (polished text if saved, else the draft)
//        node defects.mjs list                                      saved weeks with new / resolved / open
//        node defects.mjs categories [--uncategorized] [--limit 25]  how defects map to categories (to tune config.json "defects.categories")
//        node defects.mjs narrative <week> --file <path>           save the AI-polished text
import fs from 'node:fs';
import { parseArgs, today, jiraUrl } from '../lib/jira.mjs';
import { buildDefects, loadDefectsWeek, listDefectWeeks, renderDraft, saveDefectsNarrative, fetchDefects, DEFECTS_DIR } from '../lib/defects.mjs';
import { weekOf } from '../lib/weeks.mjs';

const a = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = a._;
const T = today();
const weekArg = a.week && a.week !== true ? String(a.week) : null;
const show = (e) => console.log(e.narrative && !e.narrative.stale ? e.narrative.text : `${e.narrative?.stale ? '_(An earlier polished version exists but the facts were rebuilt since; ask for a fresh polish.)_\n\n' : ''}${renderDraft(e)}`);

if (cmd === 'build') {
  const { entry } = await buildDefects({ id: weekArg, T, weeks: Number(a.weeks || 12) });
  console.log(renderDraft(entry));
  console.log(`\n_Saved ${entry.week} to ${DEFECTS_DIR} (${entry.totalDefectsRead} defects read). The polished wording is not written yet._`);
} else if (cmd === 'show') {
  const ids = a.last && a.last !== true ? listDefectWeeks().slice(-Number(a.last)) : [weekArg || weekOf(T).id];
  for (const id of ids) { const e = loadDefectsWeek(id); if (!e) { console.log(`No stored defects report for ${id}. Run: defects.mjs build --week ${id}`); continue; } show(e); console.log(''); }
} else if (cmd === 'list') {
  const ids = listDefectWeeks();
  console.log(ids.length ? ids.map((id) => { const e = loadDefectsWeek(id); return `- ${id}: ${e.summary.createdThisWeek} new, ${e.summary.resolvedThisWeek} resolved, ${e.summary.openNow} open${e.narrative && !e.narrative.stale ? ', polished' : ''}`; }).join('\n') : 'No defects reports yet. Run: defects.mjs build');
} else if (cmd === 'categories') {
  const defects = await fetchDefects({ T });
  const rows = a.uncategorized ? defects.filter((d) => d.category.startsWith('Other')) : defects;
  const by = rows.reduce((m, d) => { (m[d.category] = m[d.category] || []).push(d); return m; }, {});
  for (const [name, list] of Object.entries(by).sort((x, y) => y[1].length - x[1].length)) {
    console.log(`\n## ${name} (${list.length})`);
    list.slice(0, Number(a.limit || 5)).forEach((d) => console.log(`- [${d.key}](${jiraUrl(d.key)}) ${d.summary.slice(0, 90)}`));
  }
} else if (cmd === 'narrative') {
  const id = rest[0]; const file = a.file && a.file !== true ? String(a.file) : null;
  if (!id || !file) { console.error('Usage: defects.mjs narrative <week> --file <path>'); process.exit(2); }
  saveDefectsNarrative(id, fs.readFileSync(file, 'utf8'));
  console.log(`Saved the polished defects report for ${id}.`);
} else {
  console.error('Commands: build | show | list | categories | narrative  (see the header of defects.mjs)');
  process.exit(2);
}
