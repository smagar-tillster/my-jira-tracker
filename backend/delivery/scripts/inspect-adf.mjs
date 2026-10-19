#!/usr/bin/env node
// Debug helper: shows how a ticket description is structured (ADF node types, links, tables) so parsers can be built.
// Usage: node inspect-adf.mjs NGK-123 [NGK-456 ...]
import { jira } from '../lib/jira.mjs';

for (const key of process.argv.slice(2)) {
  const r = await jira('GET', `/issue/${key}?fields=summary,description,components,fixVersions,issuelinks,subtasks,status`);
  const types = {};
  const links = new Set();
  const issueKeys = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type) types[n.type] = (types[n.type] || 0) + 1;
    const url = n.attrs?.url || (n.marks || []).map((m) => m.attrs?.href).find(Boolean);
    if (url) { links.add(url); (url.match(/NGK-\d+/gi) || []).forEach((k) => issueKeys.add(k.toUpperCase())); }
    if (n.type === 'text' && /NGK-\d+/i.test(n.text || '')) (n.text.match(/NGK-\d+/gi) || []).forEach((k) => issueKeys.add(k.toUpperCase()));
    (n.content || []).forEach(walk);
  };
  walk(r.fields.description);
  console.log(`\n===== ${key}: ${r.fields.summary}`);
  console.log(`status: ${r.fields.status?.name} | components: ${(r.fields.components || []).map((c) => c.name).join(', ')} | fixVersions: ${(r.fields.fixVersions || []).map((v) => v.name).join(', ')}`);
  console.log(`issuelinks: ${(r.fields.issuelinks || []).length} | subtasks: ${(r.fields.subtasks || []).length}`);
  console.log('ADF node types:', JSON.stringify(types));
  console.log(`NGK keys referenced in description (${issueKeys.size}):`, [...issueKeys].slice(0, 40).join(', '));
  console.log('sample links:', [...links].slice(0, 4).join(' | '));
  // show the text around "includes" / versions sections
  const flat = [];
  const text = (n) => { if (!n) return ''; if (n.type === 'text') return n.text; if (n.type === 'inlineCard') return `<${(n.attrs?.url || '').split('/').pop()}>`; if (n.type === 'hardBreak') return '\n'; const inner = (n.content || []).map(text).join(n.type === 'tableRow' ? ' | ' : ''); return ['paragraph', 'heading', 'listItem', 'tableRow', 'taskItem'].includes(n.type) ? inner + '\n' : inner; };
  const full = text(r.fields.description);
  const i = full.search(/This release includes/i);
  console.log('--- text from "This release includes" (first 1200 chars) ---');
  console.log(full.slice(Math.max(0, i), Math.max(0, i) + 1200));
  void flat;
}
