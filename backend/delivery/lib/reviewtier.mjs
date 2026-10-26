// Which PRs deserve a review, and how deep. Rules only (no AI); thresholds come from config.json "analysis" via triage.tierOf.
//   skip   (triage "simple")    tiny, or only CI/docs/tests/styles/translations: no review; the queue lists it under `skipped`
//   light  (triage "standard")  ordinary change: a short review of what matters
//   deep   (triage "complex")   sensitive path, large, references other PRs, or a major dependency change: the full review
import { tierOf, analysisConfig } from './triage.mjs';
import { refsIn } from './prdeps.mjs';

export const REVIEW_TIER = { simple: 'skip', standard: 'light', complex: 'deep' };
export const TIERS = ['skip', 'light', 'deep'];

/** p: { files: [{name, add, del, kind?}], bumps: [], refs: [] } -> { tier, why, lines, runtimeLines } */
export const reviewTierOf = (p, A = analysisConfig()) => {
  const t = tierOf(p, A);
  return { tier: REVIEW_TIER[t.tier] || 'light', why: t.why, lines: t.lines, runtimeLines: t.runtimeLines };
};

/**
 * Tier from `gh pr view --json files,title,body` (no patches). Version bumps are not detected without patches, so a PR that only
 * bumps a dependency lands in `light` here; the packet endpoint sees the patches and tiers it exactly.
 */
export const tierFromView = (view, slug, number, A) => reviewTierOf({
  files: (view?.files || []).map((f) => ({ name: f.path, add: f.additions || 0, del: f.deletions || 0 })),
  bumps: [],
  refs: refsIn(`${view?.title || ''}\n${view?.body || ''}`, slug, number),
}, A);

/** Splits queue items (each with a `tier`) into the ones to review and the ones to skip. */
export const partitionByTier = (items, skipTiers = ['skip']) => {
  const keep = []; const skipped = [];
  for (const it of items) (skipTiers.includes(it.tier) ? skipped : keep).push(it);
  return { keep, skipped };
};
