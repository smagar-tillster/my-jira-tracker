---
name: ngk-sprint
description: NGK sprint work for the FE team. Triggers when the user says "/ngk-sprint", "daily Jira", "sprint cleanup", "plan by tenant", "my urgent tickets", "groom NGK-123", "focus on ...", "what happened on <focus item>", "weekly status", "defects report", "sprint report", "tenants without client", "past due tickets", or asks what was released / what PRs merged. Scripts do the data work; AI is used only for judgment calls and engineering plans.
---

# NGK Sprint

Nine tracks. Scripts fetch, classify, group and update; AI only reviews the output with the user, decides what "old and pointless" means when asked, and writes engineering approaches. Everything is a discussion: show a report, take direction, build an ops file, dry-run it, apply on confirmation.

> **Paths** (my-jira-tracker repo, `~/Documents/git/projects/my-jira-tracker`): scripts, libs and `config.json` live in `backend/delivery/` (`${DELIVERY_DIR}`). Everything they generate (`.cache/`, `releases/`, `prs/`, `pr-analysis/`, `state/`) goes to `backend/data/delivery/` (`${DATA_DIR}`, git-ignored); relative data paths below are relative to it. Scripts need the user's Jira credentials (`backend/.env`, never print them) and `gh` login, so run them with `run_in_terminal` (reuse and close finished tabs). Node 18+, no npm install.
> **Read-only by default.** Only `apply.mjs --apply` writes to Jira (or the My Tracker star), and only after the user confirms the dry run.

## Menu (show this whenever the user gives no other context)

If `/ngk-sprint` comes with no request, **print this menu as plain numbered text (do not use a question tool), run nothing, and wait for a number or a request**:

```
1. How is the sprint?
   - Tasks marked important: 2-line update for each important tenant
   - Tasks set for release but not ready
   - Past due tickets
   - My urgent tickets
2. Let's plan: tickets grouped by tenant, with comments; releases grouped together
3. Let's clean
   - Tickets without a client
   - Tickets without a due date
   - Long-pending clean-up suggestions
4. Let's groom: I'll ask which ticket
5. Focus
   - Tasks marked important: 2-line update for each important tenant
   - My urgent tickets
6. Release and PR: only when asked ("what was released for X this week")
```
(Weekly report, defects report and sprint report are not in the menu; they run when asked by name.) If the user already named something (a number, "cleanup", "plan BK-DE", "groom NGK-123"), go straight in. Never load or report before knowing what they want.

**How each option runs** (state the defaults in one line, ask no scope questions):
1. **How is the sprint?** Run `snapshot.mjs`, then: (a) `focus.mjs show all` and condense it to **two lines per important tenant** (line 1: where we are, the latest real movement; line 2: the main risk or blocker and the next action; keys linked), grouping the focus items by tenant; (b) `release-watch.mjs` (tickets with a release date today or earlier, or within 3 days, that are not Ready for QA or done, grouped by release); (c) past-due tickets: the "Past due" section of `cleanup.mjs`; (d) `mine.mjs`. Show (a) as the two-liners, then (b)-(d) as tables. Lead with a 3-line headline.
2. **Let's plan**: `snapshot.mjs`, then `plan.mjs [--tenant X]`: per tenant, tickets grouped by release date (tickets that ship together), each with its latest comment. The user then moves dates or changes fields through the Update flow.
3. **Let's clean**: `snapshot.mjs`, then `cleanup.mjs` and show only: (a) no client (with suggested clients), (b) no UAT and no due date (ask per tenant, never guess dates), (c) long-pending clean-up suggestions: the stale section plus `carryover.mjs --not-ready` (and `carryover.mjs` for ready-but-stuck ones). Apply through the Update flow (dry run first).
4. **Let's groom**: ask for the ticket key if the discussion hasn't named one, then track 4.
5. **Focus**: `focus.mjs show all` condensed to **two lines per important tenant** (same format as 1a), then `mine.mjs`.
6. **Release and PR**: ask what they want (tenant, ticket, period), then track 1.

