#!/usr/bin/env python3
"""
Exports the Enemaerket 6 Notion Tasks database into data.json for the GitHub Pages
plan. Notion is the single source of truth: this script reads and does not write.

Requires:
  NOTION_TOKEN  env var — a Notion internal integration token with read access to
                the Tasks and Projects data sources (share both with the integration
                from each database's "Connections" menu in Notion).

Usage:
  NOTION_TOKEN=secret_xxx python3 scripts/export_notion.py
"""
import os
import sys
import json
import calendar
import urllib.request
import urllib.error

NOTION_VERSION = "2025-09-03"
TASKS_DATA_SOURCE_ID = "75781ad6-ff2d-4008-980a-a533b5d23908"
PROJECTS_DATA_SOURCE_ID = "2e510bda-e8fe-4d3a-b522-45ddbf1898b9"

ASSIGNED_TO_LABEL = {
    "Ariel": "Ariel",
    "Natalia": "Natalia",
    "Contractor": "Contratado",
    "Both": "Ariel + Natalia",
}

QUARTER_MONTHS = {"Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12)}


def notion_request(path, token, body=None):
    url = f"https://api.notion.com/v1/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    data = json.dumps(body or {}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"Notion API error {e.code} on {path}:\n{detail}", file=sys.stderr)
        raise


def query_data_source(data_source_id, token):
    """Paginate through every row of a Notion data source."""
    results = []
    body = {"page_size": 100}
    while True:
        page = notion_request(f"data_sources/{data_source_id}/query", token, body)
        results.extend(page.get("results", []))
        if page.get("has_more"):
            body["start_cursor"] = page["next_cursor"]
        else:
            break
    return results


# ---------- Notion property extraction helpers ----------
def prop_title(props, name):
    p = props.get(name)
    if not p:
        return ""
    return "".join(t.get("plain_text", "") for t in p.get("title", []))


def prop_select(props, name):
    p = props.get(name)
    if not p:
        return None
    v = p.get("select")
    return v["name"] if v else None


def prop_number(props, name):
    p = props.get(name)
    return p.get("number") if p else None


def prop_rich_text(props, name):
    p = props.get(name)
    if not p:
        return ""
    return "".join(t.get("plain_text", "") for t in p.get("rich_text", []))


def prop_date(props, name):
    p = props.get(name)
    d = p.get("date") if p else None
    if not d:
        return (None, None)
    return (d.get("start"), d.get("end"))


def prop_relation_ids(props, name):
    p = props.get(name)
    if not p:
        return []
    return [r["id"] for r in p.get("relation", [])]


def prop_unique_id(props, name):
    p = props.get(name)
    u = p.get("unique_id") if p else None
    return u.get("number") if u else None


def quarter_range(quarter, year):
    y = int(year)
    m1, m2 = QUARTER_MONTHS[quarter]
    last_day = calendar.monthrange(y, m2)[1]
    return f"{y}-{m1:02d}-01", f"{y}-{m2:02d}-{last_day:02d}"


def format_cost(value):
    if value is None:
        return "—"
    return f"{value:,.0f}".replace(",", ".")


def main():
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        print("NOTION_TOKEN env var is required.", file=sys.stderr)
        sys.exit(1)

    # --- Projects: build id -> name lookup, skip superseded projects ---
    projects_raw = query_data_source(PROJECTS_DATA_SOURCE_ID, token)
    project_names = {}
    for p in projects_raw:
        props = p.get("properties", {})
        name = prop_title(props, "Name")
        project_names[p["id"]] = name

    # --- Tasks ---
    tasks_raw = query_data_source(TASKS_DATA_SOURCE_ID, token)
    tasks = []
    skipped = 0
    for t in tasks_raw:
        props = t.get("properties", {})
        title = prop_title(props, "Task")

        if title.startswith("[DUPLICATE") or title.startswith("[SUPERSEDED"):
            skipped += 1
            continue

        rel_ids = prop_relation_ids(props, "Project")
        project_name = project_names.get(rel_ids[0]) if rel_ids else None
        if project_name and project_name.startswith("[SUPERSEDED"):
            skipped += 1
            continue

        group = prop_select(props, "Group")
        group_key = group if group else (project_name or "Sem grupo")

        assigned = prop_select(props, "Assigned To")
        resp = ASSIGNED_TO_LABEL.get(assigned)  # None if not yet filled in Notion

        start, _ = prop_date(props, "Start Date")
        due_start, due_end = prop_date(props, "Due Date")

        tq = prop_select(props, "Target Quarter")
        ty = prop_select(props, "Target Year")

        gantt_start = start
        gantt_end = due_start or due_end
        quarter_label = None

        if not gantt_start and not gantt_end and tq and ty:
            gantt_start, gantt_end = quarter_range(tq, ty)
            quarter_label = f"{tq} {ty}"
        elif gantt_start and not gantt_end:
            gantt_end = gantt_start

        tasks.append({
            "id": prop_unique_id(props, "Task ID"),
            "name": title,
            "type": prop_select(props, "Type"),
            "status": prop_select(props, "Status"),
            "priority": prop_select(props, "Priority"),
            "resp": resp,
            "start": gantt_start,
            "end": gantt_end,
            "quarter": quarter_label,
            "cost": format_cost(prop_number(props, "Est. Cost (DKK)")),
            "hours": prop_number(props, "Est. Hours (DIY)"),
            "note": prop_rich_text(props, "Notes"),
            "group": group_key,
        })

    tasks.sort(key=lambda x: (x["id"] is None, x["id"]))

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)

    print(f"Exported {len(tasks)} tasks, skipped {skipped} duplicate/superseded rows.")


if __name__ == "__main__":
    main()
