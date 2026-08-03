# Write-back Worker — editing the plan from the webpage

With this deployed, the plan page becomes editable: click a field in the table
(responsável, início, prazo, custo, horas, status, prioridade, tipo, nota) and the change
is written straight into Notion.

Notion stays the single source of truth. The page never holds the Notion token — it sends
one field at a time to this Cloudflare Worker, which holds the token and does the write.

## Why a Worker at all

The page is served by GitHub Pages, so everything in it is public. Putting a Notion token
in the JavaScript would hand write access to the whole database to anyone who views source.
The Worker keeps the token server-side; the page only ever carries a passphrase you choose,
which grants nothing but "edit these nine fields on these tasks".

## Setup

### 1. Let the Notion integration write

The integration was originally created read-only, so writes will fail with 403 until you
change this:

1. https://www.notion.so/my-integrations → open `enemaerket6-sync`.
2. Capabilities → tick **Update content** (Read content stays on; Insert content is not needed).
3. Save.

### 2. Deploy the Worker

Requires a free Cloudflare account and Node installed locally.

```bash
cd worker
npx wrangler login          # opens a browser to authorize
npx wrangler deploy
```

Deploy prints the Worker URL, something like
`https://enemaerket6-notion-write.<your-subdomain>.workers.dev`. Keep it for step 4.

### 3. Set the two secrets

```bash
npx wrangler secret put NOTION_TOKEN   # same token as the NOTION_TOKEN GitHub secret
npx wrangler secret put EDIT_KEY       # the edit passphrase, see below
```

Generate a strong passphrase rather than inventing one — it is the only thing standing
between the public page and write access:

```bash
openssl rand -hex 24
```

Save it in your password manager and share it with Natalia. It is typed once per browser
and then remembered.

### 4. Point the page at the Worker

In `index.html`, near the top of the `<script>` block:

```js
const WORKER_URL = "https://enemaerket6-notion-write.<your-subdomain>.workers.dev";
```

Commit and push. While this is empty, the page simply shows editing as disabled — nothing
breaks.

### 5. Run the sync once

The editor needs each task's Notion page ID, which older `data.json` files do not have.
Go to Actions → **Sync Notion → data.json** → **Run workflow** (or use the "Sincronizar
agora" button on the page). Until that runs, clicking a field says the task has no pageId.

## Using it

Click **Ativar edição**, enter the passphrase, then click any underlined value.
Selects and dates save as soon as you pick; text and number fields save on Enter or when
you click away. Escape cancels.

A blue dot (•) next to a value means it is already saved in Notion but has not yet come
back through the nightly sync into `data.json`. The dot disappears by itself once the sync
catches up. Clearing a field ("— a definir —" or an empty box) is allowed and blanks the
property in Notion.

If a save fails the cell reverts to its previous value and the reason is shown next to the
edit button — nothing is left in a half-saved state.

## What the Worker will and won't do

It only ever writes these nine properties, and only to values it recognises:

| Page field | Notion property | Accepts |
|---|---|---|
| type | Type | DIY, Professional, Admin, Purchase |
| status | Status | Not Started, In Progress, Blocked, Done |
| priority | Priority | Critical, High, Normal, Low |
| resp | Assigned To | Ariel, Natalia, Contractor, Both |
| start | Start Date | a YYYY-MM-DD date |
| due | Due Date | a YYYY-MM-DD date |
| hours | Est. Hours (DIY) | 0–10000 |
| cost | Est. Cost (DKK) | 0–100000000 |
| note | Notes | up to 2000 characters |

Any other field name, or a select value outside these lists, is rejected before Notion is
called. This matters because Notion silently creates a new select option on write — without
the allowlist, one typo would add a junk option to the database schema.

It also refuses requests from any origin other than those in `ALLOWED_ORIGIN`
(`wrangler.toml`), rejects anything without the right passphrase, and requires the page ID
to be a well-formed UUID.

If you edit the field list here, change it in **both** `worker.js` (`EDITABLE`) and
`index.html` (`EDIT_FIELDS`) — the Worker rejects anything the page sends that it doesn't
know about.

## Known limits

- **Due Date ranges collapse.** If a task's Due Date in Notion is a range, saving a new due
  date replaces it with a single date. The plan doesn't currently use ranges.
- **No edit history.** Notion records the change, but the page doesn't show who changed
  what. Notion's own page history does.
- **Last write wins.** If both of you edit the same field within the same minute, the later
  save overwrites the earlier one silently. In practice this needs two people editing the
  same task simultaneously.
- **Clearing both dates on a quarter-only task** leaves the old Gantt bar until the next
  sync, because the quarter fallback needs Target Quarter/Year, which the page doesn't carry.

## If something breaks

Watch the Worker's logs while reproducing the problem:

```bash
cd worker && npx wrangler tail
```

- **401 "senha de edição incorreta"** — the passphrase doesn't match `EDIT_KEY`. The page
  clears the stored one, so just re-enter it.
- **403 "origin not allowed"** — the site is being served from an origin missing from
  `ALLOWED_ORIGIN` in `wrangler.toml`. Add it and redeploy.
- **502 mentioning "Update content"** — step 1 above wasn't done, or the token in the Worker
  differs from the one shared with the databases.
- **502 "página não encontrada"** — the task's database isn't shared with the integration.
