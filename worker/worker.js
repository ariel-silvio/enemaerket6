/**
 * Enemærket 6 — Notion write-back Worker.
 *
 * The plan page (GitHub Pages, public) posts a single field edit here; this Worker
 * validates it and PATCHes the matching Notion page. The Notion token never leaves
 * the Worker.
 *
 * Secrets / vars (see README.md):
 *   NOTION_TOKEN    secret — Notion integration token, needs "Update content" capability
 *   EDIT_KEY        secret — shared passphrase the page must send in X-Edit-Key
 *   ALLOWED_ORIGIN  var    — comma-separated origins allowed to call this Worker
 *
 * POST /  {"pageId": "<uuid>", "field": "<name>", "value": <string|number|null>}
 */

const NOTION_VERSION = "2025-09-03";
const MAX_BODY_BYTES = 8 * 1024;

/**
 * Only these Notion properties can ever be written, and selects only accept values
 * from their list. Notion's API (2025-09-03) rejects an unrecognised select value
 * outright with a 400 rather than creating it — verified 2026-08-04, contradicting
 * an earlier assumption here — but the allowlist still matters: it's the only thing
 * restricting which properties can be touched at all, and date/number/text fields
 * have no schema-level guardrail the way selects do.
 */
const EDITABLE = {
  type: { prop: "Type", kind: "select", options: ["DIY", "Professional", "Admin", "Purchase"] },
  status: { prop: "Status", kind: "select", options: ["Not Started", "In Progress", "Blocked", "Done"] },
  priority: { prop: "Priority", kind: "select", options: ["Critical", "High", "Normal", "Low"] },
  resp: { prop: "Assigned To", kind: "select", options: ["Ariel", "Natalia", "Contractor", "Both"] },
  start: { prop: "Start Date", kind: "date" },
  due: { prop: "Due Date", kind: "date" },
  hours: { prop: "Est. Hours (DIY)", kind: "number", min: 0, max: 10000 },
  cost: { prop: "Est. Cost (DKK)", kind: "number", min: 0, max: 100000000 },
  note: { prop: "Notes", kind: "text", maxLength: 2000 },
};

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Edit-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
  });
}

/** Constant-time compare so a wrong key can't be recovered byte by byte from timing. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Validate the incoming value and return the Notion property payload for it.
 * Throws Error with a human-readable message on bad input.
 */
function buildProperty(spec, value) {
  switch (spec.kind) {
    case "select": {
      if (value === null || value === "") return { select: null };
      if (typeof value !== "string" || !spec.options.includes(value)) {
        throw new Error(`value must be null or one of: ${spec.options.join(", ")}`);
      }
      return { select: { name: value } };
    }
    case "date": {
      if (value === null || value === "") return { date: null };
      if (typeof value !== "string" || !DATE_RE.test(value)) {
        throw new Error("value must be null or a YYYY-MM-DD date");
      }
      // Reject impossible dates that still match the shape, e.g. 2026-02-31.
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
        throw new Error("value is not a real calendar date");
      }
      return { date: { start: value } };
    }
    case "number": {
      if (value === null || value === "") return { number: null };
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw new Error("value must be null or a number");
      if (n < spec.min || n > spec.max) {
        throw new Error(`value must be between ${spec.min} and ${spec.max}`);
      }
      return { number: n };
    }
    case "text": {
      if (value === null || value === "") return { rich_text: [] };
      if (typeof value !== "string") throw new Error("value must be null or a string");
      if (value.length > spec.maxLength) {
        throw new Error(`value must be at most ${spec.maxLength} characters`);
      }
      return { rich_text: [{ type: "text", text: { content: value } }] };
    }
    default:
      throw new Error("unsupported field kind");
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405, request, env);
    }

    const origin = request.headers.get("Origin") || "";
    if (!allowedOrigins(env).includes(origin)) {
      return json({ error: "origin not allowed" }, 403, request, env);
    }

    if (!env.NOTION_TOKEN || !env.EDIT_KEY) {
      return json({ error: "worker is missing NOTION_TOKEN or EDIT_KEY" }, 500, request, env);
    }
    if (!safeEqual(request.headers.get("X-Edit-Key") || "", env.EDIT_KEY)) {
      return json({ error: "senha de edição incorreta" }, 401, request, env);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: "body too large" }, 413, request, env);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid JSON body" }, 400, request, env);
    }

    const { pageId, field, value } = body ?? {};
    if (typeof pageId !== "string" || !UUID_RE.test(pageId)) {
      return json({ error: "pageId must be a Notion UUID" }, 400, request, env);
    }
    // hasOwnProperty, not a plain lookup: EDITABLE["__proto__"] would otherwise
    // resolve to Object.prototype and pass a truthiness check.
    const spec = Object.prototype.hasOwnProperty.call(EDITABLE, field) ? EDITABLE[field] : null;
    if (!spec) {
      return json(
        { error: `field must be one of: ${Object.keys(EDITABLE).join(", ")}` },
        400,
        request,
        env
      );
    }

    let property;
    try {
      property = buildProperty(spec, value === undefined ? null : value);
    } catch (err) {
      return json({ error: `${field}: ${err.message}` }, 400, request, env);
    }

    const notionRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { [spec.prop]: property } }),
    });

    if (!notionRes.ok) {
      const detail = await notionRes.text();
      console.log(`Notion ${notionRes.status} on ${field}/${pageId}: ${detail}`);
      // Notion's raw error can name internal IDs, so return a short summary instead.
      let message = `Notion recusou a alteração (HTTP ${notionRes.status})`;
      if (notionRes.status === 401 || notionRes.status === 403) {
        message += " — verifique se a integração tem permissão de escrita (Update content).";
      } else if (notionRes.status === 404) {
        message += " — página não encontrada ou não compartilhada com a integração.";
      }
      return json({ error: message }, 502, request, env);
    }

    return json({ ok: true, field, value: value ?? null }, 200, request, env);
  },
};
