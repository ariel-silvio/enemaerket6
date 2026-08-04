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
      ↑                                                                                │
      └──────────────  Cloudflare Worker (worker/, optional)  ←─── field edits ─────────┘
```

Notion already runs their whole renovation project (Tasks/Projects/Milestones/Quotes/Expenses
databases). This repo does **not** duplicate that data by hand — a script pulls it, on a
schedule, into a JSON file the static page fetches at load time.

The read path is one-way and always has been: `scripts/export_notion.py` never writes.
A **separate, optional** write path was added later (see `worker/README.md`): the page can
PATCH nine allowlisted fields back into Notion through a Cloudflare Worker that holds the
token. Notion remains the single source of truth — there is still no second database and no
reconciliation logic, because writes go straight to Notion rather than into a local store.

## Why this architecture (don't relitigate without reading this)

Earlier iterations hand-embedded a task array directly in the HTML, edited turn-by-turn from
pasted user comments. That drifted from Notion and required manual JS edits for every change —
explicitly called out as unsustainable. Two alternatives were rejected before landing here:

- **Client-side Notion API calls from the page**: rejected outright. GitHub Pages is public and
  unauthenticated; any Notion token embedded in browser JS is readable by anyone who views
  source, handing out full read/write access to the whole Notion workspace. Do not do this,
  even if it seems like the fastest fix for "make it live."
- **Full two-way sync via a serverless function**: originally rejected as overkill for a
  household project. **Ariel later asked for it explicitly** (Natalia won't use Notion
  directly, so edits had to happen on the page), and it now exists in `worker/` — a single
  Cloudflare Worker doing one-field PATCHes. Note what was built and what wasn't: there is no
  local database, no bidirectional reconciliation and no conflict resolution, because every
  edit goes directly to Notion. Adding a real database in the middle would reintroduce exactly
  the drift this architecture avoids — don't.

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
.github/workflows/sync-notion.yml — GitHub Action: workflow_dispatch + hourly cron (on the hour).
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
4. **Notion content should be written in Portuguese going forward.** It used to be mostly
   English (flagged here as a known tradeoff of making Notion canonical), but Ariel asked for
   Natalia to be able to use the page without touching Notion, so on 2026-08-03 every visible
   task's `Task` and `Notes` were translated directly in Notion — 62 of 77 tasks, everything
   except the `[DUPLICATE]`/`[SUPERSEDED]` rows (already filtered out of `data.json`, so not
   worth touching) and the handful of tasks added after 2026-08-02 that were already PT-BR.
   This was a one-time data cleanup done through Notion's API, **not** a code-side translation
   layer — that distinction matters, because a translation layer is still the wrong move for
   the same reason it was rejected for Responsible/Hours: it'd be an extra thing to keep in
   sync with Notion instead of just writing Notion correctly in the first place. Concretely,
   this means: **write new `Task`/`Notes` content in Portuguese from the start**, whether you're
   adding it yourself or on Ariel's behalf. Keep Danish administrative/technical terms as-is
   where there's no clean equivalent and the convention is already established — tilstandsrapport,
   brændeovn, VVS-mester, elinstallatør, murermester, skorstensfejer, byggetilladelse, BR18,
   fjernvarme, solceller, genbrugsstation, Miljøstyrelsen, Vindstød, borger.dk,
   håndværkerfradrag — plus brand/product names and task-ID cross-references, unchanged.
   If English content creeps back in over time, that's drift to fix in Notion again, not a
   sign to build tooling around it.
5. **Watch for mangled unicode escapes in Notion text properties.** Found and fixed two during
   the 2026-08-03 translation pass: `Notes` containing the literal characters `bru00f8nd`
   instead of `brønd`, and `dormu00eancia` instead of `dormência` — i.e. a `\uXXXX` escape that
   got written out as literal text instead of being decoded, from some past write (unclear
   which). If you see other `\u` -looking fragments sitting in Notion text, it's the same bug
   pattern, not intentional content — fix in place, don't propagate it into a translation or
   any other edit.

## Open items / suggested next steps, roughly in priority order

1. **Confirm Notion setup is complete** (integration created, both DBs shared with it,
   `NOTION_TOKEN` secret added — see SETUP.md). If not done, this blocks everything else.
2. **Run the Action once, debug the export script against real data.** It has never
   successfully run. Expect at least one round of fixing property-name mismatches or pagination
   edge cases. The script prints the raw Notion error body on failure — read it before guessing.
3. **Check whether `Assigned To` has been backfilled** in Notion. If `data.json` still shows
   mostly-null `resp` fields after a real sync, that's expected and not a bug — it means Ariel
   hasn't finished the backfill he committed to.
4. **Resolved 2026-08-04**: a `MoveIn Pré · Pré-Mudança` Group option now exists in Notion
   (added via `ALTER COLUMN "Group" SET SELECT(...)` on the Tasks data source — the Notion API
   version in use here does **not** auto-create select options from a page write like the
   Worker's code comments assumed; the option has to exist on the schema first, or the write
   is rejected with a 400). It's assigned to the four electrical-scheduling tasks that happen
   *before* the Sept 1 handover and need the seller's pre-handover access — #55, #56, #64, #85
   — split out from `MoveIn C · Elétrica`, which now holds only the post-handover execution
   tasks (#57–59, #65). `groups.json` has a matching entry, placed first in the array so it
   renders before Grupo A. `#83` (Vindstød registration) was initially left in
   `MoveIn B · Semana 1 Limpeza` since it's paperwork, not a contractor contact — Ariel asked
   for it to move into Pré-Mudança too on the same day, so it now does.
