# Handoff: Enemærket 6 renovation plan — Notion → GitHub Pages sync

Written for Claude Code picking this up in a fresh session with no memory of the chat that
built it. Read this whole file before touching code — several decisions here were made after
finding out the "obvious" approach was wrong (see Gotchas).

## What this project is

A static GitHub Pages site (`index.html`) that renders a Danish house renovation plan — task
breakdown by group/project, an ISO-week filter, and a horizontally-scrollable Gantt chart — for
a family (Ariel, Natalia, daughter Olivia) planning a move-in and multi-year renovation at
Enemærket 6, Risskov, Denmark. The audience is the couple, viewed together on a laptop.

**Data flow (current, intended architecture):**

```
Notion (canonical source)  →  GitHub Action (scheduled + manual)  →  data.json  →  index.html
```

Notion already runs their whole renovation project (Tasks/Projects/Milestones/Quotes/Expenses
databases). This repo does **not** duplicate that data by hand — a script pulls it, on a
schedule, into a JSON file the static page fetches at load time. **One-way, read-only.** Nothing
in this repo writes back to Notion.

## Why this architecture (don't relitigate without reading this)

Earlier iterations hand-embedded a task array directly in the HTML, edited turn-by-turn from
pasted user comments. That drifted from Notion and required manual JS edits for every change —
explicitly called out as unsustainable. Two alternatives were rejected before landing here:

- **Client-side Notion API calls from the page**: rejected outright. GitHub Pages is public and
  unauthenticated; any Notion token embedded in browser JS is readable by anyone who views
  source, handing out full read/write access to the whole Notion workspace. Do not do this,
  even if it seems like the fastest fix for "make it live."
- **Full two-way sync via a serverless function**: rejected as overkill for a household project
  — real backend, real maintenance, not worth it here. If this changes, that's a product
  decision for Ariel, not something to build speculatively.

Also rejected: a local `overrides.json` layer to patch in "Responsible" and "Hours" data that
Notion doesn't have well populated. Ariel chose instead to backfill Notion itself (see Open
Items — this may or may not be complete; check before assuming it is).

## Repo file map

```
index.html                       — the page. Fetches ./data.json + ./groups.json at load.
groups.json                      — curated {key, label, color} per Notion Group/Project value.
                                    Purely cosmetic config; hand-maintained, not auto-generated.
data.json                        — generated output. Currently seeded as [] (empty) — the
                                    export script has NOT yet been run successfully against
                                    live Notion. See Status below.
scripts/export_notion.py         — the sync script. Stdlib-only (urllib), no pip deps.
.github/workflows/sync-notion.yml — GitHub Action: workflow_dispatch + daily cron 05:30 UTC.
SETUP.md                         — step-by-step for Ariel: create Notion integration, share
                                    both databases with it, add NOTION_TOKEN repo secret.
```

## Status as of handoff — what's real vs. untested

- **`index.html`**: JS syntax-checked (`node --check`), never run in an actual browser against
  real `data.json`. Logic (Gantt math, ISO week calc, group aggregation) was checked with
  standalone Node snippets, not end-to-end in the DOM.
- **`scripts/export_notion.py`**: syntax-checked (`py_compile`) only. **Never executed against
  the live Notion API** — the sandbox this was built in has no network access to
  `api.notion.com`. Treat the property-extraction logic as "should work based on the schema
  inspected via MCP" rather than "verified working." Expect to debug on first real run — check
  exact property name spelling against what's below, and check the Notion API error body
  (the script prints it to stderr on failure) before guessing.
- **`data.json`**: currently `[]`. Nobody has confirmed the GitHub Action has been run
  successfully even once. First task: get one clean run end-to-end.
- **Notion setup (integration created, databases shared, `NOTION_TOKEN` secret added)**: status
  unknown at handoff time — SETUP.md was handed to Ariel but completion wasn't confirmed in
  this session. Don't assume it's done.
- **Backfilling "Assigned To" for all 85 Notion tasks**: Ariel said he'd do this himself
  (chose this over a code-side overrides file). Status unconfirmed — check `data.json` after a
  real sync; if most `resp` fields are still null, he hasn't finished.

## Notion schema reference (verified live via MCP during the session that built this)

Data source IDs (these are **data source IDs**, not page IDs or database IDs — Notion API
2025-09-03 requires this distinction, see Gotchas):

