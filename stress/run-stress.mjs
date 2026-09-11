/**
 * Sufra end-to-end + stress + security suite.
 *
 * Runs against a REAL production Next.js server (npm run start) backed by the
 * in-memory mock Supabase (stress/mock-supabase.mjs).
 *
 * Usage:
 *   node stress/run-stress.mjs [baseUrl] [--quick]
 *
 * Default baseUrl: http://127.0.0.1:3000
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const QUICK = process.argv.includes("--quick");

// ── Tiny harness ────────────────────────────────────────────────────
const results = [];
let currentSection = "";
function section(name) {
  currentSection = name;
  console.log(`\n━━━ ${name} ━━━`);
}
function check(name, pass, detail = "") {
  results.push({ section: currentSection, name, pass, detail });
  console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function info(msg) {
  console.log(`  ℹ️  ${msg}`);
}

const jsonHeaders = { "content-type": "application/json" };

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, ms: 0 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fixtures ────────────────────────────────────────────────────────
const uid = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CATS = [
  { id: uid(1), name: "Coffees", position: 0 },
  { id: uid(2), name: "Pastries", position: 1 },
];
const PRODUCTS = [
  { id: uid(11), categoryId: uid(1), name: "Espresso", description: "short shot", price: 2.5, imageUrl: null, isAvailable: true },
  { id: uid(12), categoryId: uid(1), name: "Cappuccino", description: "", price: 3.8, imageUrl: null, isAvailable: true },
  { id: uid(13), categoryId: uid(2), name: "Croissant", description: "butter", price: 2.2, imageUrl: null, isAvailable: false },
];
function menuPayload(overrides = {}) {
  return {
    restaurant: {
      name: "Stress Café",
      slug: "stress-cafe",
      tagline: "under pressure",
      businessType: "cafe",
      logoUrl: null,
      coverUrl: null,
      primaryColor: "#D97706",
      theme: "classic",
      isPublished: true,
    },
    categories: CATS,
    products: PRODUCTS,
    tables: [
      { id: uid(21), number: 1, token: "toktable01" },
      { id: uid(22), number: 2, token: "toktable02" },
    ],
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// A. FUNCTIONAL — happy path
// ════════════════════════════════════════════════════════════════════
async function functional() {
  section("A. Functional — menu sync round-trip");

  let r = await api("/api/menu", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(menuPayload()),
  });
  check("PUT /api/menu (initial sync) succeeds", r.status === 200 && r.body.cloud === true, `status=${r.status}`);

  r = await api("/api/menu");
  check("GET /api/menu returns synced restaurant", r.body.source === "supabase" && r.body.restaurant?.name === "Stress Café");
  check("GET returns categories with positions", r.body.categories?.length === 2 && r.body.categories[0].position === 0);
  check("GET returns products with prices", r.body.products?.length === 3 && r.body.products[0].price === 2.5);
  check("GET returns both tables", r.body.tables?.length === 2);

  // guest page renders
  const page = await fetch(`${BASE}/menu/stress-cafe/toktable01`);
  const html = await page.text();
  check("Guest page /menu/stress-cafe/toktable01 renders 200", page.status === 200);
  check("Guest page contains restaurant name", html.includes("Stress Café"));
  check("Guest page hides unavailable product (Croissant)", !html.includes("Croissant"));

  r = await fetch(`${BASE}/menu/stress-cafe/wrongtoken`);
  check("Guest page with bad table token → 404", r.status === 404);
  r = await fetch(`${BASE}/menu/no-such-slug/toktable01`);
  check("Guest page with unknown slug → 404", r.status === 404);

  section("B. Functional — order lifecycle");

  r = await api("/api/orders", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      slug: "stress-cafe",
      tableToken: "toktable01",
      items: [
        { productId: uid(11), name: "Espresso", price: 2.5, qty: 2 },
        { productId: uid(12), name: "Cappuccino", price: 3.8, qty: 1 },
      ],
    }),
  });
  check("POST order → 200 cloud:true", r.status === 200 && r.body.cloud === true);
  check("First order gets number 1001", r.body.order?.number === 1001, `got ${r.body.order?.number}`);
  check("Order total computed (2×2.5 + 3.8 = 8.8)", Math.abs(r.body.order?.total - 8.8) < 1e-9, `got ${r.body.order?.total}`);
  const orderId = r.body.order?.id;
  const orderNumber = r.body.order?.number;

  r = await api("/api/orders");
  const listed = r.body.orders?.find((o) => o.id === orderId);
  check("GET /api/orders lists the new order", Boolean(listed));
  check("Listed order carries items + table", listed?.items?.length === 2 && listed?.table === 1);

  r = await api(`/api/orders/${orderId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ status: "accepted", acceptedBy: "w1", acceptedByName: "Amine" }),
  });
  check("PATCH accept → 200", r.status === 200);
  r = await api(`/api/orders/${orderId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ isPaid: true }),
  });
  check("PATCH pay → 200", r.status === 200);
  r = await api("/api/orders");
  const paid = r.body.orders?.find((o) => o.id === orderId);
  check("Order is paid + accepted afterwards", paid?.isPaid === true && paid?.status === "accepted" || paid?.status === "paid", `status=${paid?.status} isPaid=${paid?.isPaid}`);

  section("C. Functional — reconcile (deletes)");

  r = await api("/api/menu", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(menuPayload({
      categories: [CATS[0]],
      products: PRODUCTS.slice(0, 2),
      tables: [{ id: uid(21), number: 1, token: "toktable01" }],
    })),
  });
  check("PUT with shrunk payload succeeds", r.status === 200 && r.body.cloud === true);
  r = await api("/api/menu");
  check("Removed category gone", r.body.categories?.length === 1);
  check("Products of removed category deleted (cascade)", r.body.products?.length === 2, `got ${r.body.products?.length}`);
  check("Removed table gone", r.body.tables?.length === 1);

  section("D. Functional — menu scan route (no key configured)");
  r = await api("/api/menu/scan", { method: "POST", body: new FormData() });
  check("Scan with 0 files → 400 TOO_MANY_FILES", r.status === 400 && r.body.error === "TOO_MANY_FILES", `status=${r.status} error=${r.body.error}`);
  const fd = new FormData();
  fd.append("files", new File(["x"], "a.png", { type: "text/plain" }));
  r = await api("/api/menu/scan", { method: "POST", body: fd });
  check("Scan with bad mime → 422 BAD_TYPE", r.status === 422 && r.body.error === "BAD_TYPE", `status=${r.status} error=${r.body.error}`);
  const fd2 = new FormData();
  fd2.append("files", new File([new Uint8Array(1000)], "a.png", { type: "image/png" }));
  r = await api("/api/menu/scan", { method: "POST", body: fd2 });
  check("Scan without MISTRAL key → 503 NO_KEY", r.status === 503 && r.body.error === "NO_KEY", `status=${r.status} error=${r.body.error}`);
}

// ════════════════════════════════════════════════════════════════════
// E. SECURITY
// ════════════════════════════════════════════════════════════════════
async function security() {
  section("E. Security — price tampering (client-trusted prices)");

  let r = await api("/api/orders", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      slug: "stress-cafe",
      tableToken: "toktable01",
      items: [{ productId: uid(11), name: "Espresso", price: 0, qty: 5 }],
    }),
  });
  check("❌ CRITICAL: order with price=0 accepted (expected: recompute server-side)",
    r.status === 200 && r.body.order?.total === 0,
    `status=${r.status} total=${r.body.order?.total} — a guest can order 5 coffees for free`);

  r = await api("/api/orders", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      slug: "stress-cafe",
      tableToken: "toktable01",
      items: [{ productId: uid(11), name: "Espresso", price: -10, qty: 3 }],
    }),
  });
  check("❌ CRITICAL: NEGATIVE price accepted",
    r.status === 200,
    `status=${r.status} total=${r.body.order?.total} — attacker manipulates balances/revenue stats`);

  r = await api("/api/orders", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      slug: "stress-cafe",
      tableToken: "toktable01",
      items: [{ productId: uid(11), name: "Espresso", price: "2.5", qty: 2 }], // string price
    }),
  });
  const weirdTotal = r.body.order?.total;
  check("❌ String price '2.5' → total becomes NaN/invalid",
    !(typeof weirdTotal === "number" && Number.isFinite(weirdTotal)),
    `total=${JSON.stringify(weirdTotal)} — no type validation on items`);

  r = await api("/api/orders", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      slug: "stress-cafe",
      tableToken: "toktable01",
      items: [{ productId: uid(11), name: "Espresso", price: 2.5, qty: -4 }],
    }),
  });
  check("❌ Negative quantity accepted", r.status === 200, `total=${r.body.order?.total}`);

  r = await api("/api/orders", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      slug: "stress-cafe",
      tableToken: "toktable01",
      items: [{ productId: uid(99), name: "Ghost item", price: 1, qty: 1 }], // non-existent product
    }),
  });
  check("⚠️ Order item referencing non-existent product accepted", r.status === 200, "productId is never validated against the menu");

  section("F. Security — no authentication anywhere");

  r = await api("/api/menu", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(menuPayload({
      restaurant: { ...menuPayload().restaurant, name: "HACKED CAFÉ", slug: "stress-cafe" },
    })),
  });
  check("❌ CRITICAL: anonymous PUT /api/menu overwrites the restaurant", r.status === 200 && r.body.cloud === true,
    "anyone who finds the URL owns the menu — no auth/session check of any kind");

  r = await api("/api/menu");
  check("Confirmed: menu now serves attacker's name", r.body.restaurant?.name === "HACKED CAFÉ");

  // restore
  await api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify(menuPayload()) });

  r = await api("/api/orders");
  const anyOrder = r.body.orders?.[0];
  if (anyOrder) {
    r = await api(`/api/orders/${anyOrder.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ isPaid: true }) });
    check("❌ Anonymous PATCH marks any order paid (no worker auth)", r.status === 200, "workers/roles are client-side fiction — server accepts anyone");
  }

  r = await api("/api/orders");
  check("❌ Anonymous GET /api/orders exposes full order feed", r.body.cloud === true && Array.isArray(r.body.orders),
    "fine for LAN demo, unacceptable for a public deployment");

  section("G. Security — injection & stored XSS payloads");

  const xssName = '<script>alert(1)</script><img src=x onerror=alert(2)>Zinger';
  r = await api("/api/menu", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(menuPayload({
      products: [{ id: uid(31), categoryId: uid(1), name: xssName, description: '"><svg onload=alert(3)>', price: 9, imageUrl: null, isAvailable: true }],
      categories: [{ id: uid(1), name: "Coffees", position: 0 }],
    })),
  });
  check("PUT with XSS-laden product stored (no validation)", r.status === 200);

  const page = await fetch(`${BASE}/menu/stress-cafe/toktable01`);
  const html = await page.text();
  const rawScript = html.includes("<script>alert(1)</script>");
  check(rawScript ? "❌ Raw <script> tag reaches guest page HTML (React escaped most, but verify)" : "React escapes XSS in RSC payload (no executable <script> injected)", !rawScript,
    rawScript ? "stored XSS executes" : "payload appears only as escaped text");

  // javascript: URL in cover image
  r = await api("/api/menu", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(menuPayload({
      restaurant: { ...menuPayload().restaurant, coverUrl: 'javascript:alert(1)' },
    })),
  });
  const page2 = await fetch(`${BASE}/menu/stress-cafe/toktable01`);
  const html2 = await page2.text();
  check("javascript: URL in cover accepted by API", r.status === 200,
    html2.includes("javascript:alert(1)") ? "and flows into the page HTML as an <img src>/style URL" : "not reflected in guest page");
  await api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify(menuPayload()) });

  section("H. Input validation / robustness (looking for 500s)");

  r = await api("/api/orders", { method: "POST", headers: jsonHeaders, body: "{not json" });
  check("Malformed JSON order → 400 (not 500)", r.status === 400, `status=${r.status}`);

  r = await api("/api/orders", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ slug: "stress-cafe" }) });
  check("Missing items → 400", r.status === 400, `status=${r.status}`);

  r = await api("/api/orders", { method: "POST", headers: jsonHeaders, body: JSON.stringify(null) });
  check("null body → 400", r.status === 400, `status=${r.status}`);

  r = await api("/api/orders", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ slug: { $gt: "" }, tableToken: { $ne: null }, items: [] }) });
  check("NoSQL-style objects in slug/token → no crash", r.status !== 500, `status=${r.status}`);

  r = await api("/api/orders", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ slug: "stress-cafe", tableToken: "toktable01", items: [] }) });
  check("Empty items array → 400", r.status === 400, `status=${r.status}`);

  r = await api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ categories: [] }) });
  check("PUT /api/menu without restaurant object → graceful 4xx? (currently 500 = unhandled TypeError)", r.status < 500, `status=${r.status} — server throws on r.theme of undefined`);

  r = await api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ restaurant: menuPayload().restaurant, categories: null, products: null, tables: null }) });
  check("PUT /api/menu with null arrays → graceful 4xx? (currently 500)", r.status < 500, `status=${r.status} — .map of null throws`);

  r = await api("/api/orders", { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ status: "accepted" }) });
  check("PATCH non-existent order id route /api/orders/ (no id)", r.status !== 500, `status=${r.status}`);
}

// ════════════════════════════════════════════════════════════════════
// I. CONCURRENCY / RACES
// ════════════════════════════════════════════════════════════════════
async function concurrency() {
  section("I. Concurrency — daily order number race");

  const N = QUICK ? 20 : 40;
  const payload = JSON.stringify({
    slug: "stress-cafe",
    tableToken: "toktable01",
    items: [{ productId: uid(11), name: "Espresso", price: 2.5, qty: 1 }],
  });
  const t0 = Date.now();
  const resps = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(`${BASE}/api/orders`, { method: "POST", headers: jsonHeaders, body: payload }),
    ),
  );
  const bodies = await Promise.all(resps.map((r) => r.json()));
  const ok = bodies.filter((b) => b.cloud).map((b) => b.order.number);
  const dupes = ok.length - new Set(ok).size;
  const ms = Date.now() - t0;
  check(`${N} concurrent orders: ${ok.length} succeeded in ${ms}ms`, ok.length === N);
  check(
    dupes === 0 ? "No duplicate order numbers (lucky run)" : `❌ RACE CONFIRMED: ${dupes} duplicate daily order numbers`,
    dupes === 0,
    dupes > 0
      ? "read-then-insert of daily_order_number is not atomic — two tables can print the same ticket number"
      : "races are timing-dependent — the code path is still read-then-insert (check under real DB load)",
  );

  section("J. Concurrency — parallel menu writes (last-writer-wins)");

  const deviceA = menuPayload({ categories: [CATS[0]], products: [PRODUCTS[0]] });
  const deviceB = menuPayload({ categories: [CATS[1]], products: [PRODUCTS[2]] });
  const [ra, rb] = await Promise.all([
    api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify(deviceA) }),
    api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify(deviceB) }),
  ]);
  const after = await api("/api/menu");
  const merged = after.body.categories?.length === 2;
  check(
    merged ? "Concurrent PUTs merged" : "❌ Concurrent PUTs: one device's categories silently deleted",
    merged,
    `final categories=${after.body.categories?.map((c) => c.name).join(",")} — full-replace sync loses data when two devices edit at once`,
  );
  // restore
  await api("/api/menu", { method: "PUT", headers: jsonHeaders, body: JSON.stringify(menuPayload()) });
}

// ════════════════════════════════════════════════════════════════════
// K. LOAD / STRESS
// ════════════════════════════════════════════════════════════════════
async function load() {
  section("K. Load — sustained mixed traffic");

  const CONC = QUICK ? 8 : 25;
  const TOTAL = QUICK ? 300 : 2000;
  const paths = ["/", "/api/menu", "/api/orders", "/dashboard", "/menu/stress-cafe/toktable01", "/onboarding"];
  const lat = [];
  let errors = 0;
  let status429 = 0;
  let done = 0;
  const t0 = Date.now();

  async function worker() {
    while (done < TOTAL) {
      done++;
      const p = paths[Math.floor(Math.random() * paths.length)];
      const s = Date.now();
      try {
        const res = await fetch(`${BASE}${p}`);
        await res.arrayBuffer();
        const d = Date.now() - s;
        lat.push(d);
        if (res.status >= 500) errors++;
        if (res.status === 429) status429++;
      } catch {
        errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.floor((q / 100) * lat.length)] ?? lat[lat.length - 1];
  const rps = (TOTAL / (Date.now() - t0) * 1000).toFixed(0);

  info(`${TOTAL} requests, concurrency ${CONC}: ${rps} req/s, p50=${p(50)}ms p95=${p(95)}ms p99=${p(99)}ms max=${lat[lat.length - 1]}ms`);
  check(`No 5xx under mixed load (got ${errors})`, errors === 0);
  check("No rate limiting kicked in (informational)", status429 === 0, "the app has NO rate limiting on any endpoint");

  section("L. Load — order flood (spam test)");

  const floodN = QUICK ? 100 : 400;
  const t1 = Date.now();
  const batch = Array.from({ length: floodN }, (_, i) =>
    fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        slug: "stress-cafe",
        tableToken: "toktable01",
        items: [{ productId: uid(11), name: "Espresso", price: 2.5, qty: 1 + (i % 3) }],
      }),
    }).then((r) => r.status),
  );
  const statuses = await Promise.all(batch);
  const okCount = statuses.filter((s) => s === 200).length;
  const ms1 = Date.now() - t1;
  info(`${floodN} orders created in ${ms1}ms (${(floodN / (ms1 / 1000)).toFixed(0)} orders/s) — all accepted, zero friction`);
  check(`All ${floodN} spam orders accepted (no rate limit / captcha / cap)`, okCount === floodN,
    "a prankster with the QR URL can flood the dashboard with thousands of fake tickets");

  const t2 = Date.now();
  const dash = await api("/api/orders");
  const dashMs = Date.now() - t2;
  info(`GET /api/orders with ${floodN + 40} orders: ${dashMs}ms, payload ${JSON.stringify(dash.body).length} bytes, returns ${dash.body.orders?.length} orders (limit 60)`);
  check("Dashboard payload capped at 60 orders", dash.body.orders?.length === 60, "older orders invisible in UI (and stats only see these 60)");

  const t3 = Date.now();
  await fetch(`${BASE}/menu/stress-cafe/toktable01`);
  info(`Guest menu page renders in ${Date.now() - t3}ms with ${dash.body.orders?.length}+ live orders (unaffected — good)`);
  check("Guest page stays fast under order pressure", Date.now() - t3 < 1500);
}

// ════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\nSUFRÁ STRESS SUITE → ${BASE} ${QUICK ? "(quick mode)" : ""}`);
  try {
    await api("/api/menu");
  } catch {
    console.error(`Server not reachable at ${BASE}. Start it first.`);
    process.exit(1);
  }
  await functional();
  await security();
  await concurrency();
  await load();

  // ── Summary ───────────────────────────────────────────────────────
  console.log("\n════════════════════ SUMMARY ════════════════════");
  const failed = results.filter((r) => !r.pass);
  const critical = failed.filter((r) => r.name.includes("CRITICAL"));
  console.log(`Total checks: ${results.length}  passed: ${results.length - failed.length}  failed: ${failed.length}  (critical: ${critical.length})`);
  for (const f of failed) {
    console.log(`  ❌ [${f.section}] ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
