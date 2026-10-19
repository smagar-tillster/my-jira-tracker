#!/usr/bin/env node
// Gather everything needed to groom one ticket, deterministically, so the AI only does the thinking.
// Usage: node groom-context.mjs NGK-123 [--related 8]
// Prints: fields, description, comments, links, subtasks, parent, and recent same-client tickets.
import { jira, search, mapIssue, FIELDS, parseArgs, jiraUrl, PROJECT } from '../lib/jira.mjs';

const a = parseArgs(process.argv.slice(2));
const key = a._[0];
if (!key) { console.error('Usage: groom-context.mjs NGK-123'); process.exit(2); }

const adfText = (n) => {
  if (!n) return '';
  if (typeof n === 'string') return n;
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  const inner = (n.content || []).map(adfText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'tableRow'].includes(n.type) ? inner + '\n' : inner;
};

const issue = await jira('GET', `/issue/${key}?fields=summary,description,status,issuetype,priority,assignee,duedate,fixVersions,components,labels,parent,subtasks,issuelinks,comment,${FIELDS.client},${FIELDS.uat},${FIELDS.qaNotes}&expand=renderedFields`);
const f = issue.fields;
const m = mapIssue(issue);

console.log(`# ${key}: ${m.summary}\n${jiraUrl(key)}\n`);
console.log(`Status: ${m.status} | Type: ${m.type} | Priority: ${m.priority} | Assignee: ${m.assignee || '-'}`);
console.log(`Client: ${m.clients.join(', ') || '-'} | Components: ${m.components.join(', ') || '-'} | Labels: ${m.labels.join(', ') || '-'}`);
console.log(`UAT: ${m.uat || '-'} | Release: ${m.release || '-'} (${m.fixVersions.join(', ') || 'no fixVersion'}) | Due: ${m.due || '-'}`);
if (m.parentKey) console.log(`Parent: ${m.parentKey}`);
console.log(`\n## Description\n${adfText(f.description).trim() || '(empty)'}`);
if (f[FIELDS.qaNotes]) console.log(`\n## QA notes\n${adfText(f[FIELDS.qaNotes]).trim()}`);

const links = (f.issuelinks || []).map((l) => {
  const o = l.outwardIssue || l.inwardIssue;
  return `- ${l.outwardIssue ? l.type.outward : l.type.inward}: ${o.key} — ${o.fields?.summary} [${o.fields?.status?.name}]`;
});
console.log(`\n## Links (${links.length})\n${links.join('\n') || '(none)'}`);
const subs = (f.subtasks || []).map((s) => `- ${s.key} — ${s.fields.summary} [${s.fields.status.name}]`);
console.log(`\n## Subtasks (${subs.length})\n${subs.join('\n') || '(none)'}`);

const comments = f.comment?.comments || [];
console.log(`\n## Comments (${comments.length}, last 10)`);
for (const c of comments.slice(-10)) console.log(`- ${c.created.slice(0, 10)} ${c.author.displayName}: ${adfText(c.body).trim().replace(/\n+/g, ' ').slice(0, 500)}`);

if (m.clients[0]) {
  const rel = (await search(`project = ${PROJECT} AND cf[16047] = "${m.clients[0]}" AND key != ${key} ORDER BY updated DESC`)).slice(0, Number(a.related || 8)).map(mapIssue);
  console.log(`\n## Recent ${m.clients[0]} tickets (for patterns / prior art)`);
  for (const r of rel) console.log(`- ${r.key} [${r.status}] ${r.summary.slice(0, 90)}`);
}
console.log('\n(Next: AI reads the repo code relevant to the components above, drafts the approach, user approves, then post via apply.mjs "comment".)');
