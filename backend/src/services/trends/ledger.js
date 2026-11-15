// The app's own PR ledger (delivery/lib/prledger.mjs), looked up by ticket. Nothing is fetched: only what the ledger already holds.

/** key -> the latest merged PR in the ledger that names it (its files, title, url, component, tenants). */
export const ledgerIndex = (ledger) => {
  const idx = new Map();
  for (const pr of Object.values(ledger?.prs || {})) {
    for (const key of pr.keys || []) {
      const have = idx.get(key);
      if (!have || String(pr.mergedAt) > String(have.mergedAt)) idx.set(key, pr);
    }
  }
  return idx;
};