## Reference: the tracks and their scripts

| Track | Say | Script |
|---|---|---|
| 1. Release & PR info (only when asked) | "what was released for BK-ES last week", "what merged this week", "analyze today's PRs" | `changes.mjs`, `releases.mjs`, `pr-packet.mjs` |
| 2. Data cleanup | "cleanup" | `snapshot.mjs`, `cleanup.mjs`, `apply.mjs` |
| 3. Plan by tenant | "plan BK-DE" | `snapshot.mjs`, `plan.mjs` |
| 4. Groom a ticket | "groom NGK-123" | `groom-context.mjs` |
| 5. My urgent tickets | "my tickets" | `mine.mjs` |
| 6. Sprint focus | "focus on PC-SV fiscal flow", "update on <focus>" | `focus.mjs` |
| 7. Weekly status (manager to lead) | "weekly status", "last week's status" | `weekly.mjs` |
| 8. Weekly defects report | "defects report", "defect trend" | `defects.mjs` |
| 9. Sprint report (for project/product management) | "sprint report", "report for sprint 226" | `sprint-report.mjs` |

Also: **flag / unflag** (`flag.mjs add|remove KEYS`, the My Tracker stars; confirm the keys back in one line).

**Defaults (do not ask scope questions):** current active sprint(s) with name prefix `NGK Sprint`; active (not done) tickets; component `FE`; excluded types Release, Content Change Request, Coupon Change Request, Sub-task; FE-member filter off. Change one only when the prompt says so: "future sprint"/"wide" -> `--include-future`, "future only" -> `--future-only`, a specific sprint/tenant -> `--jql`, "all components" -> `--component any`, "include done" -> `--include-done`.

### 1. Release & PR info (only when asked)
- The **My Tracker app** has the Release & PRs tab (Released, To Release Today, Merged PRs, Open PRs). The user runs "Run latest report" there; nothing is scheduled. After a run there is nothing to open or serve.
- **History questions** read the local ledgers only (no Jira):
  - `node ${DELIVERY_DIR}/scripts/changes.mjs --since 3d [--tenant X] [--repo X] [--ticket NGK-1] [--text word] [--what all|prs|releases] [--format table|full|json]` for merged PRs + releases ("what changed for BK-DE since Monday", "follow NGK-102178"). Mention the coverage note it prints if the span starts before the ledger does.
  - `node ${DELIVERY_DIR}/scripts/releases.mjs --tenant BK-ES --since 7d` (filters `--tenant`, `--since`, `--until`, `--on`, `--status released|open`, `--component`, `--ticket`, `--version`, `--text`; `--format table|full|json|html`; `--stats`). "Released" means the release ticket's Jira status is done and can lag reality; say so. If the ledger does not reach back far enough, have the user run `node ${DELIVERY_DIR}/scripts/releases-sync.mjs --days N`.
- **Data refresh from Claude Code** (when the user asks): `node ${DELIVERY_DIR}/scripts/daily.mjs` rebuilds `.cache/data/delivery.json` and the ledgers (moves the since-last-run marker; `--rerender` keeps it; `--since "YYYY-MM-DD HH:MM"`; `--date` is a historical view; `--html` also writes the old HTML page).
- **PR analysis**: PRs are triaged by rules (`lib/triage.mjs`, thresholds in `config.json` "analysis"): *simple* (tiny, CI/docs/tests/styles/translations only, or a version bump only) get a rules-only entry automatically; *standard* get nothing unless asked; *complex* (references other PRs, sensitive path, >400 runtime lines, >15 files, major/new/removed dependency) are "AI recommended". AI runs only on request: the app's "Analyze with AI" button runs `scripts/analyze-pr.mjs` (haiku through the user's `claude` CLI login; if the CLI is unusable it saves `pr-analysis/requests/<repo>__<n>.json`, shown as "Queued for Claude"). To analyze from a session ("analyze today's PRs", "analyze requested PRs"): run `pr-packet.mjs --missing` or `--repo R --pr N` (adds related earlier PRs as context), have a haiku subagent (Agent tool, `model: "haiku"`) read each packet and write `${DATA_DIR}/pr-analysis/<repo>__<n>.json` with `repo, number, ticket, generatedAt, ai:true, basis, risk (low|medium|high), summary, how[], dependencies[], confirm[]`, base every statement on the packet, put uncertainty in `confirm`, delete the request file, then re-run `daily.mjs --rerender`.
- For the RAG data feed, `--rag-dir <datafeeds folder>` copies the markdown (`ngk-prs`, `ngk-releases`); only once the user has given the path.

