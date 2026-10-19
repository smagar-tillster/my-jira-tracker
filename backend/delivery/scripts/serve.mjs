#!/usr/bin/env node
// Serve the generated report on http://127.0.0.1:8791/ so it opens with scripts enabled (expand/collapse, filters).
// Preview panes show file:// pages as static snapshots, where scripts do not run; a localhost URL runs them.
// Local only (127.0.0.1), read-only, serves just the .cache folder.  Usage: node serve.mjs [--port 8791]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, parseArgs } from '../lib/jira.mjs';

const port = Number(parseArgs(process.argv.slice(2)).port || 8791);
const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'daily.html';
  const file = path.join(CACHE_DIR, path.basename(name)); // basename: no path traversal, only files directly in .cache
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found. Run daily.mjs first.'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Report at http://127.0.0.1:${port}/daily.html  (Ctrl-C to stop)`));
