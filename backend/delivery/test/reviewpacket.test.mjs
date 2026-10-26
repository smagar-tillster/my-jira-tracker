// Run with: npm test   (node's built-in runner; no extra dependency)
// The packet is what the reviewer reads, so these tests keep it small without losing the change itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mytracker-packet-test-'));
process.env.NGK_DATA_DIR = tmp;

const { cleanBody, isTrivialChange, changedLines, packetFor, TRIVIAL_MAX_LINES } = await import('../lib/prpacket.mjs');
const { knownDefectsMarkdown, MAX_DEFECT_CANDIDATES } = await import('../lib/reviewcontext.mjs');

const TEMPLATE_BODY = `## Issue
 Sidebar does not scroll to the selected category.

## Solution
Added scrollSelectedItemIntoView().

## Developer Checklist
-  **Requirements & Jira**
    - [x] Delivery aligns with ticket description and AC.
-  **Testing & documentation**
    - [ ] Create or update Confluence documentation.

## Testing Artifacts
### Before

https://github.com/user-attachments/assets/aaa

### After - All Test Cases

https://github.com/user-attachments/assets/bbb

## Reviewer Checklist
- [ ] Developer checklist completed.

## Notes
Follow-up in the next sprint.
`;

test('cleanBody drops the template checklists and evidence sections but keeps the real description', () => {
  const out = cleanBody(TEMPLATE_BODY);
  assert.match(out, /## Issue/);
  assert.match(out, /scrollSelectedItemIntoView/);
  assert.match(out, /## Notes\nFollow-up in the next sprint\./);
  assert.doesNotMatch(out, /Developer Checklist|Reviewer Checklist|Testing Artifacts|Requirements & Jira|### Before|user-attachments/);
});

test('cleanBody skips a dropped section until a heading of the same or a higher level', () => {
  const out = cleanBody('## Testing Artifacts\n### Before\ntext\n### After\nmore\n## Real\nkept\n');
  assert.equal(out, '## Real\nkept');
});

test('cleanBody removes placeholder text and counts the attachment links it omits', () => {
  const out = cleanBody('## Issue\nProvide a brief explanation of the issue.\n## Solution\nFixed it.\nhttps://example.com/a.mp4\nhttps://example.com/b.mp4\n');
  assert.doesNotMatch(out, /Provide a brief explanation/);
  assert.match(out, /Fixed it\./);
  assert.match(out, /\(2 attachment links omitted\)$/);
});

test('cleanBody keeps a task list that is part of the real description', () => {
  const out = cleanBody('## Plan\n- [x] step one\n- [ ] step two\n');
  assert.match(out, /- \[x\] step one/);
  assert.match(out, /- \[ \] step two/);
});

test('cleanBody works on the CRLF line endings GitHub uses for PR bodies', () => {
  const out = cleanBody(TEMPLATE_BODY.replace(/\n/g, '\r\n'));
  assert.match(out, /scrollSelectedItemIntoView/);
  assert.match(out, /## Notes\nFollow-up in the next sprint\./);
  assert.doesNotMatch(out, /Developer Checklist|Reviewer Checklist|Testing Artifacts|Requirements & Jira|user-attachments|\r/);
});

test('cleanBody handles an empty or missing body', () => {
  assert.equal(cleanBody(''), '');
  assert.equal(cleanBody(undefined), '');
  assert.equal(cleanBody(null), '');
});

test('only small translation changes are trivial', () => {
  assert.equal(TRIVIAL_MAX_LINES, 2);
  assert.equal(isTrivialChange({ kind: 'translations', add: 1, del: 0 }), true);
  assert.equal(isTrivialChange({ kind: 'translations', add: 1, del: 1 }), true);
  assert.equal(isTrivialChange({ kind: 'translations', add: 3, del: 0 }), false);
  assert.equal(isTrivialChange({ kind: 'source', add: 1, del: 0 }), false);
  assert.equal(isTrivialChange({ kind: 'styles', add: 1, del: 0 }), false);
});

test('changedLines lists the added and removed lines on one line', () => {
  const patch = '@@ -10,2 +10,2 @@\n context\n-"a": "old"\n+"a": "new"\n context';
  assert.equal(changedLines(patch), '-"a": "old" ; +"a": "new"');
  assert.equal(changedLines(''), '');
  assert.ok(changedLines(`@@ -1 +1 @@\n+${'x'.repeat(500)}`).length <= 160);
});

const ghFor = (files, view = {}) => async (args) => {
  if (args[0] === 'pr' && args[1] === 'view') {
    return { title: 'Fix sidebar scroll', body: TEMPLATE_BODY, author: { login: 'dev' }, mergedAt: null, state: 'OPEN', url: 'https://github.com/o/r/pull/1', baseRefName: 'main', headRefName: 'fix/sidebar', commits: [{ messageHeadline: 'fix it' }], additions: 20, deletions: 1, changedFiles: files.length, ...view };
  }
  if (args[0] === 'api') return files;
  throw new Error(`unexpected gh call: ${args.join(' ')}`);
};

test('packetFor shows the real diff, summarizes one-line translation changes and drops the template text', async () => {
  const oneLine = (name, key, value) => ({ filename: name, status: 'modified', additions: 1, deletions: 0, patch: `@@ -5,2 +5,3 @@\n a\n+    "${key}": "${value}",\n b` });
  const files = [
    { filename: 'src/common/directives/navigationPanelDirective.js', status: 'modified', additions: 10, deletions: 1, patch: '@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e' },
    oneLine('themes/t/i18n/en-us.json', 'main.high.contrast', 'High contrast'),
    oneLine('themes/t/i18n/es-us.json', 'main.high.contrast', 'Alto contraste'),
    oneLine('themes/t/i18n/fr-ca.json', 'main.high.contrast', 'Contraste élevé'),
    { filename: 'themes/t/i18n/de-de.json', status: 'modified', additions: 5, deletions: 0, patch: '@@ -1,1 +1,6 @@\n a\n+1\n+2\n+3\n+4\n+5' },
  ];
  const p = await packetFor({ gh: ghFor(files), slug: 'o/r', repo: 'kiosk-ui', number: 1, lineNumbers: true });

  assert.match(p.md, /#### src\/common\/directives\/navigationPanelDirective\.js/);
  assert.match(p.md, /R2\s+\+c/); // line-numbered diff of the real change
  assert.match(p.md, /#### themes\/t\/i18n\/de-de\.json/); // a bigger translation change keeps its diff
  assert.doesNotMatch(p.md, /#### themes\/t\/i18n\/en-us\.json/); // one-liners get no diff block
  assert.match(p.md, /## Small translation changes \(3 files/);
  assert.match(p.md, /themes\/t\/i18n\/es-us\.json \+1\/-0: \+"main\.high\.contrast": "Alto contraste",/);
  assert.match(p.md, /## PR description\n## Issue/);
  assert.doesNotMatch(p.md, /Developer Checklist|Reviewer Checklist|user-attachments/);
  assert.equal(p.files.length, 5); // the structured file list is untouched
});

test('packetFor leaves out the small-translation section when there is nothing to collapse', async () => {
  const files = [{ filename: 'src/a.js', status: 'modified', additions: 2, deletions: 0, patch: '@@ -1 +1,3 @@\n a\n+b\n+c' }];
  const p = await packetFor({ gh: ghFor(files), slug: 'o/r', repo: 'kiosk-ui', number: 1 });
  assert.doesNotMatch(p.md, /Small translation changes/);
});

const issue = (n) => ({ key: `NGK-${n}`, fields: { summary: `defect ${n}`, status: { name: 'To Do' }, created: '2026-10-01T00:00:00Z' } });

test('knownDefectsMarkdown lists at most three candidates by default, linked defects first', async () => {
  const calls = [];
  const search = async (jql) => {
    calls.push(jql);
    return jql.includes('linkedIssues') ? [issue(1), issue(2)] : [issue(3), issue(4), issue(5)];
  };
  const md = await knownDefectsMarkdown({ search, keys: ['NGK-9'], title: 'Fix', ticketSummary: '', files: [{ name: 'src/common/directives/navigationPanelDirective.js' }], knownTenants: new Set() });
  const lines = md.split('\n').filter((l) => l.startsWith('- NGK-'));
  assert.equal(MAX_DEFECT_CANDIDATES, 3);
  assert.deepEqual(lines.map((l) => l.slice(2, 7)), ['NGK-1', 'NGK-2', 'NGK-3']);
  assert.match(lines[0], /linked to NGK-9/);
});

test('knownDefectsMarkdown honors a larger limit and still reports none found', async () => {
  const search = async () => [issue(1), issue(2), issue(3), issue(4), issue(5)];
  const base = { search, keys: ['NGK-9'], title: 'Fix', ticketSummary: '', files: [], knownTenants: new Set() };
  assert.equal((await knownDefectsMarkdown({ ...base, limit: 5 })).split('\n').filter((l) => l.startsWith('- NGK-')).length, 5);
  assert.match(await knownDefectsMarkdown({ ...base, search: async () => [] }), /None found/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