### 2. Data cleanup
1. Load: `node ${DELIVERY_DIR}/scripts/snapshot.mjs`; report the counts it prints (loaded -> sprint filter -> types -> FE) and the sprint names.
2. `node ${DELIVERY_DIR}/scripts/cleanup.mjs [--stale-days 60]`, four sections:
   - **No client** + suggested client (rule-based, with confidence). User says "update 1,3,5" or "update all high".
   - **Old / stale** candidates: for those picked, draft a short closing note from the table's facts (never invent reasons), then close.
   - **No UAT and no due**: ask per tenant (date, close, move out of sprint); never guess dates.
   - **Past due**: same, per-tenant direction.
   - **Carried over many sprints** (not in cleanup.mjs): `node ${DELIVERY_DIR}/scripts/carryover.mjs [--min-sprints 4]` lists tickets that sat in N+ sprints and are Ready for QA / In QA (candidates to release or close); add `--not-ready` for the opposite (many sprints and still not ready: long-running, blocked, unassigned, never started). Reads the snapshot, so run `snapshot.mjs --component any` first.
   - **Ad hoc lookup** ("find sprint tickets with client X, all components"): `node ${DELIVERY_DIR}/scripts/find.mjs --client Tillster-Kiosk [--component FE] [--text word] [--status ..] [--assignee ..] [--include-future] [--include-done]`. Defaults: active sprint, ALL components, active tickets. It does not touch the cleanup snapshot.
3. **Update** (also used by Plan and Groom): write the decisions to an ops file `.cache/ops-<date>.json` (format in the header of `scripts/apply.mjs`), run `node ${DELIVERY_DIR}/scripts/apply.mjs <ops.json>` (dry run), show it, ask "apply?", on yes rerun with `--apply`, then rerun `snapshot.mjs`. Supports client, due, UAT, labels, raw fields, comment, close (transition + resolution), ★ flag.

### 3. Plan by tenant
`node ${DELIVERY_DIR}/scripts/plan.mjs [--tenant BK-DE]`: grouped by client with Ticket, Description, Component, UAT, Release, Due, Status, ★. The user then asks to move dates, change fields or flag; use the Update flow above.

### 4. Groom a ticket (needs a key; ask only if missing)
`node ${DELIVERY_DIR}/scripts/groom-context.mjs <KEY>` gathers fields, description, comments, links, subtasks and recent same-client tickets. Then read the relevant repo code (use datafeed-rag or the `foreman` / `plan-dev-task` skills for routing), write an engineering approach (scope, files, risks, test plan, flags, open questions), show it, and on approval post it as a `comment` op via `apply.mjs`. Per Tillster rules: new behavior behind a LaunchDarkly flag with per-brand targeting; no hard cloud dependency on kiosk paths.

### 5. My urgent tickets
`node ${DELIVERY_DIR}/scripts/mine.mjs [--sprint-only] [--save]`: risk-sorted (OVERDUE / URGENT / SOON / NO DATE). Add `--save` when cleanup or plan should run on just these.

