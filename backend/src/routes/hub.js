import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const router = express.Router();

// Report folders surfaced as apps in the launcher. Override any of them with an env var.
const DATABASES_DIR = path.join(os.homedir(), 'Library', 'CloudStorage', 'OneDrive-TillsterInc', 'databases');

const SOURCES = {
  'newrelic-conditions': {
    label: 'New Relic Conditions',
    dir: process.env.REPORTS_DIR_NEWRELIC || path.join(DATABASES_DIR, 'MyTracker', 'monitoring'),
  },
  mytester: {
    label: 'MyTester',
    dir: process.env.REPORTS_DIR_MYTESTER || path.join(DATABASES_DIR, 'myTester'),
  },
  defects: {
    label: 'Defects',
    dir: process.env.REPORTS_DIR_DEFECTS || path.join(DATABASES_DIR, 'defects-report'),
  },
};

const REPORT_EXTS = new Set(['.html', '.htm']);
// Everything a report page may need to load from its own folder. Anything else is refused.
const SERVABLE_EXTS = new Set([
  ...REPORT_EXTS,
  '.css', '.js', '.mjs', '.json', '.csv', '.txt', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf',
]);

const MAX_DEPTH = 3;
const MAX_FILES = 500;

const getSource = (id) => (Object.hasOwn(SOURCES, id) ? SOURCES[id] : null);

async function listReports(rootDir) {
  const files = [];

  const walk = async (dir, depth) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
      } else if (entry.isFile() && REPORT_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(full);
        files.push({
          path: path.relative(rootDir, full).split(path.sep).join('/'),
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  };

  await walk(rootDir, 0);
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * GET /api/hub/sources
 * Report sources available to the launcher, and whether the backend can read each folder.
 */
router.get('/hub/sources', async (req, res) => {
  const data = await Promise.all(
    Object.entries(SOURCES).map(async ([id, { label, dir }]) => {
      try {
        const stat = await fs.stat(dir);
        return { id, label, available: stat.isDirectory() };
      } catch {
        return { id, label, available: false };
      }
    })
  );
  res.json({ success: true, data });
});

/**
 * GET /api/hub/:source/files
 * HTML reports in the source folder, newest first.
 */
router.get('/hub/:source/files', async (req, res) => {
  const source = getSource(req.params.source);
  if (!source) return res.status(404).json({ success: false, error: 'Unknown report source' });

  try {
    await fs.access(source.dir);
  } catch {
    return res.status(503).json({
      success: false,
      error: 'The report folder is not reachable by the backend (missing, or OneDrive/macOS permissions).',
    });
  }

  try {
    res.json({ success: true, data: await listReports(source.dir) });
  } catch (error) {
    console.error('Error listing reports:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list reports' });
  }
});

/**
 * GET /api/hub/:source/file/<relative path>
 * Serves one file from inside the source folder. Reports link to sibling css/js/images,
 * so relative URLs resolve under this same prefix.
 */
router.get('/hub/:source/file/*', async (req, res) => {
  const source = getSource(req.params.source);
  if (!source) return res.status(404).send('Unknown report source');

  const relPath = req.params[0] || '';
  if (!relPath || relPath.includes('\0') || !SERVABLE_EXTS.has(path.extname(relPath).toLowerCase())) {
    return res.status(404).send('Not found');
  }

  try {
    const rootReal = await fs.realpath(source.dir);
    const fileReal = await fs.realpath(path.resolve(rootReal, relPath));
    // realpath on both sides also stops symlinks that point outside the folder
    if (!fileReal.startsWith(rootReal + path.sep)) return res.status(404).send('Not found');

    const ext = path.extname(fileReal).toLowerCase();
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
    if (REPORT_EXTS.has(ext)) {
      // Reports may run their own scripts, but without access to this app's origin or API session.
      headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-popups allow-downloads allow-modals';
    }
    res.sendFile(fileReal, { dotfiles: 'deny', headers });
  } catch {
    res.status(404).send('Not found');
  }
});

export default router;