5. **`Group` is Move-In-project-only; other Projects use their own name as the grouping
   instead** (2026-08-04 clarification from Ariel: "mantemos o Grupo G apenas para o Projeto
   Move-in"). Concretely: if a task belongs to the Move-In 2026 Project, give it one of the
   `MoveIn X · ...` Group values. If a task is its own standalone thing — a later-phase
   enhancement, a different room's project — it should get its **own Project** in Notion with
   `Group` left empty, and `groups.json` gets a new entry keyed by that Project's exact `Name`
   (this is the `group_key = group if group else (project_name or "Sem grupo")` fallback in
   `scripts/export_notion.py`). Example done this way: `#29` (the balustrade cap-rail task) was
   split out of `MoveIn G · Entrada` into a new "Entrada 2027" Project, because it's an explicit
   phase-2 task meant to happen well after the move-in checklist, not alongside it — its sibling
   `#30` (painting the balustrade) stayed in Grupo G since that one is actual move-in prep.
   Renaming an existing Project's `Name` (done the same day for "Kitchen" → "Cozinha Nova
   2027/28" and the greenhouse Project → "Estufa 2026") requires updating `groups.json`'s `key`
   to match exactly, or the group falls back to the ungraceful "grupo novo, sem cor definida"
   state until it's fixed.
6. **Resolved 2026-08-04**: Milestones are now synced from Notion's Milestones data source
   (`5a389771-...`) into a second export file, `milestones.json` — `scripts/export_notion.py`
   queries it alongside Tasks/Projects and resolves each milestone's `Project` relation to a
   name, same pattern as tasks. They render as vertical purple markers in the zoomed Move-In
   Gantt view (`index.html`, `buildGanttZoomed`), filtered to `project === "Move-In 2026"` —
   there are 4 milestones total, one belongs to the Chimney project instead, and gets excluded
   this way rather than by date-range guessing. Not wired into anything else (no hero-strip
   chips) — just the one Gantt view, matching what was actually asked for. If you add fields to
   a milestone in Notion, they need name matching everywhere: the export script's `properties`
   lookup, `milestones.json`'s shape, and the JS filter/render code all reference the same
   strings (`"Move-In 2026"`, `"Date"`, `"Project"`) — a rename in Notion breaks the filter
   silently (0 markers, not an error) rather than loudly.
7. **Unused-but-available Notion fields**: `Håndværkerfradrag Eligible`, `Requires Permit`,
   `Sequence Tier`, `Milestone` relation. None are surfaced in `data.json` or the page yet.
   Possible future asks from Ariel — not committed to anything, just noting they exist.
8. **Field edits write to Notion; comments still don't.** The nine fields listed in
   `worker/README.md` are editable on the page and PATCH straight into Notion. The separate
   comment boxes remain `localStorage`-only and per-browser, for requests that aren't a plain
   field edit (e.g. "split this task in two"), still meant to be copy-pasted into a chat.
9. **`data.json` now carries `pageId` plus raw values** (`respRaw`, `costRaw`, `startRaw`,
   `dueRaw`) alongside the display-formatted ones. The editor needs them: `resp` is translated
   to pt-BR, `cost` is a formatted string, and `start`/`end` are derived (quarter fallback), so
   none of those round-trip. If you add an editable field, add its raw value to the export too.
10. **The field allowlist is duplicated on purpose** — `EDITABLE` in `worker/worker.js` and
    `EDIT_FIELDS` in `index.html`. The Worker's copy is the security boundary and must never be
    loosened to "whatever the page sends". Validate anyway: **correction to an earlier version
    of this note** — Notion does *not* silently create new select options on a page write (see
    item 4 above); an unknown select value is rejected outright with a 400. The real risk of a
    loosened allowlist is smaller than originally thought, but still real: a typo'd-but-existing
    option value would silently misfile a task, and any other field kind (date, number, text)
    has no such guardrail at all.

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