### 6. Sprint focus (remember what matters this sprint)
The user says what is important; remember it, line up the related tickets, and show what happened last so they can act. Rules only, read-only for Jira, no AI unless the user asks for a summary.
- **Remember:** `node ${DELIVERY_DIR}/scripts/focus.mjs add "PC-SV fiscal flow" [--keys NGK-1,NGK-2] [--tenant PC-SV] [--text fiscal,NIT] [--why "go-live blocker"]`. Also `add-keys <name> KEYS`, `set <name> --tenant/--text/--why`, `note <name> "text"`, `drop <name>`, `restore <name>`, `list [--all]`. Turn "remember X is important" into `add` with whatever the user gave (keys, tenant, words); ask only if nothing identifies it.
- **Update:** `node ${DELIVERY_DIR}/scripts/focus.mjs show <name|all> [--stale-days 5]` prints: what happened last (newest events first: status changes, assignments, due changes, comments), the line-up (seed tickets, sprint tickets matching tenant AND text, links/parent/subtasks), PRs and releases on those tickets, and an **Act on** list from rules (blocked, waiting on client N days, overdue/due soon, quiet N days, open PR without review). Present the tables, then offer the follow-ups (update dates, post a nudge comment) through the Update flow.
- **Where it is stored:** a JSON file (not the app). Default `backend/data/delivery/focus.json`; to share between machines point it at a OneDrive file with `focus.mjs where --set "<path>/ngk-focus.json"` (writes `focus-path.txt` on this machine) or the `NGK_FOCUS_FILE` environment variable. `focus.mjs where` shows the file in use. Only the user names the path.
- At a new sprint, ask once whether to carry the focus items over.

