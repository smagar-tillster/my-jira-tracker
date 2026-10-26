---
name: pr-review
description: Review open, non-draft PRs (kiosk-ui first) like a senior engineer and save the review as a draft the user reads and posts from My Tracker. Only meaningful PRs are reviewed (docs, CI, tests, styles, translations and tiny changes are skipped), at a depth that fits the change (light or deep). Comments are anchored to lines with suggested fixes, and checked against known defect patterns when they match. Triggers on the scheduled "PR review drafts" task, or when the user says "/pr-review", "/pr-review kiosk-ui#123", "review the open PRs". Drafts only: never posts to GitHub, approves, or requests changes.
---

# PR review drafts

You read each new or updated PR as a **code reviewer**: find real problems in the changed lines, say exactly where and how to fix them, and anchor each point to the line it is about, the way Copilot's review does. On top of that you add what only we know: the impact on tenants and kiosks, concrete testing guidance, and history from earlier PRs and defects.

You save the result as a **draft** through the My Tracker backend. The user reads it in the **PR Reviews** tab, unticks anything they don't want, and presses Post. You never post anything to GitHub yourself.

## Hard rules

- **Never post to GitHub.** No `gh pr review`, `gh pr comment`, `gh api -X POST`, no approving, no "request changes". Reviews are saved as drafts only; the backend forces `event: COMMENT` and `status: draft` anyway.
- **Only talk to `http://localhost:3050/api/reviews/*`** for the review data. The backend holds the Jira and GitHub credentials. Never read `backend/.env` or any credential file, and never print tokens.
- **No secrets or card data in a review.** If the diff contains something that looks like a secret, key, token, password, card number, CVV or personal data about a guest, describe it ("a hardcoded API key in `src/x.js`") without quoting any of it, and mark that comment `issue`. The server also redacts and flags these, but do not rely on that.
- **Track changes, not people.** History you cite is about files, components, tickets and PRs. Do not compare developers, rank authors, or note who "usually" causes defects.
- **Separate facts from inference.** "The diff shows …" for facts; "this may …" for inference. If you could not verify something, say so. Never invent a cause for an earlier defect: cite it only when the packet history links it (same file or ticket).
- The review is advice. Human review stays required; do not write as if it replaces it.
- **Nothing internal in the posted comment.** The overview and line comments are read by the PR author on GitHub. Do not mention the knowledge base, capability docs, defect pattern ids, docs that need updating, tools, models or this skill, and do not add an "AI-assisted" banner. Internal findings (docs drift, pattern ids, a knowledge base that was unavailable) go in the final chat summary and in the draft's `patterns` and `summary` fields.

## Procedure

1. **Get the work.** If the user named a PR, see *One PR you are given* below. Otherwise `curl -s http://localhost:3050/api/reviews/queue`. Each item has `repo`, `number`, `headSha`, `title`, `url`, `author`, `baseRef`, `tier` (`light` or `deep`) and `tierWhy`. The response also lists `skipped` (docs, CI, tests, styles, translations only, or tiny: do not review) and `settling` (touched in the last 30 minutes, so still being pushed to: they wait for a later run). Count both in the final summary. If `data` is empty, stop and say so in one line. If the call fails, say the backend is unreachable and stop.
2. **For each PR, oldest first** (at most 5 per run; the rest wait for the next run):
   1. **Packet:** `curl -s http://localhost:3050/api/reviews/packet/<repo>/<number>`. It has the PR, its ticket, changed files by kind, the patches **with line numbers**, dependency facts and history. One-line translation changes are listed in a short section without a diff (no anchors there). The first line is `<!-- headSha: ... tier: ... -->`; use that headSha.
   2. **Surrounding code.** For `deep` PRs, read the code around each change in the local clone `~/Documents/git/kiosk/kiosk-ui` (path from `backend/delivery/config.json` `root`; read only when the task prompt names it): `git -C <clone> fetch origin pull/<number>/head`, then `git -C <clone> show FETCH_HEAD:<path>`. Find callers of changed functions, other users of changed config keys, sibling files that must change together (i18n for every locale, tenant overrides, tests). For `light` PRs read only direct callers of what changed, and only if it is cheap. **Do not use `gh api`**: it is blocked in the sandboxed session. If the clone is not available, review from the packet and say so in the overview.
   3. **Knowledge base (`${RAG_ROOT}` is the my-rag checkout, defined in `~/.claude/skills/paths.env`).**
      - **Always:** `${RAG_ROOT}/.venv/bin/python ${RAG_ROOT}/scripts/capabilities_for_files.py --repo kiosk-ui <paths from the packet's "Changed files">`. It is local and free. It prints the capabilities that own the files (shared files like `constants.js` are set aside) and the **defect patterns whose `paths` match**.
      - **If a pattern matched:** `query_data` with `@datafeed defect: <pattern ids and the PR's area words>`. Treat each matched pattern as a **mandatory check**: say whether the PR meets it, in plain words (no ids in the comment). If the check needs something you cannot read (for example `kiosk-configuration`), say what to look at; never claim a check passed that you could not run.
      - **`light` with no pattern matched:** stop here. No searches.
      - **`deep`:** also follow *Knowledge base, beyond the helper* in `references/deep-review.md`.
      - List the pattern ids you applied in `patterns` in the draft, never in the comment text.
   4. **Review the code.** `deep`: read `references/deep-review.md` first. `light`: see *Light reviews* below.
   5. **Write the draft** (formats below) and **save it**.
