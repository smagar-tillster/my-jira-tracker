// Self-contained HTML renderer for the daily delivery summary (no external assets, light/dark aware).
// Input is the plain data object built by scripts/daily.mjs. Output is one HTML string.
// Every section and every card is a <details> element, so it can be collapsed.
import { componentList, explainRelease } from './releases.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));

const statusClass = (status, category) => {
  const s = String(status || '').toLowerCase();
  if (category === 'Done' || /released|done|closed/.test(s)) return 'ok';
  if (/blocked|returned|changes requested/.test(s)) return 'bad';
  if (/qa|uat|ready for|approved|review/.test(s)) return 'info';
  if (/^(to do|backlog|open|ready to build|draft)$/.test(s)) return 'muted';
  return 'warn';
};
const badge = (text, cls) => `<span class="badge ${cls}">${esc(text)}</span>`;
const statusBadge = (status, category) => badge(status, statusClass(status, category));
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
const tk = (d, key) => link(`${d.jiraBase}/browse/${key}`, key);
const rowAttr = (...parts) => ` data-s="${esc(parts.filter(Boolean).join(' ').toLowerCase())}"`;
// data-c holds component names and versions, so the dedicated Component filter can match them
const compAttr = (cl, items) => ` data-c="${esc((cl.map((c) => `${c.name} ${c.version}`).join(' ') + ' ' + items.map((i) => `${i.component || ''} ${i.version || ''}`).join(' ')).toLowerCase())}"`;

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2230;--sub:#5b6577;--line:#e3e7ee;--accent:#2f5bd3;--ok:#1d7a46;--okbg:#e4f5ea;--bad:#b3261e;--badbg:#fbe6e4;--warn:#8a5a00;--warnbg:#fdf0d5;--info:#1f5aa6;--infobg:#e3eefb;--mutedbg:#eceff4;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--card:#1a1f29;--ink:#e6e9f0;--sub:#9aa4b6;--line:#2a3140;--accent:#7ea3ff;--ok:#6fd49a;--okbg:#17321f;--bad:#ff9189;--badbg:#3a1b19;--warn:#f0c15a;--warnbg:#3a2d10;--info:#8fbaf5;--infobg:#172a44;--mutedbg:#262c39}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header.top{padding:20px 24px 8px;max-width:1280px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--sub);font-size:13px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.chip{background:var(--mutedbg);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--sub)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;max-width:1280px;margin:12px auto 0;padding:0 24px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px}.stat b{display:block;font-size:24px;line-height:1.1}.stat span{color:var(--sub);font-size:12px}
nav{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);margin-top:14px}
nav .in{max-width:1280px;margin:0 auto;padding:8px 24px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}nav a{font-weight:600;font-size:13px}
nav input#qc{margin-left:auto}nav button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}nav button:hover{border-color:var(--accent)}
nav input{padding:5px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);min-width:220px}
main{max-width:1280px;margin:0 auto;padding:8px 24px 40px}
/* collapsible sections and cards */
details.sec{margin-top:22px}details.sec>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:8px;font-size:17px;font-weight:700;color:var(--ink);padding:6px 0;border-bottom:2px solid var(--line)}
details.sec>summary::-webkit-details-marker,details.card>summary::-webkit-details-marker{display:none}
details.sec>summary::before,details.card>summary::before{content:"▾";color:var(--sub);font-size:12px;width:14px;flex:none}
details.sec:not([open])>summary::before,details.card:not([open])>summary::before{content:"▸"}
details.sec>.body{padding-top:8px}.hint{color:var(--sub);font-size:12.5px;margin:0 0 10px}
details.card{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:10px 0;overflow:hidden}
details.card>summary{list-style:none;cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;font-weight:600;font-size:14px;color:var(--ink)}
details.card[open]>summary{border-bottom:1px solid var(--line)}
details.card>summary .n{color:var(--sub);font-weight:400;font-size:12.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:10px 0;overflow:hidden}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;color:var(--sub);font-weight:600;padding:7px 12px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--mutedbg) 55%,transparent)}
td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:none}
td.k{white-space:nowrap;font-family:var(--mono);font-size:12.5px}td.ten{font-weight:700;white-space:nowrap}
.badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:11.5px;font-weight:600;white-space:nowrap}
.badge.ok{background:var(--okbg);color:var(--ok)}.badge.bad{background:var(--badbg);color:var(--bad)}.badge.warn{background:var(--warnbg);color:var(--warn)}.badge.info{background:var(--infobg);color:var(--info)}.badge.muted{background:var(--mutedbg);color:var(--sub)}
.what b{font-weight:600}.what .l2{color:var(--sub);font-size:12.5px;margin-top:2px}
.ver{display:inline-block;font-family:var(--mono);font-size:11.5px;background:var(--mutedbg);border-radius:5px;padding:1px 6px;margin:1px 3px 1px 0}
details.inner{margin-top:6px}details.inner>summary{cursor:pointer;color:var(--accent);font-size:12.5px}
details.inner table{margin-top:6px;border:1px solid var(--line);border-radius:8px}details.inner td,details.inner th{padding:5px 9px;font-size:12.5px}
.empty{padding:14px;color:var(--sub);font-style:italic}.note{color:var(--sub);font-size:12px;font-weight:400}
footer{max-width:1280px;margin:0 auto;padding:0 24px 40px;color:var(--sub);font-size:12px}
dialog{border:1px solid var(--line);border-radius:12px;padding:0;max-width:880px;width:92vw;max-height:86vh;background:var(--card);color:var(--ink)}
dialog::backdrop{background:rgba(10,14,22,.55)}
#dbody{padding:16px 22px 22px;overflow:auto;max-height:calc(86vh - 6px)}
.dclose{position:absolute;top:10px;right:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;z-index:2}
.mh{padding-right:70px}.mh h3{margin:0 0 4px;font-size:16px}.msec{margin-top:16px}.msec h4{margin:0 0 6px;font-size:12px;color:var(--sub);text-transform:uppercase;letter-spacing:.05em}
.msec ul{margin:4px 0 0 18px;padding:0}.msec li{margin:4px 0}.msec p{margin:4px 0}.msec table{margin-top:4px}
.aibox{border-left:3px solid var(--accent);background:color-mix(in srgb,var(--infobg) 60%,transparent);padding:8px 14px;border-radius:0 8px 8px 0}
.abtn{border:1px solid var(--accent);color:var(--accent);background:transparent;border-radius:7px;padding:3px 9px;font-size:12px;cursor:pointer}.abtn:hover{background:var(--infobg)}
@media (max-width:760px){main,header.top,.stats,nav .in{padding-left:12px;padding-right:12px}td,th{padding:6px 8px}}
`;

const JS = `
const q=document.getElementById('q'),qc=document.getElementById('qc');
const all=(sel)=>document.querySelectorAll(sel);
const apply=()=>{
  const v=q.value.trim().toLowerCase(),c=qc.value.trim().toLowerCase();
  all('tr[data-s]').forEach(r=>{const okS=!v||r.dataset.s.includes(v);const okC=!c||r.dataset.c===undefined||r.dataset.c.includes(c);r.style.display=okS&&okC?'':'none'});
  if(v||c)all('details').forEach(d=>{if(d.querySelector('tr[data-s]:not([style*="none"])'))d.open=true});
};
q.addEventListener('input',apply);qc.addEventListener('input',apply);
document.getElementById('ex').addEventListener('click',()=>all('details').forEach(d=>d.open=true));
document.getElementById('co').addEventListener('click',()=>all('details').forEach(d=>d.open=false));
`;

const section = (id, title, hint, body) => `<details class="sec" id="${id}" open><summary>${title}</summary><div class="body">${hint ? `<p class="hint">${hint}</p>` : ''}${body}</div></details>`;

// ---------------------------------------------------------------- sections
const completedSection = (d) => {
  const rows = d.completed.map((g) => {
    const rel = g.tickets.map((t) => `${tk(d, t.key)}${t.env ? ` <span class="note">${esc(t.env)}</span>` : ''} ${statusBadge(t.status, t.statusCategory)}`).join('<br>');
    const cl = componentList(g);
    const compCell = cl.length ? cl.map((c) => `<span class="ver">${esc(c.name)}${c.version ? ` <b>(${esc(c.version)})</b>` : ''}</span>`).join('') : '<span class="note">none listed</span>';
    const items = g.items.length ? `<details class="inner"><summary>${g.items.length} ticket${g.items.length > 1 ? 's' : ''} in this release</summary><table><tr><th>Ticket</th><th>Summary</th><th>Component</th><th>Version</th><th>Status</th><th>Notes</th></tr>${g.items.map((i) => `<tr${rowAttr(i.key, i.summary, i.component, g.tenant)} data-c="${esc(`${i.component || ''} ${i.version || ''}`.toLowerCase())}"><td class="k">${i.key ? tk(d, i.key) : '-'}</td><td>${esc(trunc(i.summary || i.label || '', 90))}</td><td>${esc(i.component || '')}</td><td>${esc(i.version || '')}</td><td>${i.status ? statusBadge(i.status, i.statusCategory) : ''}</td><td>${esc(trunc(i.notes || '', 120))}</td></tr>`).join('')}</table></details>` : '';
    return `<tr${rowAttr(g.tenant, g.what, cl.map((c) => `${c.name} ${c.version}`).join(' '), g.tickets.map((t) => t.key).join(' '), g.items.map((i) => (i.key || '') + ' ' + (i.summary || '')).join(' '))}${compAttr(cl, g.items)}><td class="ten">${esc(g.tenant)}</td><td>${rel}</td><td class="what"><b>${esc(g.what)}</b><div class="l2">${esc(explainRelease(g))}${g.notes ? `<br>Note: ${esc(trunc(g.notes, 160))}` : ''}</div>${items}</td><td>${compCell}</td></tr>`;
  });
  return section('completed', `Completed releases <span class="note">dated ${esc(d.prettyYday)} · ${d.completed.length} releases</span>`,
    'Found by release-ticket date (title date, else due date); “released” means the release ticket\'s Jira status is done. Components come from the title and the Jira Components field; tickets and versions come from the ticket description.',
    `<div class="card">${rows.length ? `<table><tr><th>Tenant</th><th>Release ticket</th><th>What was released</th><th>Components (version)</th></tr>${rows.join('')}</table>` : '<div class="empty">No release tickets are dated that day.</div>'}</div>`);
};

const needsSection = (d) => {
  const cards = d.needs.map((g) => {
    const open = g.releaseTickets.map((r) => `${tk(d, r.key)}${r.env ? ` <span class="note">${esc(r.env)}</span>` : ''} ${statusBadge(r.status, r.statusCategory)}`).join(' · ');
    const rt = (open || (g.releasedCount ? badge('no open release ticket', 'warn') : badge('No release ticket yet', 'warn'))) + (g.releasedCount ? ` <span class="note">+${g.releasedCount} already released</span>` : '');
    const trs = g.tickets.map((t) => `<tr${rowAttr(t.key, t.summary, t.assignee, g.fixVersion)}><td class="k">${tk(d, t.key)}</td><td>${esc(trunc(t.summary, 100))}</td><td>${statusBadge(t.status, t.statusCategory)}</td><td>${esc(t.assignee || 'unassigned')}</td><td>${esc((t.clients || []).join(', ') || '-')}</td></tr>`).join('');
    return `<details class="card" open><summary>${esc(g.fixVersion)} <span class="n">${g.tickets.length} not ready · release ticket: ${rt}</span></summary><table><tr><th>Ticket</th><th>Summary</th><th>Status</th><th>Assignee</th><th>Client</th></tr>${trs}</table></details>`;
  });
  const total = d.needs.reduce((n, g) => n + g.tickets.length, 0);
  return section('needs', `Needs release today <span class="note">${esc(d.prettyDay)} · ${total} tickets</span>`,
    `Sprint tickets (${esc(d.scope.component === 'any' ? 'all components' : d.scope.component + ' component')}) whose fix version date is today and that are not ready (Ready for QA counts as ready). The release ticket may or may not exist yet.`,
    cards.length ? cards.join('') : '<div class="card"><div class="empty">Nothing is waiting on a release dated today.</div></div>');
};

const mergedSection = (d) => {
  const repos = d.mergedByRepo.filter((r) => r.prs.length); // repos without PRs are not shown
  const cards = repos.map(({ repo, prs }) => {
    const trs = prs.map((p) => `<tr${rowAttr(p.number, p.keys.join(' '), p.title, p.detail, p.author, repo)}><td class="k">${link(p.url, '#' + p.number)}</td><td class="k">${p.keys.length ? p.keys.map((k) => tk(d, k)).join('<br>') : '-'}</td><td class="what"><b>${esc(trunc(p.line1, 110))}</b>${p.line2 ? `<div class="l2">${esc(trunc(p.line2, 220))}</div>` : ''}</td><td>${understandCell(p)}</td><td>${depCell(p)}</td><td>${esc(p.dayLabel)}</td><td>${esc(p.author)}</td></tr>`).join('');
    return `<details class="card" open><summary>${esc(repo)} <span class="n">${prs.length} merged · ${prs.filter((p) => p.analysis).length} reviewed</span></summary><table><tr><th>PR</th><th>Ticket</th><th>What it builds</th><th>Change understanding</th><th>Depends on</th><th>Merged</th><th>Author</th></tr>${trs}</table></details>`;
  });
  const total = repos.reduce((n, r) => n + r.prs.length, 0);
  return section('merged', `Merged PRs by repo <span class="note">${total} PRs in ${repos.length} repo${repos.length === 1 ? '' : 's'}</span>`,
    `Only what merged since the last run (${esc(d.window?.sinceLabel || '')} to ${esc(d.window?.untilLabel || '')}; ${esc(d.window?.note || '')}). Repos with no merged PRs are not shown. “What it builds” is the PR title plus the first useful line of its description; “Change understanding” is an AI-assisted reading of the diff (verify), with the full detail in the button.`,
    cards.length ? cards.join('') : '<div class="card"><div class="empty">No PRs merged in this period.</div></div>');
};

// ---------------------------------------------------------------- dependencies (deeper PR analysis)
const refState = (s) => (s === 'MERGED' ? 'ok' : s === 'OPEN' ? 'warn' : s === 'CLOSED' ? 'bad' : 'muted');
const repoShort = (slug) => String(slug).split('/')[1] || slug;

/** Compact per-PR dependency chips: version bumps, referenced PRs in other repos, and the same ticket in other repos. */
const depCell = (p) => {
  const x = p.deps || { bumps: [], refs: [], siblings: [] };
  const parts = [];
  for (const b of x.bumps.slice(0, 4)) parts.push(`<span class="ver" title="${esc(b.file)}">${esc(b.name)} ${esc(b.from || 'new')} → ${esc(b.to || 'removed')}</span>`);
  if (x.bumps.length > 4) parts.push(`<span class="note">+${x.bumps.length - 4} more bumps</span>`);
  for (const r of x.refs) parts.push(`<a class="ver" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(repoShort(r.slug))}#${r.number} ${badge(String(r.state || '?').toLowerCase(), refState(r.state))}</a>`);
  for (const s of x.siblings) parts.push(`<a class="ver" href="${esc(s.url)}" target="_blank" rel="noopener">also ${esc(s.repo)}#${s.number}</a>`);
  return parts.join('') || '<span class="note">none found</span>';
};

