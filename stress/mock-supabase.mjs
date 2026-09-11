/**
 * Minimal in-memory Supabase (PostgREST + auth admin) emulator.
 *
 * Purpose: let the Sufra API routes run end-to-end (integration + stress tests)
 * without a real Supabase project. Implements only the PostgREST subset the
 * app uses: select with eq/in/order/limit, insert, upsert (merge-duplicates),
 * update, delete, embedded resources (order_items, restaurant_tables on orders),
 * and auth admin listUsers/createUser.
 *
 * Usage: node scripts/mock-supabase.mjs [port]
 */
import http from "node:http";

const PORT = Number(process.argv[2] || 54321);

// ── In-memory "database" ────────────────────────────────────────────
const db = {
  restaurants: [],
  categories: [],
  products: [],
  restaurant_tables: [],
  orders: [],
  order_items: [],
  users: [],
};
let seq = 1;
const uuid = () =>
  `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

const svcToken = "mock-service-role-key";

// ── Helpers ─────────────────────────────────────────────────────────
function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Parse `?select=*&order=created_at.asc&limit=1&owner_id=eq.x&id=in.(a,b)` */
function parseQuery(url) {
  const q = {};
  for (const [k, v] of new URL(url, "http://x").searchParams) q[k] = v;
  return q;
}

const OPERATORS = "eq|neq|gt|gte|lt|lte|in|is";

function filterRows(rows, query) {
  let out = rows;
  for (const [key, raw] of Object.entries(query)) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    const m = raw.match(new RegExp(`^(${OPERATORS})\\.(.*)$`, "s"));
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter((r) => {
      const cell = r[key];
      switch (op) {
        case "eq": return String(cell) === val;
        case "neq": return String(cell) !== val;
        case "gt": return cell > val;
        case "gte": return cell >= val;
        case "lt": return cell < val;
        case "lte": return cell <= val;
        case "is": return val === "null" ? cell === null : String(cell) === val;
        case "in": {
          const items = val
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^"|"$/g, ""));
          return items.map(String).includes(String(cell));
        }
        default: return true;
      }
    });
  }
  return out;
}

function orderRows(rows, orderSpec) {
  if (!orderSpec) return rows;
  const [col, dir] = orderSpec.split(".");
  const sorted = [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av) < String(bv) ? -1 : 1;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

/** Very small embedded-resources resolver for the two shapes the app uses. */
function embed(row, table, embedSpecs) {
  const out = { ...row };
  for (const spec of embedSpecs) {
    // spec: { alias, table, cols: ["*"] | ["table_number"] }
    if (spec.table === "order_items") {
      out[spec.alias] = db.order_items
        .filter((i) => i.order_id === row.id)
        .map((i) => (spec.cols[0] === "*" ? { ...i } : pick(i, spec.cols)));
    } else if (spec.table === "restaurant_tables") {
      const t = db.restaurant_tables.find((t) => t.id === row.table_id) ?? null;
      out[spec.alias] = t ? (spec.cols[0] === "*" ? { ...t } : pick(t, spec.cols)) : null;
    }
  }
  return out;
}

function pick(row, cols) {
  const o = {};
  for (const c of cols) o[c] = row[c];
  return o;
}

function parseSelect(select) {
  // returns { cols: "*" | string[], embeds: [{alias, table, cols}] }
  const embeds = [];
  const parts = [];
  for (const rawPart of select.split(",")) {
    const part = rawPart.trim();
    const aliasMatch = part.match(/^([\w]+):\s*([\w]+)\((.*)\)$/);
    const plainMatch = part.match(/^([\w]+)\((.*)\)$/);
    if (aliasMatch) {
      embeds.push({ alias: aliasMatch[1], table: aliasMatch[2], cols: aliasMatch[3].split(",").map((s) => s.trim()) });
    } else if (plainMatch) {
      embeds.push({ alias: plainMatch[1], table: plainMatch[1], cols: plainMatch[2].split(",").map((s) => s.trim()) });
    } else {
      parts.push(part);
    }
  }
  return { cols: parts.join(","), embeds };
}

function project(row, select) {
  const { cols, embeds } = parseSelect(select);
  if (embeds.length === 0) return { ...row };
  return embed(row, null, embeds);
}

// ── Request handling ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, "http://x");
  const path = urlObj.pathname;
  const query = parseQuery(req.url);

  try {
    // ── Auth admin endpoints ────────────────────────────────────────
    if (path === "/auth/v1/admin/users" && req.method === "GET") {
      return send(res, 200, { users: db.users.map((u) => ({ ...u })) });
    }
    if (path === "/auth/v1/admin/users" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const existing = db.users.find(
        (u) => u.email?.toLowerCase() === body.email?.toLowerCase(),
      );
      if (existing) return send(res, 422, { msg: "already registered" });
      const user = {
        id: uuid(),
        email: body.email,
        email_confirmed_at: body.email_confirm ? new Date().toISOString() : null,
        user_metadata: body.user_metadata ?? {},
        created_at: new Date().toISOString(),
      };
      db.users.push(user);
      return send(res, 201, { user });
    }

    // ── PostgREST table endpoints ───────────────────────────────────
    const table = path.match(/^\/rest\/v1\/([\w]+)$/)?.[1];
    if (!table || !(table in db)) return send(res, 404, { message: "not found" });

    const prefer = (req.headers.prefer ?? "").toLowerCase();
    const wantRep = prefer.includes("representation");
    const objectAccept = (req.headers.accept ?? "").includes("vnd.pgrst.object");

    if (req.method === "GET") {
      let rows = filterRows(db[table], query);
      rows = orderRows(rows, query.order);
      if (query.limit) rows = rows.slice(0, Number(query.limit));
      const select = query.select ?? "*";
      rows = rows.map((r) => project(r, select));
      if (objectAccept) {
        if (rows.length !== 1) {
          return send(res, 406, { code: "PGRST116", message: "cannot produce exactly one row" });
        }
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows);
    }

    if (req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "[]");
      const rows = Array.isArray(body) ? body : [body];
      const conflictCol = query.on_conflict ?? null;
      const created = [];
      for (const r of rows) {
        if (conflictCol && prefer.includes("merge-duplicates")) {
          const cols = conflictCol.split(",");
          const existing = db[table].find((x) =>
            cols.every((c) => String(x[c]) === String(r[c])),
          );
          if (existing) {
            Object.assign(existing, r);
            created.push(existing);
            continue;
          }
        }
        const row = { ...r };
        if (!row.id) row.id = uuid();
        if (!row.created_at) row.created_at = new Date().toISOString();
        db[table].push(row);
        created.push(row);
      }
      if (!wantRep) return send(res, 201);
      const out = created.map((r) => ({ ...r }));
      if (objectAccept) {
        if (out.length !== 1) return send(res, 406, { code: "PGRST116" });
        return send(res, 201, out[0]);
      }
      return send(res, 201, out);
    }

    if (req.method === "PATCH") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const rows = filterRows(db[table], query);
      for (const r of rows) Object.assign(r, body);
      if (!wantRep) return send(res, 204);
      const out = rows.map((r) => ({ ...r }));
      if (objectAccept) {
        if (out.length !== 1) return send(res, 406, { code: "PGRST116" });
        return send(res, 200, out[0]);
      }
      return send(res, 200, out);
    }

    if (req.method === "DELETE") {
      const rows = filterRows(db[table], query);
      db[table] = db[table].filter((r) => !rows.includes(r));
      return send(res, 204);
    }

    return send(res, 405, { message: "method not allowed" });
  } catch (err) {
    return send(res, 500, { message: String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-supabase listening on http://127.0.0.1:${PORT}`);
});