3. **Finish** with one line per PR: `kiosk-ui#123 — draft saved (deep): 2 issues, 3 suggestions, 1 question (risk medium)` or `skipped: <reason>`, then `Skipped by rules: N (kiosk-ui#120 docs only, …)` and `Waiting (recently updated): N`, then any internal notes: `Docs to update: …`, `RAG unavailable`, patterns applied. Do not paste review text into the summary.

## One PR you are given

When the user runs `/pr-review kiosk-ui#123` (or pastes a github.com PR URL), skip the queue: take the repo and number, fetch the packet, use its `headSha` and the tier on its first line, and run steps 2.1 to 2.5 for that PR only. The repo must be one of `review.repos` in `backend/delivery/config.json` (kiosk-ui today); otherwise say it is not configured. A PR the rules would skip, or one still settling, is reviewed anyway when the user asks, at `light` depth. If a draft for that head commit already exists (`409`), tell the user to open it in the PR Reviews tab.

If a PR cannot be reviewed (packet fails, diff unreadable), skip it and say why; do not save an empty or guessed draft.

## Light reviews

An ordinary change. Think like the engineer who will be paged if this breaks: for each changed hunk ask what happens on the unhappy path. Keep to:
- **Correctness:** wrong conditions, null or missing-key access, shared state mutated, behavior that no longer matches the PR's description.
- **Security and data:** secrets, card data, guest PII, unescaped HTML, new third-party hosts.
- **Tillster rules that apply:** money in integer cents, new behavior behind a flag, payment paths (set `flags.touchesPaymentPaths`), dependency changes.
- **Matched defect patterns.**

At most **4** line comments, an overview of about **100 words**, and no Testing section unless something is non-obvious. Save `tier: "light"`. No formatting or taste comments; no praise; an empty review with an honest overview beats an invented finding.

## Writing a line comment (`inline[]`)

- Anchor to the exact line the point is about, using the numbers in the packet: `R<n>` lines are `side: "RIGHT"` (new file; added or unchanged lines), `L<n>` lines are `side: "LEFT"` (deleted lines). **Only lines shown in the packet can take a comment.** The server checks every anchor against the real diff and returns `422` listing the valid lines if one is wrong.
- For a range, set `startLine` (first line) and `line` (last line), both in the same hunk and on the same side.
- Start the text with its type in bold, and set `severity` to match: **Issue:** (a bug or real risk you can explain), **Suggestion:** (a better way, with a reason), **Question:** (something you cannot tell from the diff and the author should confirm), **Nit:** (only if it breaks a repo convention).
- One point per comment, in this order: what is wrong, the concrete scenario where it bites, the fix. Two to five sentences.
- When the fix is a concrete edit, include a GitHub suggestion block. Its content replaces exactly the anchored lines (`startLine`–`line`; just `line` for a single line), with the same indentation. Only on `RIGHT` side lines.

````
**Issue:** `scope.$on('refresh', …)` is registered in `link` but never removed. The kiosk stays up for days, so every screen visit adds another listener and the handler runs N times per event.

```suggestion
        const off = scope.$on('refresh', handler);
        scope.$on('$destroy', off);
```
````

## The overview comment (`body`)

