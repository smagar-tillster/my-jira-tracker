// Retrieval step ("local RAG") for PR analysis: before an AI reads a PR, pull the most relevant earlier PRs from the PR ledger
// (same ticket, or the same files in the same repo) together with what was already understood and confirmed about them.
// Rules only (scored overlap, no embeddings). The result is appended to the PR packet as context, never as facts about this PR.
const TRIVIAL = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.(png|jpe?g|gif|svg|webp|ico|woff2?)$)/i;

export const relatedPrs = (ledger, { id, repo, keys = [], files = [] }, max = 3) => {
  const mine = new Set(files.map((f) => f.name || f).filter((n) => !TRIVIAL.test(n)));
  const scored = [];
  for (const r of Object.values(ledger.prs || {})) {
    if (r.id === id || !r.analysis || r.analysis.ai === false) continue;
    let score = 0; const why = [];
    const sharedKeys = keys.filter((k) => (r.keys || []).includes(k));
    if (sharedKeys.length) { score += 5; why.push(`same ticket ${sharedKeys.join(', ')}`); }
    if (r.repo === repo) {
      const shared = (r.files || []).map((f) => f.name).filter((n) => mine.has(n));
      if (shared.length) { score += Math.min(4, shared.length * 2); why.push(`same file${shared.length > 1 ? 's' : ''}: ${shared.slice(0, 2).join(', ')}`); }
    }
    if (score >= 2) scored.push({ r, score, why: why.join('; ') });
  }
  return scored.sort((x, y) => y.score - x.score || String(y.r.mergedAt).localeCompare(String(x.r.mergedAt))).slice(0, max);
};

export const relatedMarkdown = (hits) => {
  if (!hits.length) return '## Related earlier PRs (from the PR ledger)\nNone found by ticket or shared files.\n';
  return ['## Related earlier PRs (from the PR ledger; context only, not facts about this PR)',
    ...hits.map(({ r, why }) => `- ${r.repo}#${r.number} (${String(r.mergedAt).slice(0, 10)}, ${why}) risk ${r.analysis.risk}: ${r.analysis.summary}${(r.analysis.confirm || [])[0] ? ` Earlier open question: ${r.analysis.confirm[0]}` : ''}`), ''].join('\n');
};
