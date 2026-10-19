#!/usr/bin/env node
// Fill / refresh the release ledger for any time span, without the PR scan or HTML report.
// Reads Release tickets from Jira (date = date in the title, else due date), parses description tables (tickets + versions),
// and writes releases/ledger.json plus one markdown file per release (queryable with releases.mjs, or via RAG).
// Needs Jira creds (backend/.env), so run it from the user's terminal.
// Usage: node releases-sync.mjs [--days 30] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--rag-dir PATH]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, today } from '../lib/jira.mjs';
import { syncReleases, copyToRag } from '../lib/releases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8'));
const a = parseArgs(process.argv.slice(2));
const T = today();
const shift = (day, n) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const to = a.to && a.to !== true ? a.to : T;
const from = a.from && a.from !== true ? a.from : shift(to, -Number(a.days || 30));

const { recs, ledgerInfo } = await syncReleases({ minDate: from, maxDate: to, day: T, aliases: cfg.tenantAliases || {} });
const withTickets = recs.filter((r) => r.tickets.some((t) => t.key)).length;
const withVersions = recs.filter((r) => r.versions.length).length;
console.log(`Release ledger synced for ${from} to ${to}`);
console.log(`  ${recs.length} release tickets in that span (${recs.filter((r) => r.done).length} released) · ${withTickets} with a ticket list · ${withVersions} with software versions`);
console.log(`  ledger now holds ${ledgerInfo.count} releases in ${ledgerInfo.dir}`);
if (a['rag-dir']) { const r = copyToRag(String(a['rag-dir']).replace(/^~/, os.homedir())); console.log(`  copied ${r.files} files to ${r.dest}`); }
