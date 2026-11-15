// Runs the RAG's own ingest (`.venv/bin/python ingest.py` in the RAG folder) once, after pattern files changed. Never throws.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const ingestPaths = (ragRoot) => ({ python: path.join(ragRoot, '.venv', 'bin', 'python'), script: path.join(ragRoot, 'ingest.py') });

/** { ok, reason }. `spawnFn` and `exists` are replaced in tests. */
export const runIngest = ({ ragRoot, timeoutMs = 600000, spawnFn = spawn, exists = fs.existsSync }) => new Promise((resolve) => {
  const { python, script } = ingestPaths(ragRoot);
  if (!exists(python) || !exists(script)) return resolve({ ok: false, reason: `ingest.py or the RAG virtual environment was not found in ${ragRoot}` });
  let out = ''; let done = false;
  const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
  let child;
  try { child = spawnFn(python, [script], { cwd: ragRoot, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, reason: String(e.message || e).slice(0, 200) }); }
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, reason: `ingest took longer than ${Math.round(timeoutMs / 60000)} minutes` }); }, timeoutMs);
  child.stdout?.on('data', (d) => { out += d; }); child.stderr?.on('data', (d) => { out += d; });
  child.on('error', (e) => finish({ ok: false, reason: String(e.message || e).slice(0, 200) }));
  child.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, reason: `ingest exited with code ${code}: ${out.trim().split('\n').slice(-1)[0] || ''}`.slice(0, 240) }));
});
