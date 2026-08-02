# Setup — Notion → GitHub Pages sync

One-time setup, then it runs itself daily (and on demand).

## 1. Create a Notion integration

1. Go to https://www.notion.so/my-integrations → "+ New integration".
2. Name it something like `enemaerket6-sync`. Workspace: yours.
3. Capabilities: **Read content** only (leave Insert/Update unchecked — this script never writes to Notion).
4. Copy the **Internal Integration Secret** (starts with `secret_` or `ntn_`). Treat it like a password.

## 2. Share your databases with the integration

Notion integrations can't see anything until you explicitly connect them:

1. Open the **Tasks** database in Notion (full page, not the linked view).
2. `•••` menu (top right) → **Connections** → add `enemaerket6-sync`.
3. Repeat for the **Projects** database.

If you skip this, the sync will fail with a 404/403 — that's the usual cause.

## 3. Add the token as a GitHub secret

1. In the GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**.
3. Name: `NOTION_TOKEN`. Value: the secret from step 1.

## 4. Push these files

```
index.html
groups.json
data.json          (starts as [])
scripts/export_notion.py
.github/workflows/sync-notion.yml
```

Enable GitHub Pages: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

## 5. Run the sync once, manually

**Actions** tab → **Sync Notion → data.json** → **Run workflow**. It should commit an updated
`data.json` within a few seconds. Check the Action log if it fails — the script prints the
Notion API error body, which almost always tells you exactly what's wrong (usually: database
not shared with the integration).

After that, it re-runs automatically every day at 05:30 UTC. Trigger it manually any time you
want a fresh pull without waiting.

## What this does and doesn't do

- **One-way, read-only.** It never writes to Notion. Editing the page's comment boxes does not
  change Notion — it only builds text for you to paste back into a chat with Claude, who edits
  Notion directly (Notion MCP) when you ask.
- **Two rows are silently skipped**: anything whose title starts with `[DUPLICATE` or
  `[SUPERSEDED`, and anything under a Project whose name starts with `[SUPERSEDED`.
- **Responsible ("Assigned To") and Hours ("Est. Hours (DIY)")** are pulled as-is from Notion.
  Where they're empty, the page shows "— a definir", not a guess.
- **Task titles render in whatever language they're in on Notion** — currently a mix of English
  and Portuguese. Rename them in Notion if you want the page fully in Portuguese for Natalia.
- **New Notion Group/Project values** that aren't in `groups.json` yet still render (grey,
  labeled with the raw key) instead of breaking the page — add them to `groups.json` for a
  proper color/label whenever you create a new project or group in Notion.
