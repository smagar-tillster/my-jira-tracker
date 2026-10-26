import express from 'express';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { search } from '../../delivery/lib/jira.mjs';
import { packetFor } from '../../delivery/lib/prpacket.mjs';
import { loadPrLedger } from '../../delivery/lib/prledger.mjs';
import { knownDefectsMarkdown } from '../../delivery/lib/reviewcontext.mjs';
import { loadLedger } from '../../delivery/lib/releases.mjs';
import { tierFromView, reviewTierOf, partitionByTier } from '../../delivery/lib/reviewtier.mjs';
import { generateReview, createJobRunner } from '../../delivery/lib/reviewgen.mjs';
import { relatedPrs, relatedMarkdown } from '../../delivery/lib/prrelated.mjs';
import {
  reviewConfig, listReviews, getReview, prepareDraft, commitDraft, anchorInline, editDraft, markSkipped, postReview,
  relatedReviews, relatedReviewsMarkdown, reviewId,
} from '../../delivery/lib/reviews.mjs';

// PR review drafts. Claude (a scheduled session) reads /reviews/queue and /reviews/packet, then saves a draft with POST /reviews/drafts.
// The user reads the draft in the PR Reviews tab and presses Post, which calls POST /reviews/:repo/:number/:sha/post.
// Nothing here posts to GitHub unless that last, user-confirmed request is made.
const run = promisify(execFile);
const GH_ENV = () => ({ ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` });

/** Runs the GitHub CLI with the user's own login. `input` is written to stdin (used for `gh api --input -`). */
export const realGh = async (args, { input } = {}) => {
  const p = run('gh', args, { maxBuffer: 64 * 1024 * 1024, env: GH_ENV() });
  if (input !== undefined) p.child.stdin.end(input);
  const { stdout } = await p;
  return JSON.parse(stdout || 'null');
};

// ---- same-machine guard for everything that writes: the app has no login, so only the Mac running it may save, edit, skip or post.
const localAddresses = () => {
  const set = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) set.add(i.address);
  return set;
};
const isLocalAddress = (addr) => {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  return localAddresses().has(a);
};

export const sameMachineOnly = (req, res, next) => {
  if (!isLocalAddress(req.socket.remoteAddress)) {
    return res.status(403).json({ success: false, error: 'This action is only allowed from the Mac running My Tracker.' });
  }
  // A page on another website would carry its own Origin; the app itself is served from this machine.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).hostname.replace(/^\[|\]$/g, ''); } catch { /* bad origin header */ }
    if (host !== 'localhost' && !isLocalAddress(host)) {
      return res.status(403).json({ success: false, error: 'Requests from other sites are not allowed.' });
    }
  }
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ success: false, error: 'Send JSON.' });
  }
  next();
};

const fail = (res, r) => res.status(r.status || 500).json({ success: false, error: r.error || (r.errors || []).join('; ') || 'Failed', ...(r.needsAcknowledge ? { needsAcknowledge: true } : {}), ...(r.draft ? { data: r.draft } : {}) });

export const createReviewsRouter = ({ gh = realGh, now = () => Date.now(), claude, helper } = {}) => {
  const router = express.Router();

  // Open PRs per configured repo, cached for a minute (the list view and the bell both ask often).
  let openCache = { at: 0, byKey: new Map(), error: null };
  const openPrs = async (force = false) => {
    if (!force && Date.now() - openCache.at < 60000) return openCache;
    const byKey = new Map(); let error = null;
    for (const [repo, slug] of Object.entries(reviewConfig().repos)) {
      try {
        const list = await gh(['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '100', '--json', 'number,title,url,author,isDraft,headRefOid,updatedAt,baseRefName']);
        for (const p of list || []) byKey.set(`${repo}#${p.number}`, { ...p, repo });
      } catch (e) { error = `${repo}: ${String(e.stderr || e.message).split('\n')[0]}`; }
    }
    openCache = { at: Date.now(), byKey, error };
    return openCache;
  };

  // GET /api/reviews  — all drafts, each marked with whether its PR/head commit is still current
  router.get('/reviews', async (req, res) => {
    const { byKey } = await openPrs().catch(() => ({ byKey: new Map() }));
    const known = byKey.size > 0;
    const data = listReviews().map((r) => {
      const cur = byKey.get(`${r.repo}#${r.number}`);
      const current = r.status !== 'draft' ? null : !known ? null : !!cur && String(cur.headRefOid).startsWith(r.headSha.slice(0, 7));
      return { ...r, current };
    });
    res.json({ success: true, data });
  });

  // GET /api/reviews/summary — counts for the bell
  router.get('/reviews/summary', (req, res) => {
    const counts = { draft: 0, posted: 0, skipped: 0, stale: 0 };
    for (const r of listReviews()) counts[r.status] = (counts[r.status] || 0) + 1;
    res.json({ success: true, data: counts });
  });

  // Review depth per PR head commit, from the file list (cheap, no patches). A failed lookup never drops a PR: it is reviewed as `light`.
  const tierCache = new Map();
  const tierFor = async (p) => {
    const key = `${p.repo}#${p.number}@${p.headRefOid}`;
    if (tierCache.has(key)) return tierCache.get(key);
    try {
      const slug = reviewConfig().repos[p.repo];
      const view = await gh(['pr', 'view', String(p.number), '--repo', slug, '--json', 'files,title,body']);
      const t = tierFromView(view, slug, p.number);
      tierCache.set(key, t);
      return t;
    } catch {
      return { tier: 'light', why: 'could not read the file list' }; // not cached: try again next time
    }
  };

  // GET /api/reviews/queue — PRs that need a review: open, not draft, not a bot, no review saved for the current head commit, and worth
  // reading (tier not in review.skipTiers). Skipped PRs come back under `skipped` with the reason. ?all=1 returns everything in `data`.
  router.get('/reviews/queue', async (req, res) => {
    const { skipAuthors, skipTiers, minAgeMinutes } = reviewConfig();
    const { byKey, error } = await openPrs(true);
    const have = new Set(listReviews().map((r) => reviewId(r.repo, r.number, r.headSha)));
    const candidates = [...byKey.values()]
      .filter((p) => !p.isDraft)
      .filter((p) => !(p.author?.is_bot || skipAuthors.includes(String(p.author?.login || '').toLowerCase())))
      .filter((p) => !have.has(reviewId(p.repo, p.number, p.headRefOid)))
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    // PRs touched within the last minAgeMinutes are still moving; they wait (listed under `settling`). ?all=1 skips the wait.
    const settled = req.query.all === '1' ? candidates : candidates.filter((p) => now() - Date.parse(p.updatedAt) >= minAgeMinutes * 60000);
    const settling = candidates.filter((p) => !settled.includes(p));
    const items = await Promise.all(settled.map(async (p) => {
      const t = await tierFor(p);
      return { repo: p.repo, number: p.number, title: p.title, url: p.url, headSha: p.headRefOid, baseRef: p.baseRefName, author: p.author?.login || '', updatedAt: p.updatedAt, tier: t.tier, tierWhy: t.why };
    }));
    const { keep, skipped } = req.query.all === '1' ? { keep: items, skipped: [] } : partitionByTier(items, skipTiers);
    res.json({
      success: true,
      data: keep,
      skipped: skipped.map((i) => ({ repo: i.repo, number: i.number, title: i.title, url: i.url, why: i.tierWhy })),
      settling: settling.map((p) => ({ repo: p.repo, number: p.number, title: p.title, url: p.url, updatedAt: p.updatedAt })),
      ...(error ? { warning: error } : {}),
    });
  });

  // GET /api/reviews/packet/:repo/:number — everything Claude needs to read the PR, plus history (markdown)
  // The packet as markdown plus the pieces other code needs (used by the packet endpoint and by Initiate Code Review).
  const buildPacket = async (repo, number) => {
    const cfg = reviewConfig();
    const slug = cfg.repos[repo];
    const p = await packetFor({ gh, slug, repo, number, budget: cfg.packetChars, patchLines: cfg.patchLines, lineNumbers: true });
    const head = await gh(['pr', 'view', String(number), '--repo', slug, '--json', 'headRefOid,isDraft,state,title,url,author,baseRefName']);

    const ledgerHits = relatedPrs(loadPrLedger(), { id: `${repo}#${number}`, repo, keys: p.keys, files: p.files });
    const reviewHits = relatedReviews({ repo, number, files: p.files, tickets: p.keys });

    const ticketSummary = (p.md.match(/^### NGK-\d+: (.+)$/m) || [])[1] || '';
    const knownTenants = new Set(Object.values(loadLedger().releases || {}).flatMap((r) => r.tenants || []));
    const defects = await knownDefectsMarkdown({ search, keys: p.keys, title: p.title, ticketSummary, files: p.files, knownTenants, component: cfg.components[repo] || null });

    const rt = reviewTierOf(p);
    const text = [
      `<!-- headSha: ${head.headRefOid} state: ${head.state} draft: ${head.isDraft} tier: ${rt.tier} -->`,
      `Review depth: **${rt.tier}** (${rt.why}; ${rt.lines} lines, ${rt.runtimeLines} runtime)`,
      p.md, '', relatedMarkdown(ledgerHits), relatedReviewsMarkdown(reviewHits), defects,
    ].join('\n');
    return { text, p, head, tier: rt };
  };

  router.get('/reviews/packet/:repo/:number', async (req, res) => {
    const { repo } = req.params;
    const number = Number(req.params.number);
    const cfg = reviewConfig();
    const slug = cfg.repos[repo];
    if (!slug || !Number.isInteger(number) || number <= 0) return res.status(400).json({ success: false, error: 'Unknown repo or PR number' });
    try {
      res.type('text/markdown').send((await buildPacket(repo, number)).text);
    } catch (e) {
      console.error('review packet failed:', e.message);
      res.status(502).json({ success: false, error: `Could not build the packet: ${String(e.stderr || e.message).split('\n')[0].slice(0, 300)}` });
    }
  });

  // The PR's changed files with patches (paged), used to check where inline comments may be placed.
  const prFiles = async (slug, number) => {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await gh(['api', `repos/${slug}/pulls/${number}/files?per_page=100&page=${page}`]);
      all.push(...(batch || []));
      if (!batch || batch.length < 100) break;
    }
    return all;
  };

  // ---- Initiate Code Review: the user picks open PRs, each gets a headless review saved as a draft (never posted).
  const runner = createJobRunner({
    maxParallel: reviewConfig().maxParallel,
    work: ({ repo, number }) => generateReview({ repo, number, gh, buildPacket, prFiles, ...(claude ? { claude } : {}), ...(helper ? { helper } : {}) }),
  });
  router.generateRunner = runner; // tests wait on it

  // POST /api/reviews/generate  {"prs":[{"repo":"kiosk-ui","number":9325}, ...]}
  router.post('/reviews/generate', sameMachineOnly, (req, res) => {
    const cfg = reviewConfig();
    const prs = Array.isArray(req.body?.prs) ? req.body.prs : [];
    if (!prs.length) return res.status(400).json({ success: false, error: 'Send {"prs":[{"repo","number"}]}.' });
    if (prs.length > cfg.maxBatch) return res.status(400).json({ success: false, error: `At most ${cfg.maxBatch} PRs at a time.` });
    const seen = new Set(); const clean = [];
    for (const x of prs) {
      const number = Number(x?.number);
      if (!cfg.repos[x?.repo] || !Number.isInteger(number) || number <= 0) return res.status(400).json({ success: false, error: `${x?.repo}#${x?.number} is not a configured repo and PR number.` });
      if (!seen.has(`${x.repo}#${number}`)) { seen.add(`${x.repo}#${number}`); clean.push({ repo: x.repo, number }); }
    }
    const data = Object.fromEntries(clean.map((c) => [`${c.repo}#${c.number}`, runner.enqueue(`${c.repo}#${c.number}`, c)]));
    res.status(202).json({ success: true, data });
  });

  // GET /api/reviews/generate/status — state per PR: waiting | running | done | exists | queued | failed
  router.get('/reviews/generate/status', (req, res) => {
    const data = runner.status();
    // a PR whose draft now exists is no longer in the open-PR cache's "needs review" list
    if (Object.values(data).some((j) => j.state === 'done')) openCache.at = 0;
    res.json({ success: true, data });
  });

  // POST /api/reviews/drafts — Claude saves a draft. The server validates it, checks every inline comment sits on a line that is
  // really in the diff (and stores the surrounding code for the reviewer), and owns status, event and marker.
  router.post('/reviews/drafts', sameMachineOnly, async (req, res) => {
    const p = prepareDraft(req.body);
    if (!p.ok) return fail(res, p);
    const d = p.draft;
    if (d.inline.length) {
      try {
        const head = await gh(['pr', 'view', String(d.number), '--repo', d.slug, '--json', 'headRefOid,state']);
        if (head.state !== 'OPEN') return res.status(409).json({ success: false, error: `PR is ${String(head.state).toLowerCase()}` });
        if (!String(head.headRefOid).startsWith(d.headSha.slice(0, 7))) {
          return res.status(409).json({ success: false, error: `The PR has a newer commit (${String(head.headRefOid).slice(0, 7)}). Fetch the packet again and review that commit.` });
        }
        const anchored = anchorInline(d.inline, await prFiles(d.slug, d.number));
        if (anchored.errors.length) return res.status(422).json({ success: false, error: 'Some inline comments are not on lines in the diff. Fix them or move them into the body.', errors: anchored.errors });
        d.inline = anchored.inline;
      } catch (e) {
        return res.status(502).json({ success: false, error: `Could not check the inline comments against the PR: ${String(e.stderr || e.message).split('\n')[0].slice(0, 200)}` });
      }
    }
    commitDraft(d);
    res.status(201).json({ success: true, data: d });
  });

  // PUT /api/reviews/:repo/:number/:sha — the user edits the overview and, per inline comment, its text and whether it is included
  router.put('/reviews/:repo/:number/:sha', sameMachineOnly, (req, res) => {
    const r = editDraft(req.params.repo, req.params.number, req.params.sha, { body: req.body?.body, inline: req.body?.inline });
    if (!r.ok) return fail(res, r);
    res.json({ success: true, data: r.draft });
  });

  router.post('/reviews/:repo/:number/:sha/skip', sameMachineOnly, (req, res) => {
    const r = markSkipped(req.params.repo, req.params.number, req.params.sha);
    if (!r.ok) return fail(res, r);
    res.json({ success: true, data: r.draft });
  });

  // POST /api/reviews/:repo/:number/:sha/post — the one action that writes to GitHub. Needs {"confirm": true} from the user's click.
  router.post('/reviews/:repo/:number/:sha/post', sameMachineOnly, async (req, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ success: false, error: 'Posting needs an explicit confirmation ({"confirm": true}).' });
    const r = await postReview({
      repo: req.params.repo, number: req.params.number, sha: req.params.sha, gh,
      dryRun: req.body?.dryRun === true, acknowledgeSecrets: req.body?.acknowledgeSecrets === true,
    });
    if (!r.ok) return fail(res, r);
    openCache.at = 0; // PR now has a review; refresh on next read
    res.json({ success: true, data: r.draft || null, ...(r.dryRun ? { dryRun: true, wouldPost: r.wouldPost } : {}), ...(r.alreadyPosted ? { alreadyPosted: true } : {}) });
  });

  return router;
};

export default createReviewsRouter();
