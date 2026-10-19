#!/usr/bin/env node
// Apply approved changes to Jira / MyTracker. DRY-RUN by default; pass --apply to execute.
// Usage: node apply.mjs <ops.json> [--apply]
//
// ops.json = array of:
// { "key": "NGK-123",
//   "set": { "client": "BK-DE" | ["BK-DE","BK-AT"], "due": "2026-10-20", "uat": "2026-10-15", "labels_add": ["x"] },
//   "fields": { "<raw jira field id>": <value> },        // escape hatch
//   "comment": "text (blank line = new paragraph)",
//   "important": true|false,                              // MyTracker ★ flag (not Jira)
//   "close": { "transition": "Closed", "resolution": "Won't Do" }   // transition name, optional resolution
// }
// Order per ticket: field edit -> comment -> close -> important flag. A failure on one ticket does not stop the rest.
import fs from 'node:fs';
import { jira, FIELDS, adfDoc, parseArgs, TRACKER_API } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const file = a._[0];
if (!file) { console.error('Usage: apply.mjs <ops.json> [--apply]'); process.exit(2); }
const ops = JSON.parse(fs.readFileSync(file, 'utf8'));
const APPLY = !!a.apply;
const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

const buildFields = (op) => {
  const f = { ...(op.fields || {}) };
  const s = op.set || {};
  if (s.client) f[FIELDS.client] = [].concat(s.client).map((value) => ({ value }));
  if (s.due) { if (!dateOk(s.due)) throw new Error(`bad due date ${s.due}`); f.duedate = s.due; }
  if (s.uat) { if (!dateOk(s.uat)) throw new Error(`bad uat date ${s.uat}`); f[FIELDS.uat] = s.uat; }
  return f;
};

let failed = 0;
console.log(APPLY ? 'APPLYING changes\n' : 'DRY RUN (nothing is changed; add --apply to execute)\n');
for (const op of ops) {
  const log = [];
  try {
    const fields = buildFields(op);
    const update = op.set?.labels_add ? { labels: op.set.labels_add.map((add) => ({ add })) } : undefined;
    if (Object.keys(fields).length || update) {
      log.push(`edit ${JSON.stringify({ ...fields, ...(update ? { labels_add: op.set.labels_add } : {}) })}`);
      if (APPLY) await jira('PUT', `/issue/${op.key}`, { fields, ...(update ? { update } : {}) });
    }
    if (op.comment) {
      log.push(`comment (${op.comment.length} chars): ${op.comment.slice(0, 80).replace(/\n/g, ' ')}…`);
      if (APPLY) await jira('POST', `/issue/${op.key}/comment`, { body: adfDoc(op.comment) });
    }
    if (op.close) {
      const { transitions } = await jira('GET', `/issue/${op.key}/transitions`);
      const want = (op.close.transition || 'Closed').toLowerCase();
      const hit = transitions.filter((t) => t.name.toLowerCase() === want);
      if (hit.length !== 1) throw new Error(`transition "${op.close.transition || 'Closed'}" not found; available: ${transitions.map((t) => t.name).join(', ')}`);
      log.push(`transition -> ${hit[0].name}${op.close.resolution ? ` (resolution ${op.close.resolution})` : ''}`);
      if (APPLY) {
        await jira('POST', `/issue/${op.key}/transitions`, {
          transition: { id: hit[0].id },
          ...(op.close.resolution ? { fields: { resolution: { name: op.close.resolution } } } : {}),
        });
      }
    }
    if (typeof op.important === 'boolean') {
      log.push(`important flag -> ${op.important}`);
      if (APPLY) {
        const r = await fetch(`${TRACKER_API}/important/${op.key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ important: op.important }),
        });
        if (!r.ok) throw new Error(`MyTracker important flag failed: ${r.status} (is the backend running?)`);
      }
    }
    console.log(`${op.key}\n  ${log.join('\n  ') || '(no-op)'}`);
  } catch (e) {
    failed++;
    console.log(`${op.key}\n  ${log.join('\n  ')}\n  ERROR: ${e.message}`);
  }
}
console.log(`\n${ops.length - failed}/${ops.length} ok${failed ? `, ${failed} failed` : ''}${APPLY ? '' : ' (dry run)'}`);
process.exit(failed ? 1 : 0);
