import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Release & PRs data for the My Tracker tabs. The data file is written by backend/delivery/scripts/daily.mjs
// (the "Run latest report" button below); this route only filters it. Read-only for Jira and GitHub.
// Per-PR AI analysis is started on request by scripts/analyze-pr.mjs.
const router = express.Router();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DELIVERY_DIR = path.resolve(HERE, '../../delivery'); // scripts, libs and config.json (in this repo)
const DATA_DIR = process.env.NGK_DATA_DIR ? path.resolve(process.env.NGK_DATA_DIR) : path.resolve(HERE, '../../data/delivery'); // ledgers, caches, delivery.json (git-ignored)
const DATA_FILE = path.join(DATA_DIR, '.cache', 'data', 'delivery.json');
const NODE_ENV = () => ({ ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` });

const loadData = () => {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; }
};
const configuredRepos = () => {
  try { return JSON.parse(fs.readFileSync(path.join(DELIVERY_DIR, 'config.json'), 'utf8')).repos || []; } catch { return []; }
};
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const byTenant = (rows, tenants) => (tenants.length ? rows.filter((r) => r.tenants.some((t) => tenants.includes(t))) : rows);
const byEnv = (rows, envs) => (envs.length ? rows.filter((r) => r.envFlags.some((e) => envs.includes(e))) : rows);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const noData = (res) => res.status(404).json({ success: false, error: 'No delivery data yet. Click "Run latest report".' });

// GET /api/delivery/meta
router.get('/delivery/meta', (req, res) => {
  const d = loadData();
  if (!d) return noData(res);
  res.json({ success: true, data: { generatedAt: d.generatedAt, day: d.day, window: d.window, lastReleasedDay: d.lastReleasedDay, tenants: d.tenants, envs: d.envs, timing: d.timing || null,
    counts: { releases: d.releases.length, toRelease: d.toRelease.length, prsToday: d.prs.filter((p) => p.day === d.day).length, prsPendingAi: d.pendingAi || 0, openPrs: (d.openPrs || []).length } } });
});

// GET /api/delivery/released?from=YYYY-MM-DD&to=YYYY-MM-DD&tenant=A,B&env=UAT/LAB,PROD   (default: the last released day)
router.get('/delivery/released', (req, res) => {
  const d = loadData();
  if (!d) return noData(res);
  const from = req.query.from || req.query.to || d.lastReleasedDay || d.day;
  const to = req.query.to || req.query.from || d.lastReleasedDay || d.day;
  const rows = byEnv(byTenant(d.releases.filter((r) => r.date >= from && r.date <= to), list(req.query.tenant)), list(req.query.env));
  res.json({ success: true, data: { from, to, lastReleasedDay: d.lastReleasedDay, rows } });
});

// GET /api/delivery/to-release?tenant=&env=   (always today)
router.get('/delivery/to-release', (req, res) => {
  const d = loadData();
  if (!d) return noData(res);
  const rows = byEnv(byTenant(d.toRelease, list(req.query.tenant)), list(req.query.env));
  res.json({ success: true, data: { day: d.day, rows } });
});

// GET /api/delivery/prs?from=YYYY-MM-DD&to=YYYY-MM-DD   merged PRs by merge date (default: today)
router.get('/delivery/prs', (req, res) => {
  const d = loadData();
  if (!d) return noData(res);
  const from = isDay(req.query.from) ? req.query.from : (isDay(req.query.to) ? req.query.to : d.day);
  const to = isDay(req.query.to) ? req.query.to : from;
  res.json({ success: true, data: { from, to, rows: d.prs.filter((p) => p.day >= from && p.day <= to) } });
});

// GET /api/delivery/open-prs
router.get('/delivery/open-prs', (req, res) => {
  const d = loadData();
  if (!d) return noData(res);
  res.json({ success: true, data: { rows: d.openPrs || [] } });
});

// ---- Run latest report: one at a time. Not --no-save, so every run covers PRs merged since the previous run and moves that marker forward.
let job = { state: 'idle', startedAt: null, finishedAt: null, log: [] };

router.post('/delivery/refresh', (req, res) => {
  if (job.state === 'running') return res.status(409).json({ success: false, error: 'A report is already running', data: job });
  job = { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, log: [] };
  const child = spawn(process.execPath, [path.join(DELIVERY_DIR, 'scripts', 'daily.mjs')], { cwd: DELIVERY_DIR, env: NODE_ENV() });
  const keep = (buf) => { job.log.push(...String(buf).split('\n').filter(Boolean)); job.log = job.log.slice(-40); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (e) => { job.state = 'failed'; job.finishedAt = new Date().toISOString(); job.log.push(`Could not start: ${e.message}`); });
  child.on('close', (code) => { job.finishedAt = new Date().toISOString(); job.state = code === 0 ? 'done' : 'failed'; });
  res.status(202).json({ success: true, data: job });
});

router.get('/delivery/refresh/status', (req, res) => res.json({ success: true, data: job }));

// ---- AI analysis of one PR, on request (merged or open). state: running | done | queued (claude CLI unusable; request saved for a Claude session) | failed
const analyses = new Map();
const MAX_PARALLEL = 2;

router.post('/delivery/prs/:repo/:number/analyze', (req, res) => {
  const { repo } = req.params;
  const number = Number(req.params.number);
  if (!configuredRepos().includes(repo) || !Number.isInteger(number) || number <= 0) return res.status(400).json({ success: false, error: 'Unknown repo or PR number' });
  const id = `${repo}#${number}`;
  if (analyses.get(id)?.state === 'running') return res.status(409).json({ success: false, error: 'Already running', data: analyses.get(id) });
  if ([...analyses.values()].filter((j) => j.state === 'running').length >= MAX_PARALLEL) return res.status(429).json({ success: false, error: 'Two analyses are already running; try again in a minute' });
  const j = { id, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, message: '' };
  analyses.set(id, j);
  const child = spawn(process.execPath, [path.join(DELIVERY_DIR, 'scripts', 'analyze-pr.mjs'), '--repo', repo, '--pr', String(number)], { cwd: DELIVERY_DIR, env: NODE_ENV() });
  let out = '';
  const keep = (b) => { out += String(b); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (e) => { j.state = 'failed'; j.finishedAt = new Date().toISOString(); j.message = `Could not start: ${e.message}`; });
  child.on('close', (code) => {
    j.finishedAt = new Date().toISOString();
    j.state = code === 0 ? 'done' : code === 3 ? 'queued' : 'failed';
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    j.message = (code === 3 ? lines.find((l) => l.startsWith('CLI_UNAVAILABLE')) : lines[lines.length - 1]) || '';
  });
  res.status(202).json({ success: true, data: j });
});

router.get('/delivery/prs/analyze/status', (req, res) => res.json({ success: true, data: Object.fromEntries(analyses) }));

export default router;