**Concise** (`light` about 100 words, `deep` 120–150). It is what the dev reads first; the code review itself is in the line comments, so do not restate the diff or repeat them. Exactly these parts:

```
### Summary
<2–3 sentences: what the PR does and your overall read. Work the history in here when it matters, e.g. "This screen was last changed in kiosk-ui#9102 (NGK-99001).">

**Result:** N issues, N suggestions, N questions.

### Impact
- <where it runs and who sees it: flows, tenants/brands or config touched, devices; 3–4 bullets at most>
- **Known defects:** NGK-1234 — <why it is related, one line>. (Max 3; omit the line if none is clearly related.)
- **Checks:** <what a matched defect pattern asks, in plain words, and whether the PR meets it, for example "tenant overrides of this key in `kiosk-configuration` were not checked">. (Only for patterns that matched this PR; max 3; omit if none. No pattern ids and no mention of the knowledge base.)

### Testing
<Only if there is something non-obvious worth testing: 1–3 specific bullets. Omit this section entirely for trivial or mechanical changes.>
```

- **Summary + history:** use the packet's "Related earlier PRs" and "Earlier reviews" only when they bear on this change. One clause each, with the PR or ticket id.
- **Known defects:** the packet's candidates are candidates, not facts. Cite one only when it is clearly about the same flow, tenant or files, say how it relates, and never write that this PR or an earlier PR caused it. Leave the line out if none is clearly related.
- **Testing:** specific to this change (a flow, a tenant, a locale, an offline case). No generic advice like "run the tests".
- If you could not read the surrounding code, add `_Reviewed from the diff only._` at the end of the Result line. If part of a file was cut from the packet, say which lines you did not cover.
- Leave a blank line between paragraphs and before the Result line, so it renders the same on GitHub and in the app.

## Saving the draft

Write the JSON to a file in the scratchpad (use the Write tool), then:

```
curl -s -X POST http://localhost:3050/api/reviews/drafts -H 'Content-Type: application/json' --data @<file>
```

```json
{
  "repo": "kiosk-ui",
  "number": 123,
  "headSha": "<full sha from the packet>",
  "baseRef": "master",
  "title": "<PR title>",
  "url": "<PR url>",
  "author": "<login>",
  "model": "<the model you are running as>",
  "body": "<the overview markdown>",
  "inline": [
    { "path": "src/app/x.js", "line": 42, "side": "RIGHT", "severity": "issue", "body": "**Issue:** …" },
    { "path": "src/app/y.js", "startLine": 10, "line": 12, "side": "RIGHT", "severity": "suggestion", "body": "**Suggestion:** …\n\n```suggestion\n…\n```" }
  ],
  "summary": { "changes": "…", "impact": "…", "risks": "…", "tests": "…" },
  "risk": "low | medium | high",
  "tier": "light | deep",
  "patterns": ["shared-promotion-config-blast-radius"],
  "components": ["FE", "Menu"],
  "files": ["src/app/x.js"],
  "tickets": ["NGK-12345"],
  "flags": { "touchesPaymentPaths": false, "confidence": "low | medium | high" },
  "related": [{ "id": "kiosk-ui#101", "kind": "pr", "why": "same file; caused NGK-… earlier" }]
}
```

- `tier` is the depth you used and `patterns` the defect pattern ids you applied; both feed later learning, such as which patterns keep firing.
- `summary`, `risk`, `components`, `files`, `tickets` and `related` are the **memory**: later reviews use them to say "this changed before". Fill them in properly even though they are not shown on GitHub. `files` is every non-trivial file the PR changes (not lockfiles or images).
- `risk` is your honest rating of the chance this causes a defect or an outage: `high` for payment paths, shared state, broad config, or untested behavior changes; `low` for copy, styles or tests only. `confidence` reflects how much surrounding code and history you could actually read.
- Responses: `201` saved. `422` lists the inline comments that are not on lines in the diff, with the valid lines: correct them and retry once; if it still fails, move that point into the overview. `409` means a review for that commit is already posted or skipped (leave it), or the PR has a newer commit (fetch the packet again). `400` lists what to fix.
- A new push gives a new `headSha`, so the next run writes a fresh draft and the old one shows as outdated. Drafts live in `backend/data/delivery/reviews/` (git-ignored) and later reviews read them through the packet's "Earlier reviews" section.
