// Jira issue type icons: which URLs the icon route will fetch, and what it returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { iconUrlFor, createJiraIconRouter } = await import('../../src/routes/jiraIcon.js');
const HOST = 'https://example.atlassian.net';

test('only issue type icon paths on the configured Jira host are accepted', () => {
  assert.equal(iconUrlFor(`${HOST}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10315?size=medium`, HOST), `${HOST}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10315?size=medium`);
  assert.equal(iconUrlFor(`${HOST}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10315`, HOST), `${HOST}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10315`);
  assert.equal(iconUrlFor(`${HOST}/images/icons/issuetypes/story.svg`, HOST), `${HOST}/images/icons/issuetypes/story.svg`);
  // other hosts, other paths, other schemes, junk: refused
  for (const bad of ['https://evil.example/rest/api/2/universal_avatar/view/type/issuetype/avatar/1', `${HOST}.evil.example/images/icons/issuetypes/a.svg`,
    `${HOST}/rest/api/3/issue/NGK-1`, `${HOST}/rest/api/2/universal_avatar/view/type/issuetype/avatar/abc`, `${HOST}/images/icons/issuetypes/../../secret`,
    `${HOST}/rest/api/2/myself`, 'javascript:alert(1)', 'not a url', '', undefined, null]) assert.equal(iconUrlFor(bad, HOST), null, String(bad));
  assert.equal(iconUrlFor(`${HOST}/images/icons/issuetypes/story.svg`, ''), null);       // no host configured
});

test('anything but a size in the query string is dropped before the request goes to Jira', () => {
  assert.equal(iconUrlFor(`${HOST}/images/icons/issuetypes/story.svg?token=SECRET&size=large&x=1`, HOST), `${HOST}/images/icons/issuetypes/story.svg?size=large`);
  assert.equal(iconUrlFor(`${HOST}/images/icons/issuetypes/story.svg?token=SECRET`, HOST), `${HOST}/images/icons/issuetypes/story.svg`);
});

const call = async (fetchIcon, qs, host = HOST) => {
  const { default: express } = await import('express');
  const app = express(); app.use('/api', createJiraIconRouter({ host, fetchIcon }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/jira-icon${qs}`);
    return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), nosniff: res.headers.get('x-content-type-options'), body: Buffer.from(await res.arrayBuffer()) };
  } finally { server.close(); }
};
const q = (u) => `?u=${encodeURIComponent(u)}`;
const ICON = `${HOST}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10315?size=medium`;

test('the route returns the image with a day of caching, and asks Jira only for the cleaned URL', async () => {
  const asked = [];
  const r = await call(async (u) => { asked.push(u); return { status: 200, type: 'image/svg+xml;charset=UTF-8', body: Buffer.from('<svg/>') }; }, q(`${ICON}&token=SECRET`));
  assert.equal(r.status, 200);
  assert.equal(r.type, 'image/svg+xml');
  assert.equal(r.cache, 'public, max-age=86400');
  assert.equal(r.nosniff, 'nosniff');
  assert.equal(r.body.toString(), '<svg/>');
  assert.deepEqual(asked, [ICON]);                                   // the token never reached Jira
});

test('a bad address is 400 without calling Jira; a failing or non-image answer is 502', async () => {
  let calls = 0;
  const f = async () => { calls++; return { status: 200, type: 'image/png', body: Buffer.from('x') }; };
  assert.equal((await call(f, q('https://evil.example/images/icons/issuetypes/a.svg'))).status, 400);
  assert.equal((await call(f, '')).status, 400);
  assert.equal((await call(f, q(ICON), '')).status, 400);            // Jira host not configured
  assert.equal(calls, 0);
  assert.equal((await call(async () => ({ status: 404, type: 'image/png', body: Buffer.from('') }), q(ICON))).status, 502);
  assert.equal((await call(async () => ({ status: 200, type: 'text/html', body: Buffer.from('<html>login</html>') }), q(ICON))).status, 502);   // a login page is not an icon
  assert.equal((await call(async () => { throw new Error('timeout'); }, q(ICON))).status, 502);
});
