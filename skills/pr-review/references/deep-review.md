# Deep reviews: what to look for, and the extra knowledge-base steps

Read this only for `deep` PRs. A `light` review does not need it.

## What to look for, in this order

1. **Correctness:** wrong conditions, off-by-one, null/undefined or missing-key access, wrong operator, mutated shared state, copy-paste errors between similar blocks, behavior that no longer matches the PR's own description.
2. **Failure and edge cases:** empty, slow or failing network; double-tap or double-submit; timeouts and retries; error states the user can actually see; what happens offline (kiosks must keep taking orders during a cloud outage, so a new hard dependency on a cloud call in an in-store path is an issue).
3. **kiosk-ui specifics (AngularJS 1.6, runs for days without a reload):** listeners, `$on`, `$watch`, `$interval`/`$timeout` and DOM handlers not cleaned up on `$destroy` (memory growth); work outside the digest cycle; scope pollution; per-tenant config and override keys that exist for some tenants but not others; strings added without every locale; hardcoded text, currency or date formats; accessibility (screen reader, focus, touch target size).
4. **Security and data:** secrets, tokens, card data or guest PII in code, logs or fixtures; unescaped HTML; URLs or scripts loaded from new third-party hosts.
5. **Tillster rules, only where they apply:** money as floating point (integer cents); timestamps not UTC ISO-8601; logging without a correlation id or not structured; queries or cache keys not scoped by brand and restaurant; mutations without an idempotency key; new behavior without a LaunchDarkly flag with per-brand targeting; dependencies added, upgraded or removed without mention (flag copyleft licenses); changes under payment, cardholder, auth, token or encryption paths (set `flags.touchesPaymentPaths`).
6. **Tests:** changed branches with no test, tests that cannot fail, snapshots that hide the behavior.

**Do not** comment on formatting a linter handles, personal taste, or "consider adding a comment". Do not repeat one problem at several lines: anchor it at the first and say "same in lines X and Y". Do not praise. Quality beats count: **at most 10 line comments**, most important first. If you find nothing worth a line comment, save zero and say so in the overview. A review with invented findings is worse than a short one.

Overview length for a deep review: about 120 to 150 words.

## Knowledge base, beyond the helper

The helper (`capabilities_for_files.py`) and any matched defect patterns are already covered in the main procedure. For a deep review also:

1. **Capability maps.** For the top 3 capabilities the helper returned, `query_data` with `@datafeed capability map: <capability>`. It lists what else must change together (backend endpoints, config keys, other repos) and what is not verified.
2. **Defect search.** `@datafeed defect: <capability names and the PR's area words>`, even if no pattern matched by path.
3. **Docs drift.** If the PR changes behavior, config keys or endpoints that a capability doc describes, note it for the final chat summary (`Docs to update: <doc> (<what>)`). Do not put it in the draft: it is internal.

Use only what the tools returned. `status: partial` and "not verified" are gaps, not facts. Never paste raw store or guest data. If the knowledge base is unavailable, continue and say `RAG unavailable` in the final chat summary, not in the draft.
