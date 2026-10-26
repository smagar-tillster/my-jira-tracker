import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { PrReview, PrReviewComment, ReviewApiError, ReviewQueueItem, generateBusy, reviewsApi } from '../services/api';
import { jobText, prId, useCodeReview } from './delivery/useCodeReview';

type Filter = 'todo' | 'posted' | 'closed' | 'all';

const rid = (r: PrReview) => `${r.repo}#${r.number}@${r.headSha.slice(0, 7)}`;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
// The marker line is for the backend and GitHub; it is invisible once posted, so don't show it while reading.
const visibleBody = (r: PrReview) => r.body.replace(r.marker, '').trim();
const isOutdated = (r: PrReview) => r.status === 'stale' || (r.status === 'draft' && r.current === false);
const canPost = (r: PrReview) => r.status === 'draft' && r.current !== false;
const includedCount = (r: PrReview) => r.inline.filter(c => c.include !== false).length;

const RISK: Record<string, string> = { low: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', high: 'bg-red-100 text-red-700' };
const SEVERITY: Record<string, { label: string; cls: string }> = {
  issue: { label: 'Issue', cls: 'bg-red-100 text-red-700' },
  suggestion: { label: 'Suggestion', cls: 'bg-blue-100 text-blue-700' },
  question: { label: 'Question', cls: 'bg-purple-100 text-purple-700' },
  nit: { label: 'Nit', cls: 'bg-gray-100 text-gray-600' },
  note: { label: 'Note', cls: 'bg-gray-100 text-gray-600' },
};

const Badge: React.FC<{ className: string; children: React.ReactNode; title?: string }> = ({ className, children, title }) => (
  <span title={title} className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${className}`}>{children}</span>
);

// Markdown for review text. A ```suggestion block is shown the way GitHub shows it: as a suggested change.
const Md: React.FC<{ text: string }> = ({ text }) => (
  <div className="prose prose-sm max-w-none">
    <ReactMarkdown
      components={{
        a: ({ node, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" />,
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const code = String(children).replace(/\n$/, '');
          if (className?.includes('language-suggestion')) {
            return (
              <div className="not-prose my-2 border border-green-200 rounded-md overflow-hidden">
                <div className="px-3 py-1 text-xs font-semibold text-green-800 bg-green-50 border-b border-green-200">Suggested change</div>
                <pre className="m-0 px-3 py-2 text-xs font-mono bg-green-50/50 text-gray-800 overflow-x-auto whitespace-pre">{code}</pre>
              </div>
            );
          }
          if (className || code.includes('\n')) {
            return <pre className="not-prose my-2 px-3 py-2 text-xs font-mono bg-gray-50 border border-gray-200 rounded-md overflow-x-auto whitespace-pre">{code}</pre>;
          }
          return <code>{children}</code>;
        },
      }}>
      {text}
    </ReactMarkdown>
  </div>
);

const DiffSnippet: React.FC<{ c: PrReviewComment }> = ({ c }) => {
  if (!c.diffContext?.length) return null;
  return (
    <div className="font-mono text-xs border border-gray-200 rounded-md overflow-hidden bg-white">
      {c.diffContext.map((l, i) => (
        <div key={i} className={`flex ${l.type === 'add' ? 'bg-green-50' : l.type === 'del' ? 'bg-red-50' : ''} ${l.anchor ? 'ring-1 ring-inset ring-blue-400' : ''}`}>
          <span className="w-10 shrink-0 text-right pr-2 text-gray-400 select-none">{l.n}</span>
          <span className={`w-4 shrink-0 select-none ${l.type === 'add' ? 'text-green-700' : l.type === 'del' ? 'text-red-700' : 'text-gray-300'}`}>{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
          <span className="whitespace-pre overflow-x-auto pr-2">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  );
};

const TIER_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  deep: { label: 'deep', cls: 'bg-purple-100 text-purple-700', title: 'Larger or riskier change: a thorough review with the surrounding code' },
  light: { label: 'light', cls: 'bg-blue-100 text-blue-700', title: 'Ordinary change: a short review' },
  skip: { label: 'small', cls: 'bg-gray-100 text-gray-500', title: 'The rules would normally skip this (docs, tests, styles, translations or tiny)' },
};
const JOB_TONE: Record<string, string> = { info: 'text-blue-700', ok: 'text-green-700', warn: 'text-amber-700', err: 'text-red-600' };

/** Open PRs with no review yet. Tick several and press Initiate Code Review: each becomes a draft below; nothing is posted. */
const InitiatePanel: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadQueue = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const q = await reviewsApi.queue();
      setItems(q);
      setPicked(prev => new Set([...prev].filter(id => q.some(i => prId(i) === id))));
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Could not load open PRs');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  const { jobs, start, error, busy } = useCodeReview(() => { onDone(); loadQueue(); });

  const free = items.filter(i => !generateBusy(jobs[prId(i)]));
  const chosen = items.filter(i => picked.has(prId(i)) && !generateBusy(jobs[prId(i)]));
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allTicked = free.length > 0 && free.every(i => picked.has(prId(i)));
  const run = async () => { await start(chosen.map(i => ({ repo: i.repo, number: i.number }))); setPicked(new Set()); };

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-100">
        <span className="text-gray-400 text-xs">{open ? '▼' : '▶'}</span>
        <span className="text-sm font-semibold text-gray-700">Open PRs without a review ({items.length})</span>
        {busy && <span className="ml-auto text-xs text-blue-700">⏳ working…</span>}
      </button>
      {open && (
        <div className="px-4 pb-3">
          {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
          {loading && items.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
          {!loading && !err && items.length === 0 && <p className="text-xs text-gray-400">Every open PR already has a review.</p>}
          {items.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-2 text-xs">
                <label className="flex items-center gap-1.5 text-gray-600">
                  <input type="checkbox" checked={allTicked} disabled={free.length === 0}
                    onChange={() => setPicked(allTicked ? new Set() : new Set(free.map(prId)))} />
                  Select all
                </label>
                <button onClick={loadQueue} disabled={loading} className="ml-auto text-gray-500 hover:text-gray-800 disabled:opacity-50">↻</button>
              </div>
              <div className="max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                {items.map(i => {
                  const id = prId(i); const j = jobs[id]; const t = jobText(j); const tier = TIER_BADGE[i.tier] || TIER_BADGE.light;
                  return (
                    <label key={id} className={`flex items-start gap-2 px-2 py-1.5 text-xs ${generateBusy(j) ? 'opacity-70' : 'cursor-pointer hover:bg-blue-50'}`}>
                      <input type="checkbox" className="mt-0.5" checked={picked.has(id)} disabled={generateBusy(j)} onChange={() => toggle(id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <a href={i.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="font-semibold text-blue-700 hover:underline">{id}</a>
                          <Badge className={tier.cls} title={`${tier.title} (${i.tierWhy})`}>{tier.label}</Badge>
                          <span className="text-gray-400 ml-auto whitespace-nowrap">{ago(i.updatedAt)}</span>
                        </span>
                        <span className="block text-gray-800 truncate" title={i.title}>{i.title}</span>
                        {t && <span className={`block ${JOB_TONE[t.tone]}`} title={j?.message}>{t.text.slice(0, 110)}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              <button onClick={run} disabled={chosen.length === 0}
                className="mt-2 w-full px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                Initiate Code Review ({chosen.length})
              </button>
              <p className="mt-1.5 text-[11px] text-gray-400">A few reviews run at a time. Each saves a draft here for you to read and post; nothing goes to GitHub until you post it.</p>
              {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const PrReviews: React.FC = () => {
  const [reviews, setReviews] = useState<PrReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('todo');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editingBody, setEditingBody] = useState(false);
  const [bodyText, setBodyText] = useState('');
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [ackSecrets, setAckSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchLog, setBatchLog] = useState<{ id: string; ok: boolean; text: string }[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await reviewsApi.list();
      setReviews(list);
      setSelectedId(prev => (prev && list.some(r => rid(r) === prev) ? prev : null));
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    todo: reviews.filter(r => r.status === 'draft').length,
    posted: reviews.filter(r => r.status === 'posted').length,
    closed: reviews.filter(r => r.status === 'skipped' || r.status === 'stale').length,
  }), [reviews]);

  const shown = useMemo(() => reviews.filter(r =>
    filter === 'all' ? true
      : filter === 'todo' ? r.status === 'draft'
      : filter === 'posted' ? r.status === 'posted'
      : r.status === 'skipped' || r.status === 'stale'), [reviews, filter]);

  const selected = reviews.find(r => rid(r) === selectedId) || null;

  const replace = (updated: PrReview) =>
    setReviews(prev => prev.map(r => (rid(r) === rid(updated) ? { ...updated, current: updated.status === 'draft' ? r.current : null } : r)));

  const select = (r: PrReview) => {
    setSelectedId(rid(r)); setEditingBody(false); setEditingComment(null); setConfirming(false); setAckSecrets(false); setNotice(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try { await fn(); }
    catch (e) { setNotice({ kind: 'err', text: e instanceof ReviewApiError ? e.message : String((e as Error)?.message || e) }); }
    finally { setBusy(false); }
  };

  const saveBody = () => selected && run(async () => {
    replace(await reviewsApi.edit(selected, { body: bodyText }));
    setEditingBody(false);
    setNotice({ kind: 'ok', text: 'Saved. The edited overview is what will be posted.' });
  });

  // The edit API matches line comments by position, so always send one entry per comment.
  const patchComments = (r: PrReview, changes: Record<number, { body?: string; include?: boolean }>) =>
    r.inline.map((_, i) => changes[i] || {});

  const toggleInclude = (i: number) => selected && run(async () => {
    replace(await reviewsApi.edit(selected, { inline: patchComments(selected, { [i]: { include: selected.inline[i].include === false } }) }));
  });

  const saveComment = (i: number) => selected && run(async () => {
    replace(await reviewsApi.edit(selected, { inline: patchComments(selected, { [i]: { body: commentText } }) }));
    setEditingComment(null);
  });

  const skip = () => selected && run(async () => {
    replace(await reviewsApi.skip(selected));
    setNotice({ kind: 'ok', text: 'Skipped. It will not be posted.' });
  });

  const post = () => selected && run(async () => {
    try {
      const updated = await reviewsApi.post(selected, { acknowledgeSecrets: ackSecrets });
      replace(updated);
      setConfirming(false);
      setNotice({ kind: 'ok', text: updated.alreadyOnGitHub ? 'This review was already on GitHub; marked as posted.' : 'Posted to GitHub as a comment review.' });
    } catch (e) {
      load(); // the backend may have marked it stale; show the real state
      throw e;
    }
  });

  // Batch: only current drafts with no secret flag. Flagged ones must be confirmed one by one.
  const batchItems = useMemo(() => reviews.filter(r => canPost(r) && !r.flags.possibleSecrets), [reviews]);
  const heldBack = useMemo(() => reviews.filter(r => r.status === 'draft' && (!canPost(r) || r.flags.possibleSecrets)).length, [reviews]);

  const postAll = async () => {
    setBusy(true);
    setBatchLog([]);
    for (const r of batchItems) {
      try {
        const u = await reviewsApi.post(r);
        replace(u);
        setBatchLog(l => [...(l || []), { id: rid(r), ok: true, text: u.alreadyOnGitHub ? 'already on GitHub' : `posted (${includedCount(r)} line comment${includedCount(r) === 1 ? '' : 's'})` }]);
      } catch (e) {
        setBatchLog(l => [...(l || []), { id: rid(r), ok: false, text: e instanceof ReviewApiError ? e.message : String((e as Error)?.message || e) }]);
      }
    }
    setBusy(false);
    load();
  };

  const copy = async () => {
    if (!selected) return;
    const text = [visibleBody(selected), ...selected.inline.filter(c => c.include !== false).map(c => `\n${c.path}:${c.line}\n${c.body}`)].join('\n');
    try { await navigator.clipboard.writeText(text); setNotice({ kind: 'ok', text: 'Copied the review text.' }); }
    catch { setNotice({ kind: 'err', text: 'Could not copy. Select the text and copy it manually.' }); }
  };

  const editable = selected?.status === 'draft';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 text-sm flex-wrap">
        <span className="font-semibold text-gray-700">PR Reviews</span>
        {([
          ['todo', `To review (${counts.todo})`],
          ['posted', `Posted (${counts.posted})`],
          ['closed', `Skipped / outdated (${counts.closed})`],
          ['all', 'All'],
        ] as [Filter, string][]).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} disabled={loading} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50">↻ Refresh</button>
          <button
            onClick={() => { setBatchLog(null); setBatchOpen(true); }}
            disabled={batchItems.length === 0}
            className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Post all ({batchItems.length})
          </button>
        </div>
      </div>

      {error && <div className="m-3 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error}</div>}

      <div className="flex-1 flex min-h-0">
        {/* List */}
        <div className="w-96 max-w-[40%] border-r border-gray-200 overflow-y-auto bg-white">
          <InitiatePanel onDone={load} />
          {loading && reviews.length === 0 && <p className="p-4 text-sm text-gray-400">Loading…</p>}
          {!loading && shown.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-400">
              <div className="text-3xl mb-2">📝</div>
              {filter === 'todo' ? 'No drafts waiting. Tick open PRs above and press Initiate Code Review.' : 'Nothing here yet.'}
            </div>
          )}
          {shown.map(r => (
            <button key={rid(r)} onClick={() => select(r)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50 ${rid(r) === selectedId ? 'bg-blue-50' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-700">{r.repo}#{r.number}</span>
                <span className="text-xs text-gray-400">{ago(r.generatedAt)}</span>
                <span className="ml-auto flex gap-1">
                  {r.inline.length > 0 && <Badge className="bg-gray-100 text-gray-600" title="Line comments">💬 {r.inline.length}</Badge>}
                  {r.risk && <Badge className={RISK[r.risk]}>{r.risk}</Badge>}
                  {r.status === 'posted' && <Badge className="bg-green-100 text-green-700">posted</Badge>}
                  {r.status === 'skipped' && <Badge className="bg-gray-100 text-gray-500">skipped</Badge>}
                  {isOutdated(r) && <Badge className="bg-amber-100 text-amber-700" title={r.staleReason || 'The PR changed after this draft'}>outdated</Badge>}
                  {r.flags.possibleSecrets && <Badge className="bg-red-100 text-red-700" title={`Redacted: ${r.flags.redacted.join(', ')}`}>check</Badge>}
                </span>
              </div>
              <div className="text-sm text-gray-800 line-clamp-2">{r.title}</div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">Select a review to read it</div>
          ) : (
            <div className="max-w-4xl mx-auto p-5">
              <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold text-gray-900 hover:text-blue-700">
                {selected.title} <span className="text-sm text-gray-400">↗</span>
              </a>
              <div className="text-xs text-gray-500 mt-1">
                {selected.slug}#{selected.number} · by {selected.author || 'unknown'} · commit {selected.headSha.slice(0, 7)} · drafted {ago(selected.generatedAt)}
                {selected.edited ? ' · edited by you' : ''}
              </div>
              <div className="flex gap-1.5 flex-wrap mt-2 mb-3">
                {selected.risk && <Badge className={RISK[selected.risk]}>risk: {selected.risk}</Badge>}
                <Badge className="bg-gray-100 text-gray-600">confidence: {selected.flags.confidence}</Badge>
                {selected.flags.touchesPaymentPaths && <Badge className="bg-purple-100 text-purple-700">touches payment code</Badge>}
                {selected.components.map(c => <Badge key={c} className="bg-blue-50 text-blue-700">{c}</Badge>)}
                {selected.tickets.map(t => <Badge key={t} className="bg-gray-100 text-gray-600">{t}</Badge>)}
              </div>

              {isOutdated(selected) && selected.status !== 'posted' && (
                <div className="mb-3 px-3 py-2 text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded">
                  This draft is outdated{selected.staleReason ? ` (${selected.staleReason})` : ': the PR has new commits or is closed'}. It can't be posted; skip it. A fresh draft is written on the next run.
                </div>
              )}
              {selected.flags.possibleSecrets && selected.status === 'draft' && (
                <div className="mb-3 px-3 py-2 text-sm bg-red-50 text-red-800 border border-red-200 rounded">
                  Something that looked like a secret or card number was found and replaced with [redacted] ({selected.flags.redacted.join(', ')}). Read the text before posting.
                </div>
              )}
              {selected.status === 'posted' && (
                <div className="mb-3 px-3 py-2 text-sm bg-green-50 text-green-800 border border-green-200 rounded">
                  Posted {selected.postedAt ? ago(selected.postedAt) : ''}.{' '}
                  {selected.reviewUrl && <a href={selected.reviewUrl} target="_blank" rel="noopener noreferrer" className="underline">Open on GitHub ↗</a>}
                  {selected.inlineMovedToBody && <span className="block text-xs mt-1">GitHub rejected the line comments (the lines are not in the diff), so they were added to the review text instead.</span>}
                </div>
              )}

              {/* Line comments: the code review */}
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-700">Code review ({selected.inline.length} line comment{selected.inline.length === 1 ? '' : 's'})</h3>
                {editable && selected.inline.length > 0 && <span className="text-xs text-gray-400">untick a comment to leave it out</span>}
              </div>
              {selected.inline.length === 0 && (
                <div className="mb-4 px-4 py-3 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg">
                  No line comments: the review found nothing it could point at in the changed lines. The overview below still has the impact and testing guidance.
                </div>
              )}
              <div className="space-y-3 mb-5">
                {selected.inline.map((c, i) => {
                  const sev = SEVERITY[c.severity] || SEVERITY.note;
                  const on = c.include !== false;
                  return (
                    <div key={i} className={`bg-white border rounded-lg overflow-hidden ${on ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                        {editable && (
                          <input type="checkbox" checked={on} disabled={busy} onChange={() => toggleInclude(i)} title="Include this comment when posting" />
                        )}
                        <code className="text-xs text-blue-700 truncate">{c.path}:{c.startLine ? `${c.startLine}–` : ''}{c.line}{c.side === 'LEFT' ? ' (removed)' : ''}</code>
                        <Badge className={sev.cls}>{sev.label}</Badge>
                        {c.edited && <span className="text-xs text-gray-400">edited</span>}
                        {editable && editingComment !== i && (
                          <button onClick={() => { setEditingComment(i); setCommentText(c.body); }} className="ml-auto text-xs text-gray-500 hover:text-gray-800">Edit</button>
                        )}
                      </div>
                      <div className="p-3 space-y-2">
                        <DiffSnippet c={c} />
                        {editingComment === i ? (
                          <>
                            <textarea value={commentText} onChange={e => setCommentText(e.target.value)} rows={6}
                              className="w-full font-mono text-sm border border-gray-300 rounded p-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <div className="flex gap-2">
                              <button onClick={() => saveComment(i)} disabled={busy || !commentText.trim()} className="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">Save</button>
                              <button onClick={() => setEditingComment(null)} className="px-3 py-1 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">Cancel</button>
                            </div>
                          </>
                        ) : <Md text={c.body} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overview: the summary plus our added context (impact, testing, history) */}
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-700">Overview comment</h3>
                {editable && !editingBody && (
                  <button onClick={() => { setBodyText(visibleBody(selected)); setEditingBody(true); setNotice(null); }} className="text-xs text-gray-500 hover:text-gray-800">Edit</button>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-5">
                {editingBody ? (
                  <>
                    <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} rows={18}
                      className="w-full font-mono text-sm border border-gray-300 rounded p-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="flex gap-2 mt-3">
                      <button onClick={saveBody} disabled={busy || !bodyText.trim()} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">Save</button>
                      <button onClick={() => setEditingBody(false)} className="px-3 py-1.5 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">Cancel</button>
                    </div>
                  </>
                ) : <Md text={visibleBody(selected)} />}
              </div>

              {(selected.internalNotes?.length ?? 0) > 0 && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">Notes for you (not posted)</h4>
                  <ul className="list-disc pl-5 text-sm text-amber-900 space-y-0.5">{selected.internalNotes!.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </div>
              )}

              {selected.related.length > 0 && (
                <div className="mt-3 bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">History this review used</h4>
                  {selected.related.map((r, i) => (
                    <div key={i} className="text-sm py-1 text-gray-700"><span className="font-medium">{r.id}</span> <span className="text-gray-400">({r.kind})</span> — {r.why}</div>
                  ))}
                </div>
              )}

              {notice && (
                <div className={`mt-3 px-3 py-2 text-sm rounded border ${notice.kind === 'ok' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{notice.text}</div>
              )}

              {/* Actions */}
              {selected.status === 'draft' && !editingBody && editingComment === null && (
                <div className="mt-4">
                  {!confirming ? (
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => { setConfirming(true); setAckSecrets(false); setNotice(null); }} disabled={!canPost(selected) || busy}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        Post to GitHub…
                      </button>
                      <button onClick={copy} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">Copy text</button>
                      <button onClick={skip} disabled={busy} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 ml-auto">Skip</button>
                    </div>
                  ) : (
                    <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                      <p className="text-sm text-gray-800">
                        Post the overview and <b>{includedCount(selected)} of {selected.inline.length}</b> line comment{selected.inline.length === 1 ? '' : 's'} as a <b>comment review</b> (not an approval, not a change request) on <b>{selected.slug}#{selected.number}</b> at commit <b>{selected.headSha.slice(0, 7)}</b>, from your GitHub account?
                      </p>
                      {selected.flags.possibleSecrets && (
                        <label className="flex items-center gap-2 mt-3 text-sm text-red-800">
                          <input type="checkbox" checked={ackSecrets} onChange={e => setAckSecrets(e.target.checked)} />
                          I read the text and nothing secret or card-related is left in it.
                        </label>
                      )}
                      <div className="flex gap-2 mt-3">
                        <button onClick={post} disabled={busy || (selected.flags.possibleSecrets && !ackSecrets)}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                          {busy ? 'Posting…' : 'Yes, post it'}
                        </button>
                        <button onClick={() => setConfirming(false)} disabled={busy} className="px-4 py-2 rounded-lg bg-white text-gray-700 text-sm border border-gray-300 hover:bg-gray-50">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selected.status === 'stale' && (
                <div className="mt-4"><span className="text-sm text-gray-500">Outdated drafts are kept for the history and can't be posted.</span></div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Post all */}
      {batchOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6" onClick={() => !busy && setBatchOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-800">Post {batchItems.length} review{batchItems.length === 1 ? '' : 's'} to GitHub?</h3>
              <p className="text-xs text-gray-500 mt-1">Each is a comment review, not an approval or change request, posted from your GitHub account with the line comments you left ticked.{heldBack > 0 ? ` ${heldBack} draft${heldBack === 1 ? ' is' : 's are'} held back (outdated or flagged); open those one by one.` : ''}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 text-sm">
              {batchItems.map(r => {
                const res = batchLog?.find(l => l.id === rid(r));
                return (
                  <div key={rid(r)} className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-b-0">
                    <span className="w-5">{res ? (res.ok ? '✅' : '❌') : busy && batchLog ? '⏳' : '•'}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate">{r.repo}#{r.number} {r.title}</div>
                      <div className="text-xs text-gray-500">{includedCount(r)} of {r.inline.length} line comment{r.inline.length === 1 ? '' : 's'}</div>
                      {res && <div className={`text-xs ${res.ok ? 'text-green-700' : 'text-red-600'}`}>{res.text}</div>}
                    </div>
                  </div>
                );
              })}
              {batchItems.length === 0 && <p className="text-gray-400">Nothing left to post.</p>}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              {batchLog === null && (
                <button onClick={postAll} disabled={busy || batchItems.length === 0} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  Yes, post {batchItems.length}
                </button>
              )}
              <button onClick={() => setBatchOpen(false)} disabled={busy} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200">{batchLog === null ? 'Cancel' : 'Close'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrReviews;
