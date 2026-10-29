#!/usr/bin/env node
// Flag / unflag important tickets. Flags live in MyTracker (the star in the app, GET/PUT /api/important).
// If the backend is not reachable, flags go to a local mirror (flags.local.json) and are reported as local-only.
// Usage: node flag.mjs list
//        node flag.mjs add NGK-123 NGK-456      (bare numbers work: 123)
//        node flag.mjs remove NGK-123
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_API } from './../lib/jira.mjs';
import { DATA_DIR } from './../lib/paths.mjs';

const MIRROR = path.join(DATA_DIR, 'flags.local.json');

const readMirror = () => { try { return JSON.parse(fs.readFileSync(MIRROR, 'utf8')); } catch { return {}; } };
const writeMirror = (m) => fs.writeFileSync(MIRROR, JSON.stringify(m, null, 2));
const norm = (k) => (/^\d+$/.test(k) ? `NGK-${k}` : k.toUpperCase());

/** Flagged keys: from MyTracker if reachable (and mirrored locally), else the local mirror. */
export const getFlags = async () => {
  try {
    const r = await fetch(`${TRACKER_API}/important`, { signal: AbortSignal.timeout(2500) });
    const data = (await r.json()).data || {};
    writeMirror(data);
    return { keys: Object.keys(data).sort(), source: 'MyTracker' };
  } catch {
    return { keys: Object.keys(readMirror()).sort(), source: 'local mirror (MyTracker not reachable)' };
  }
};

const setFlag = async (key, on) => {
  const m = readMirror();
  if (on) m[key] = true; else delete m[key];
  writeMirror(m);
  try {
    const r = await fetch(`${TRACKER_API}/important/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ important: on }), signal: AbortSignal.timeout(2500),
    });
    return r.ok ? 'MyTracker' : `local only (MyTracker answered ${r.status})`;
  } catch { return 'local only (MyTracker not reachable)'; }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list' || !cmd) {
    const { keys, source } = await getFlags();
    console.log(`Flagged (${keys.length}) from ${source}: ${keys.join(', ') || '-'}`);
  } else if (cmd === 'add' || cmd === 'remove') {
    if (!rest.length) { console.error('Give at least one ticket key.'); process.exit(2); }
    for (const k of rest.map(norm)) console.log(`${cmd === 'add' ? 'Flagged' : 'Unflagged'} ${k} -> ${await setFlag(k, cmd === 'add')}`);
  } else { console.error('Usage: flag.mjs list | add KEYS | remove KEYS'); process.exit(2); }
}