### 7. Weekly report (engineering manager to a VP: a summarized status, no ticket numbers in the text)
**Audience and tone:** the report is from an engineering manager to a **VP**. It must read as a status summary in plain business language: what is done, what is at risk, what is blocked and what is next. **No NGK numbers in the body**; ticket numbers and Jira links go only in a "Reference: tickets by tenant" list at the bottom. Describe work by what it is (for example "loyalty sign-up flow", "receipt for the new tenant"), not by ticket id. Keep it short: a summary paragraph, then the tenants, then the overall numbers, defects, and the reference list.
`node ${DELIVERY_DIR}/scripts/weekly.mjs build [--week 2026-W44]` gathers the **important tasks** (your focus items plus tickets starred in My Tracker) and groups them **by tenant** (a focus item naming one tenant wins, else the ticket's first client). The report has three parts: (1) **Important tasks by tenant**: for each tenant the ask (focus areas, why, key open work), where we are (this week's updates: status changes, comments, due changes), risks and blockers (rule flags: blocked, waiting on client, overdue, quiet, PRs stuck in review), and completed vs pending tickets (this week's completions, then the pending list with status), with a red/amber/green; (2) **Overall tickets**: completed vs pending for the important tasks and for the current sprint (Story, Feature Change Request and Product Assistance Request worked in the sprint, same counting as the sprint report); (3) a short **Defects** comment (it also refreshes the defects report for the week). It saves `weekly/<week>.json` + `.md` in the reports folder (next to the focus file, OneDrive when shared). **Polish with AI:** read the draft and rewrite it as a VP-ready summary: (a) a 3-4 sentence **Summary** with the overall status and the top concerns; (b) **Important tasks by tenant**: per tenant the ask, where we are, risks and blockers as you understand them, and what is completed and pending, in one short paragraph or 3-4 bullets with a red/amber/green marker (tenants with nothing at risk can share a line); (c) **Overall tickets** (completed vs pending, important tasks and current sprint) and a short **Defects** comment; (d) **Reference: tickets by tenant** at the bottom, the only place with NGK numbers and links (each key linked). Use only facts in the draft, no invented causes or dates; then save with `weekly.mjs narrative <week> --file <path>`. Query later: `weekly.mjs show [--week W | --last N]`, `list`, `history "<tenant>" --weeks 6`. The Friday 3 PM scheduled task builds and polishes it (see below).

### 8. Weekly defects report (simple: four parts)
`node ${DELIVERY_DIR}/scripts/defects.mjs build [--week W]` reads all NGK **Defect** tickets (created, resolved or open in the last 12 weeks, all components), saves the full data in `defects/<week>.json`, and renders a deliberately short `.md` with exactly four parts: (1) the number of new defects this week with a one-sentence note on the top impacted tenants, (2) defect patterns with count and impacted tenants (rule-based categories in `lib/defects.mjs`, tunable in `config.json` "defects.categories"; check with `defects.mjs categories [--uncategorized]`), (3) a resolution plan for the top pattern (fix now with ticket links, prevent, measure), (4) the last 4 weeks as a simple text chart with one sentence on direction. The json also keeps the 12-week trend, tenants, components, age and rule-based recommendations for questions. **Polish with AI** keeping exactly those four parts (tighter wording; numbers and links unchanged) and save with `defects.mjs narrative <week> --file <path>`. Query: `defects.mjs show [--week W | --last N]`, `list`.

### 9. Sprint report (for project and product management)
`node ${DELIVERY_DIR}/scripts/sprint-report.mjs build [--sprint current|last|227]` reads the sprint from Jira and saves a data source `sprints/sprint-<n>.json` + `.md` (any sprint can be rebuilt). The report is deliberately short, two parts: (1) **Overall**: tickets in the sprint, completed (Done or Ready for QA), in progress, blocked / waiting (and not started, so it adds up), each with a share bar; (2) **Top stories by tenant** with status and done count (stories are grouped under their parent epic; status Done / In progress / At risk / Not started). **Smaller items are left out**: a story is "top" only if it sits under an epic, has 3+ tickets, is starred in My Tracker or has a UAT date; single loose tickets are listed only as a count in the footer. **Counting rules (the user's):** only Story, Feature Change Request and Product Assistance Request count in the stats, only tickets **worked in the sprint** (a status change, a resolution or creation inside the sprint window) count, and the top stories come from Story and Feature Change Request. Other types (New Sub-Brand Request, Epic, Defect, Task, Spike...) are out unless added to `types` in the sprint config. **Configure per sprint** (`sprint-<n>.config.json` in the same folder; only overrides are stored, edits survive rebuilds): `add --sprint N KEYS` / `exclude --sprint N KEYS`, `set --sprint N --feature "<id>" [--top | --small] [--name ..] [--status ..] [--hide] [--importance ..]` (an importance line adds a "Why it matters" column), `group --sprint N --name .. --tickets .. [--tenant ..]` (custom story), or edit the file (`types`, `featureTypes`, `workedOnly`, `maxFeaturesPerTenant`, `notes`). `sprint-report.mjs list` / `show --sprint N` / `sprints` / `features` (the top stories as JSON, with ids).

### Friday 3 PM schedule
A scheduled task ("NGK Friday reports") runs every Friday at 3 PM (needs the Claude app open; otherwise it runs at next launch): it builds and polishes the **weekly status** and the **weekly defects report**, and on every second Friday starting **2026-10-30** (`sprint-report.mjs due` exits 0) also builds the **sprint report** for the active sprint (no AI step needed). Entries are saved either way, so any past week or sprint can be asked for.

## Output
- Markdown tables in the chat (scripts print them; do not retype them). **Every ticket key in any table must be a Jira link** (`[NGK-123](https://tillster.atlassian.net/browse/NGK-123)`), including tables you write by hand such as dry-run diffs and summaries. Open with a 3-5 line headline from the script output. After a track, ask what next.
- Dry-run diff before any write; one line per ticket after.

## Notes / gotchas
- **Sprint scope**: `openSprints()` in JQL, then a client-side name-prefix filter. Ready for QA counts as done for risk and reporting. A finished sprint can stay "active" in Jira for days, so dates look late; say so.
- Field IDs: Client `customfield_16047` (multi-select), UAT `customfield_16050`, Sprint `customfield_10007`.
- The first Jira search page is sometimes empty; the helper retries.
- Client suggestions are heuristics (title match, learned prefixes like RCUSSD→RC-US, parent): always show confidence; the user confirms. "TI-XX" in titles is Tillster-internal work, not a customer.
- Closing transitions differ per workflow; `apply.mjs` fails with the list of available transitions rather than guessing.
- Comments and closure notes land on external-facing tickets: keep them factual, show the text in the dry run, and never include card data, secrets or guest PII.
