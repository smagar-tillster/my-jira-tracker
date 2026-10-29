// Sprint focus: the things the user says matter this sprint ("PC-SV fiscal flow", "CFA-UK UAT"), remembered in a JSON file.
// Where the file lives, first match wins:
//   1. NGK_FOCUS_FILE (environment), 2. the path written in backend/data/delivery/focus-path.txt (per machine, git-ignored; set with
//   `focus.mjs where --set <path>`), 3. backend/data/delivery/focus.json. Point it at a OneDrive folder to share it between machines.
// Nothing here writes to Jira.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';

const POINTER = path.join(DATA_DIR, 'focus-path.txt');
const expand = (p) => path.resolve(String(p).trim().replace(/^~(?=$|\/)/, os.homedir()));
const pointerPath = () => { try { return fs.readFileSync(POINTER, 'utf8').trim(); } catch { return ''; } };

export const focusLocation = () => {
  if (process.env.NGK_FOCUS_FILE) return { file: expand(process.env.NGK_FOCUS_FILE), source: 'NGK_FOCUS_FILE' };
  const p = pointerPath();
  if (p) return { file: expand(p), source: POINTER };
  return { file: path.join(DATA_DIR, 'focus.json'), source: 'default (local only)' };
};
export const FOCUS_FILE = focusLocation().file;
/** Folder that holds the focus file; weekly reports, defects reports and sprint reports are stored in subfolders next to it (OneDrive when shared). */
export const REPORTS_ROOT = path.dirname(FOCUS_FILE);

export const loadFocus = () => { try { return JSON.parse(fs.readFileSync(FOCUS_FILE, 'utf8')); } catch { return { items: [] }; } };
// Write to a temp file and rename, so a sync client (OneDrive) never uploads a half-written file.
export const saveFocus = (d) => {
  fs.mkdirSync(path.dirname(FOCUS_FILE), { recursive: true });
  const tmp = `${FOCUS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, FOCUS_FILE);
};

/** Point this machine at a (shared) focus file. The folder must already exist; an existing local file is copied there if the target is new. */
export const setFocusLocation = (target) => {
  const file = expand(target);
  if (!fs.existsSync(path.dirname(file))) throw new Error(`folder does not exist: ${path.dirname(file)}`);
  const current = focusLocation().file;
  if (!fs.existsSync(file) && fs.existsSync(current) && current !== file) fs.copyFileSync(current, file);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(POINTER, `${file}\n`);
  return file;
};

export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const listArg = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
export const upperKeys = (v) => listArg(v).map((k) => (/^\d+$/.test(k) ? `NGK-${k}` : k.toUpperCase()));

/** Exact id/name first, then a unique partial match. Returns { item } or { error }. */
export const findItem = (d, q) => {
  const s = slug(q);
  const exact = d.items.find((i) => i.id === s || i.name.toLowerCase() === String(q).toLowerCase());
  if (exact) return { item: exact };
  const part = d.items.filter((i) => !i.archived && (i.id.includes(s) || i.name.toLowerCase().includes(String(q).toLowerCase())));
  if (part.length === 1) return { item: part[0] };
  return { error: part.length ? `"${q}" matches ${part.map((i) => i.name).join(', ')}; be more specific` : `no focus item "${q}" (try: focus.mjs list)` };
};
