# One-off review of a PR in any repo (Copilot style)

Use this when the user gives a PR whose repo is **not** in `review.repos` (for example `/pr-review https://github.com/tillster/pos-adapter-aloha-bridge/pull/64`). There is no draft, no PR Reviews tab, no tier and no knowledge-base step. You review in chat, then give the user one command that posts the review. The hard rules in `SKILL.md` still apply (no secrets or card data quoted, changes not people, facts vs inference, nothing internal in the text, advice only).

**Never post it yourself.** Only the user runs the post command. Posting a review is not allowed for you, and `gh api` writes are blocked.

## 1. Fetch (each as one plain command, no pipes, no `cd`)

- `gh pr view <n> --repo <owner>/<repo> --json title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,files,commits,labels`
- `gh pr diff <n> --repo <owner>/<repo>`
- Only for a changed file you need to see whole (callers, null handling, sibling code): `gh api -H "Accept: application/vnd.github.raw" "repos/<owner>/<repo>/contents/<path>?ref=<headRefOid>" --method GET`. A big file is saved to a tool-result file; search it with `grep -n`. Read only the files the diff touches unless a question needs more.

Stop and say so if the PR is closed or merged, or the diff cannot be read. Keep `headRefOid`: the review is pinned to it.

## 2. Line numbers

Comments can only sit on lines shown in the diff. Work out the new-file line number (`side: "RIGHT"`) from each hunk header `@@ -a,b +c,d @@`: the first line of the hunk is line `c`; context lines and `+` lines advance it, `-` lines do not. Deleted lines are `side: "LEFT"` with old-file numbers (start at `a`; context and `-` lines advance it). For a range, `start_line` and `line` must be in the same hunk and on the same side with no gap. A suggestion block replaces exactly the anchored lines, with the same indentation, and only on RIGHT side lines. Check each anchor against the raw file when you have it.

## 3. What to look for

Think like the engineer who is paged if this breaks. For each changed hunk ask what happens on the unhappy path.

1. **Correctness:** wrong conditions, null or missing-key access (a parameter the same file treats as nullable elsewhere), shared state mutated, copy-paste between similar blocks, behavior that no longer matches the title or description.
2. **Failure and edge cases:** timeouts, retries, double submit, partial failure, empty input; kiosks and in-store paths must keep working during a cloud outage.
3. **Security and data:** secrets, card data, guest PII, unescaped input, new third-party hosts, logging of sensitive fields.
4. **Tillster rules where they apply:** money as integer cents, UTC ISO-8601 timestamps, structured logs with a correlation id, queries and cache keys scoped by brand and restaurant, idempotency keys on mutations, new behavior behind a flag with per-brand targeting, dependency changes (flag copyleft licenses), payment, cardholder or auth paths.
5. **Design:** a parameter threaded through many signatures to reach one check (often one decision at the entry point is enough); duplicated conditions; an unrelated change mixed in.
6. **Tests:** a changed branch with no test; **assertions that pass without the fix** (check the setup: a flag or mock can make the asserted thing impossible anyway); loose substring checks on a whole payload; no control case that proves the test can fail.

Do not comment on formatting a linter handles, personal taste or "consider adding a comment". Do not repeat one problem at several lines: anchor it at the first and say "same in lines X and Y". Do not praise. Quality beats count: about **5** line comments for a small PR, at most **10**, most important first. If nothing is worth a comment, say so in the overview.

## 4. Output in chat

Give the review in this order, so it reads like Copilot's:

1. **Overview comment** (what will be posted as the review body): `### Summary` (2 to 3 sentences, overall read), `**Result:** N issues, N suggestions, N questions, N nits.`, `### Impact` (3 to 4 bullets: where it runs, who sees it, scope questions), `### Testing` (only if something is non-obvious; specific flows, not "run the tests"), and a last italic line saying what you read and what you did not (other classes, tests run).
2. **Walkthrough** table: file and what changed (chat only; leave it out of the posted body).
3. **Line comments**, each as `path:line` (or `path:start-end`), starting with its type in bold: **Issue:** (a bug or real risk you can explain), **Suggestion:** (a better way, with a reason), **Question:** (something you cannot tell from the code), **Nit:** (only if it breaks a convention). One point per comment, in this order: what is wrong, the concrete scenario where it bites, the fix. Two to five sentences. Add a ```suggestion block when the fix is a concrete edit.
4. One line on what you could not verify, and that human review is still needed.

Do not mention tools, models, this skill or an AI banner in any text that will be posted.

## 5. Offer the post command, then give it

When the user asks for a command to post it:

1. Copy `templates/make_review.py` to the scratchpad, fill in the repo-specific values (commit id, overview body, comments), and run it with `python3`. It writes `review_<n>.json` next to itself and checks the anchors it can (line positive, `start_line < line`, same side). Building the file in Python avoids hand-escaped JSON.
2. Validate the JSON loads (`python3 -c "import json; json.load(open('<file>'))"`).
3. Give the user **one** command, in its own code block, to run from any folder. They run it, you read the result:

```
gh api repos/<owner>/<repo>/pulls/<n>/reviews --method POST --input <path to review_<n>.json>
```

The review is `event: COMMENT` (never an approval or a change request) and pinned to the head commit you read. Say that it posts under their GitHub account and cannot be undone except by deleting the review on GitHub. If GitHub answers `422`, the message names the bad anchor: fix the line number in the script, rebuild and give the command again. If it succeeds, give the review link from `html_url`.

Give one command per message and wait for the result, as the user prefers.