| DB | Data source ID |
|---|---|
| Tasks | `75781ad6-ff2d-4008-980a-a533b5d23908` |
| Projects | `2e510bda-e8fe-4d3a-b522-45ddbf1898b9` |
| Milestones | `5a389771-2e48-420e-a3b8-eb6fe072ab2f` (**not yet consumed** by the export script — see Open Items) |
| Quotes | `0230612e-7400-43fe-bf99-f96121463a31` (unused) |
| Expenses | `e1960f63-a37b-4ac5-9b23-fe5e6e1aa46e` (unused) |

**Tasks data source properties** (exact names, case-sensitive):

| Property | Type | Notes |
|---|---|---|
| `Task` | title | Task name. Mixed English/Portuguese — see Open Items. |
| `Task ID` | unique_id (auto-increment) | Stable numeric ID, matches the numbering used everywhere else (e.g. "#58" in chat). |
| `Type` | select | `DIY` / `Professional` / `Admin` / `Purchase` |
| `Status` | select | `Not Started` / `In Progress` / `Blocked` / `Done` |
| `Priority` | select | `Critical` / `High` / `Normal` / `Low` |
| `Assigned To` | select | `Ariel` / `Natalia` / `Contractor` / `Both`. **69/85 rows null** as of last check. |
| `Group` | select | Only has options for `MoveIn A · Dia 1` through `MoveIn H · Saída Aluguel` — **43/85 rows have no Group**, meaning non-Move-In tasks (Porão, Cozinha, Chaminé, etc.) rely entirely on the `Project` relation for grouping. |
| `Project` | relation → Projects data source | Array of page URLs; resolve via Projects lookup. |
| `Milestone` | relation → Milestones data source | Not currently used in export. |
| `Start Date` | date | `date:Start Date:start` / `:end` / `:is_datetime` if querying via SQL mode. |
| `Due Date` | date | Same shape. Treated as the deadline in the export script. |
| `Target Quarter` | select | `Q1`–`Q4`, used as fallback when no exact dates exist. |
| `Target Year` | select | `2026`–`2035`. |
| `Est. Cost (DKK)` | number | Mostly unfilled (~documented cost is small per the source plan). |
| `Est. Hours (DIY)` | number | **80/85 rows null.** Do not backfill this with guesses — render "—" for null, as the current script does. |
| `Notes` | rich_text | |
| `Håndværkerfradrag Eligible` | checkbox | Not surfaced on the page yet. |
| `Requires Permit` | checkbox | Not surfaced on the page yet. |
| `Sequence Tier` | number | Not surfaced on the page yet. |
| `Week` | formula (read-only) | Not used — the page computes ISO week client-side instead. |

**Projects data source**: has `Name` (title), `Status`, `Category`, `Phase`, `Horizon`,
`Target Year`, `Budget Must-Do (DKK)`, `Budget Want-To-Do (DKK)`, `Notes`, `Project ID`. Names
seen: `Move-In 2026`, `Basement — Moisture & Fit-Out`, `Garage Revamp`,
`Chimney & Brændeovn Compliance`, `Ground Floor Finishing`, `Kitchen`, `Smart Home`, `Security`,
`Heating & Energy`, `Garden 2026 — Pre-Winter`, `Garden 2027 — Post-Winter`,
`Greenhouse: dual-purpose growing + coffee nook`, and one superseded:
`[SUPERSEDED] Garden — split into 2026 Pre-Winter and 2027 Post-Winter` (must be filtered out —
the export script does this by name prefix, confirm it still works).