const depsSection = (d) => {
  const rows = (d.deps || []).map((t) => {
    const prs = t.prs.map((p) => `${link(p.url, `${p.repo}#${p.number}`)} <span class="note">${esc(p.component)}</span>`).join('<br>');
    const changes = [
      ...t.bumps.map((b) => `<span class="ver" title="${esc(b.file)} in ${esc(b.repo)}">${esc(b.name)} ${esc(b.from || 'new')} → ${esc(b.to || 'removed')}</span>`),
      ...t.refs.map((r) => `<a class="ver" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(repoShort(r.slug))}#${r.number} ${badge(String(r.state || '?').toLowerCase(), refState(r.state))}</a>`),
    ].join('') || '<span class="note">none</span>';
    const jl = t.links.filter((l) => l.rel !== 'parent').slice(0, 5).map((l) => `<div>${esc(l.rel)} ${tk(d, l.key)} ${statusBadge(l.status, l.statusCategory)} <span class="note">${esc(trunc(l.summary, 50))}</span></div>`).join('') || '<span class="note">none</span>';
    const dec = (t.declared || []).map((dd) => `<div>${tk(d, dd.release)} ${statusBadge(dd.status, dd.statusCategory)} <span class="note">${esc(dd.tenant)} ${esc(dd.date)}</span><div>${dd.components.map((c) => `<span class="ver">${esc(c.name)}${c.version ? ` <b>(${esc(c.version)})</b>` : ''}</span>`).join('') || '<span class="note">no components listed</span>'}</div></div>`).join('') || '<span class="note">not in any release yet</span>';
    const waiting = t.blockers.filter((b) => b.statusCategory !== 'Done');
    const openRefs = t.refs.filter((r) => r.state === 'OPEN');
    const impl = `Ships together: <b>${esc(t.components.join(' + '))}</b>${(t.needsOther || []).length ? `<div>${badge('release also needs ' + t.needsOther.map((c) => c.name).join(', '), 'info')}</div>` : ''}${waiting.length ? `<div>${badge('waiting on ' + waiting.map((b) => b.key).join(', '), 'bad')}</div>` : ''}${openRefs.length ? `<div>${badge('unmerged dependency: ' + openRefs.map((r) => repoShort(r.slug) + '#' + r.number).join(', '), 'warn')}</div>` : ''}`;
    return `<tr${rowAttr(t.key, t.summary, t.components.join(' '), t.bumps.map((b) => b.name).join(' '), t.refs.map((r) => r.slug + ' ' + r.title).join(' '))}><td>${tk(d, t.key)} ${statusBadge(t.status, t.statusCategory)}<div class="note">${esc(trunc(t.summary, 70))}</div></td><td>${prs}</td><td>${changes}</td><td>${jl}</td><td>${dec}</td><td>${impl}</td></tr>`;
  });
  return section('deps', `Dependencies and cross-component links <span class="note">${rows.length} ticket${rows.length === 1 ? '' : 's'}</span>`,
    'For merged PRs, all found by rules (no guessing): version bumps in pom.xml / package.json, PRs referenced in other repos, the same ticket in several repos, Jira “blocked by” links, and the components the release ticket itself declares for the ticket (from the release ledger). Together these show what has to ship with the change.',
    `<div class="card">${rows.length ? `<table><tr><th>Ticket</th><th>PRs · component</th><th>Dependency changes · referenced PRs</th><th>Jira links</th><th>Release declares (components · versions)</th><th>Release implication</th></tr>${rows.join('')}</table>` : '<div class="empty">No cross-component dependencies found in the merged PRs.</div>'}</div>`);
};

// ---------------------------------------------------------------- PR analysis modal (button per merged PR)
const riskCls = (r) => (r === 'high' ? 'bad' : r === 'medium' ? 'warn' : 'ok');
const modalId = (p) => `m-${p.repo}-${p.number}`;
const analysisBtn = (p) => `<button class="abtn" type="button" data-m="${esc(modalId(p))}">${p.analysis ? 'Analysis' : 'Details'}</button>${p.analysis?.risk ? ` ${badge(p.analysis.risk, riskCls(p.analysis.risk))}` : ''}`;

/** Inline change understanding: my one-paragraph summary and risk, with the button that opens the full modal. */
const understandCell = (p) => `${p.analysis ? `<div class="l2" style="color:var(--ink)">${esc(trunc(p.analysis.summary, 240))}</div>` : '<span class="note">pending analysis</span>'}<div style="margin-top:4px">${analysisBtn(p)}</div>`;

const prModal = (d, p) => {
  const x = p.deps || { bumps: [], refs: [], siblings: [], files: [] };
  const a = p.analysis;
  const files = [...(x.files || [])].sort((m, n) => (n.add + n.del) - (m.add + m.del));
  const add = files.reduce((s, f) => s + f.add, 0); const del = files.reduce((s, f) => s + f.del, 0);
  const fl = files.slice(0, 12).map((f) => `<tr><td class="k">${esc(f.name)}</td><td>+${f.add} / −${f.del}</td></tr>`).join('');
  const dep = [];
  x.bumps.forEach((b) => dep.push(`Version bump: <b>${esc(b.name)}</b> ${esc(b.from || 'new')} → ${esc(b.to || 'removed')} <span class="note">(${esc(b.file)})</span>`));
  x.refs.forEach((r) => dep.push(`References ${link(r.url, repoShort(r.slug) + '#' + r.number)} ${badge(String(r.state || '?').toLowerCase(), refState(r.state))} <span class="note">${esc(trunc(r.title || '', 70))}</span>`));
  x.siblings.forEach((s) => dep.push(`Same ticket also merged in ${link(s.url, s.repo + '#' + s.number)}`));
  for (const t of p.ticketDeps || []) {
    t.links.filter((l) => l.rel !== 'parent').slice(0, 5).forEach((l) => dep.push(`Jira: ${esc(l.rel)} ${tk(d, l.key)} ${statusBadge(l.status, l.statusCategory)} <span class="note">${esc(trunc(l.summary, 60))}</span>`));
    t.declared.slice(0, 2).forEach((dd) => dep.push(`Release ${tk(d, dd.release)} ${statusBadge(dd.status, dd.statusCategory)} declares: ${dd.components.map((c) => `<span class="ver">${esc(c.name)}${c.version ? ` <b>(${esc(c.version)})</b>` : ''}</span>`).join('') || '—'}`));
    if (t.needsOther.length) dep.push(`${badge('not covered by these PRs', 'info')} ${esc(t.needsOther.map((c) => c.name).join(', '))}`);
  }
  const ul = (arr) => `<ul>${(arr || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  const ai = a
    ? a.ai === false
      ? `<div class="aibox"><div class="note">Not AI-reviewed (${esc(a.basis || 'rules only')}; ${esc(a.generatedAt || '')}). Ask Claude to “analyze this PR” for a full reading.</div><p>${esc(a.summary)}</p></div>`
      : `<div class="aibox"><div class="note">AI-assisted reading of the diff and ticket (${esc(a.basis || '')}; written ${esc(a.generatedAt || '')}). Verify before relying on it.</div><p><b>${esc(a.summary)}</b></p><div class="note">How it works</div>${ul(a.how)}<div class="note">Dependencies (my reading)</div>${ul(a.dependencies)}</div>`
    : '<p class="note">No analysis written yet. Ask Claude to “analyze this PR”: it reads the diff and ticket and adds one here.</p>';
  return `<template id="${esc(modalId(p))}"><div class="mh"><h3>${esc(p.repo)}#${p.number} · ${esc(trunc(p.line1, 110))}</h3><div class="note">${p.keys.map((k) => tk(d, k)).join(', ') || 'no ticket'} · ${esc(p.author)} · merged ${esc(p.dayLabel)} · ${link(p.url, 'open on GitHub')}</div></div>
<div class="msec"><h4>What changed</h4><p>${files.length} files, +${add} / −${del}</p>${fl ? `<table><tr><th>File (top 12 by size)</th><th>Lines</th></tr>${fl}</table>` : ''}</div>
<div class="msec"><h4>Dependencies${a?.risk ? ` · risk ${badge(a.risk, riskCls(a.risk))}` : ''}</h4>${dep.length ? `<ul>${dep.map((s) => `<li>${s}</li>`).join('')}</ul>` : '<p class="note">None found by the rules.</p>'}</div>
<div class="msec"><h4>Understanding</h4>${ai}</div>
${a?.confirm?.length ? `<div class="msec"><h4>Please confirm</h4>${ul(a.confirm)}</div>` : ''}</template>`;
};

const MODAL_JS = `
const dlg=document.getElementById('dlg'),dbody=document.getElementById('dbody');
document.addEventListener('click',(e)=>{const b=e.target.closest('.abtn');if(b){const t=document.getElementById(b.dataset.m);if(!t)return;dbody.innerHTML='';dbody.appendChild(t.content.cloneNode(true));dlg.showModal();dbody.scrollTop=0;return}if(e.target===dlg)dlg.close()});
document.getElementById('dclose').addEventListener('click',()=>dlg.close());
`;

/** Standalone page for a release query (releases.mjs --format html): the Completed releases table for any span, with the same filters. */
export const renderReleasesHtml = ({ title, subtitle, groups, jiraBase, generatedAt }) => {
  const d = { completed: groups.map((g) => ({ ...g, allDone: g.tickets.every((t) => t.done) })), jiraBase, prettyYday: subtitle };
  const released = d.completed.filter((g) => g.allDone).length;
  const body = completedSection(d).replace(/Completed releases <span class="note">dated /, 'Releases <span class="note">').replace(/\(title date, else due date\)/, '(title date, else due date)');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<header class="top"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)} · generated ${esc(generatedAt)}</div></div></header>
<div class="stats"><div class="stat"><b>${d.completed.length}</b><span>releases (${released} fully released)</span></div><div class="stat"><b>${new Set(d.completed.map((g) => g.tenant)).size}</b><span>tenants</span></div></div>
<nav><div class="in"><button id="ex" type="button">Expand all</button><button id="co" type="button">Collapse all</button><input id="qc" type="search" placeholder="Component / version (e.g. FE, Menu Service)"><input id="q" type="search" placeholder="Search everything (ticket, tenant, text)"></div></nav>
<main>${body}</main><footer>Releases come from Release tickets (date in the title, else due date). “Released” = the release ticket's Jira status is done and can lag the real deployment.</footer><script>${JS}</script></body></html>`;
};

export const renderHtml = (d) => {
  const stat = (n, label) => `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  const releasedCount = d.completed.filter((g) => g.allDone).length;
  const mergedTotal = d.mergedByRepo.reduce((n, r) => n + r.prs.length, 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NGK daily delivery summary ${esc(d.day)}</title><style>${CSS}</style></head><body>
<header class="top"><h1>Daily delivery summary</h1><div class="sub">${esc(d.prettyDay)} · generated ${esc(d.generatedAt)}</div>
<div class="chips"><span class="chip">${esc(d.scope.sprint)}</span><span class="chip">${esc(d.scope.component === 'any' ? 'all components' : d.scope.component + ' component')}</span><span class="chip">releases day before: ${esc(d.prettyYday)}</span><span class="chip">PRs: ${esc(d.window?.note || '')}</span></div></header>
<div class="stats">${stat(d.completed.length, `releases dated ${d.prettyYday} (${releasedCount} released)`)}${stat(d.needs.reduce((n, g) => n + g.tickets.length, 0), 'tickets need release today')}${stat(mergedTotal, 'PRs merged')}</div>
<nav><div class="in"><a href="#completed">Completed releases</a><a href="#needs">Needs release today</a><a href="#merged">Merged PRs</a><a href="#deps">Dependencies</a><button id="ex" type="button">Expand all</button><button id="co" type="button">Collapse all</button><input id="qc" type="search" placeholder="Component / version (e.g. FE, Menu Service)"><input id="q" type="search" placeholder="Search everything (ticket, tenant, text)"></div></nav>
<main>${completedSection(d)}${needsSection(d)}${mergedSection(d)}${depsSection(d)}</main>
<footer>Releases come from Release tickets (date in the title, else due date), not fix versions. Ready for QA counts as done. A release ticket marked Released can lag the real deployment; the release ledger keeps one markdown file per release for later questions.</footer>
${d.mergedByRepo.flatMap((r) => r.prs).map((p) => prModal(d, p)).join('')}
<dialog id="dlg"><button id="dclose" class="dclose" type="button">Close ✕</button><div id="dbody"></div></dialog>
<script>${JS}${MODAL_JS}</script></body></html>`;
};
