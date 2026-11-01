// Digest routes: the rules digest from a data file, and a kept summary being reused without a model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-digest-'));
process.env.NGK_DATA_DIR = tmp;
fs.mkdirSync(path.join(tmp, '.cache', 'data'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.cache', 'data', 'delivery.json'), JSON.stringify({
  day: '2026-11-01', generatedAt: '2026-11-01T10:00:00Z', releases: [], toRelease: [], tenants: [], envs: [],
  prs: [{ id: 'kiosk-ui#1', repo: 'kiosk-ui', number: 1, url: 'u', line1: 'One', day: '2026-10-30', tenants: ['BK-US'], keys: [], defectFix: true, shippedState: 'none' }],
  openPrs: [],
}));

const { default: express } = await import('express');
const { default: router } = await import('../../src/routes/delivery.js');

const call = async (server, method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() };
};

test('GET /delivery/digest builds the digest for a range', async () => {
  const app = express(); app.use(express.json()); app.use('/api', router);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const a = await call(server, 'GET', '/api/delivery/digest?from=2026-10-26&to=2026-11-01');
    assert.equal(a.status, 200);
    assert.equal(a.json.data.merged.total, 1);
    assert.equal(a.json.data.merged.defectFixes.length, 1);
    assert.match(a.json.data.headline, /1 PR merged in 1 repo for 1 tenant; 1 defect fix/);
    const none = await call(server, 'GET', '/api/delivery/digest?from=2026-01-01&to=2026-01-07');
    assert.equal(none.json.data.headline, 'No PRs merged in this range.');
    const dflt = await call(server, 'GET', '/api/delivery/digest');            // default: the 7 days ending the data's day
    assert.deepEqual(dflt.json.data.window, { from: '2026-10-26', to: '2026-11-01' });
  } finally { server.close(); }
});

test('a kept summary is returned as is when the facts have not changed, with no model call', async () => {
  const app = express(); app.use(express.json()); app.use('/api', router);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const dg = (await call(server, 'GET', '/api/delivery/digest?from=2026-10-26&to=2026-11-01')).json.data;
    const hash = crypto.createHash('sha256').update(JSON.stringify(dg).slice(0, 30000)).digest('hex').slice(0, 16);
    fs.mkdirSync(path.join(tmp, 'pr-digest'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'pr-digest', '2026-10-26_2026-11-01.json'), JSON.stringify({ hash, text: 'Kept note.', model: 'haiku (claude CLI)', createdAt: 'x', window: dg.window }));
    const r = await call(server, 'POST', '/api/delivery/digest/summary', { from: '2026-10-26', to: '2026-11-01' });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.text, 'Kept note.');
    assert.equal(r.json.data.cached, true);
  } finally { server.close(); }
});