**Data hygiene convention already in use in this workspace** (established before this repo
existed, per the family's existing Notion practice): there's no delete — superseded items are
marked by prefixing the title with `[SUPERSEDED]` or `[DUPLICATE]` and archived via status. The
export script filters both at the task level and (for `[SUPERSEDED]` only) at the project level.
**8 duplicate/superseded task rows currently still exist as live, non-archived rows** in the
Tasks data source (IDs referenced in the original plan doc: #1, #2, #4, #15, #20, #28, #34,
#49) — confirmed via a live count query (`85` total, `8` matching the filter) during this
session. If that count changes, double check the filter still catches everything.

## Gotchas (things that cost time to discover — don't rediscover them)

1. **Notion API version.** Must send header `Notion-Version: 2025-09-03`. This is a breaking
   version from the pre-Sept-2025 API: database queries moved from
   `POST /v1/databases/{database_id}/query` to `POST /v1/data_sources/{data_source_id}/query`,
   and **database IDs and data source IDs are not interchangeable**. The IDs listed above are
   data source IDs (confirmed via the MCP `collection://` URL format) — use them directly with
   the `/v1/data_sources/.../query` endpoint, do not try to "retrieve the database" first to
   get a data source ID, they're already data source IDs.
2. **`window.storage` is a Claude-artifact-only API.** It does not exist on GitHub Pages. An
   earlier version of this page used it for comment persistence; that was migrated to plain
   `localStorage` before shipping to GitHub. If you see `window.storage` reappear anywhere,
   that's a regression — it will throw in a real browser.
3. **`fetch('./data.json')` requires being served over http(s), not opened via `file://`.**
   Browsers block local-file fetches. This is expected and handled — `index.html` shows an
   error state explaining this — but don't "fix" it by trying to inline the data again; that
   reintroduces the duplication problem this whole migration was meant to solve.
4. **Notion task titles are mostly English**, not Portuguese, even though the audience
   (Natalia) prefers PT-BR for shared docs (per longstanding preference — see any prior
   project memory if available to you). This was flagged to Ariel as a tradeoff of making
   Notion canonical, not fixed in code. Don't build a translation layer without being asked —
   that's the same "extra file to patch what Notion doesn't have" pattern that was explicitly
   rejected for Responsible/Hours.

## Open items / suggested next steps, roughly in priority order

1. **Confirm Notion setup is complete** (integration created, both DBs shared with it,
   `NOTION_TOKEN` secret added — see SETUP.md). If not done, this blocks everything else.
2. **Run the Action once, debug the export script against real data.** It has never
   successfully run. Expect at least one round of fixing property-name mismatches or pagination
   edge cases. The script prints the raw Notion error body on failure — read it before guessing.
3. **Check whether `Assigned To` has been backfilled** in Notion. If `data.json` still shows
   mostly-null `resp` fields after a real sync, that's expected and not a bug — it means Ariel
   hasn't finished the backfill he committed to.
4. **`#83` (Vindstød registration) and any other "pre-move-in" tasks** don't have a matching
   `Group` option in Notion (there's no `Pré-mudança` select value) — they'll fall into the
   generic `Move-In 2026` bucket in `groups.json`. This was flagged as a known gap, not fixed.
   If Ariel wants that distinction back, it needs a new Group select option added in Notion,
   not a code-side patch.
5. **Milestones aren't synced.** The hero strip at the top of `index.html` (`syncNote` area /
   the four milestone chips in the previous single-file version — check current `index.html`,
   this may have been simplified during the migration) still needs manual updates or a second
   export target pulling from the Milestones data source (`5a389771-...`). Not built.
6. **Unused-but-available Notion fields**: `Håndværkerfradrag Eligible`, `Requires Permit`,
   `Sequence Tier`, `Milestone` relation. None are surfaced in `data.json` or the page yet.
   Possible future asks from Ariel — not committed to anything, just noting they exist.
7. **No two-way sync exists.** The comment boxes on the page save to `localStorage` only, are
   per-browser, and are meant to be copy-pasted into a chat with Claude, who then edits Notion
   directly. If a future request is "make comments write to Notion automatically," that's a
   meaningfully bigger scope (real backend, see "Why this architecture" above) — don't build it
   silently as a small feature.

## Style/behavioral notes worth preserving

- Ariel has an explicit standing preference (from `<userPreferences>` in the chat this was built
  in, not necessarily visible to you) to be pushed back on rather than agreed with by default,
  and to have weak points in a plan surfaced before being told something is good. If you're
  interacting with him directly, keep flagging real tradeoffs (like items 4–7 above) rather than
  presenting this as more finished than it is.
- Protocol from the original spec this was built against: **priority sequencing is
  non-negotiable** — electrical/structural safety → moisture → cosmetic — and basement tasks
  should never be shown as actionable while damp remediation isn't Done. If you add any new
  status-driven UI logic, don't let a basement task render as "ready to start" regardless of
  what Notion's Status field says, unless the moisture project is actually Done.
