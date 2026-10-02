/**
 * HTTP-layer smoke test.
 *
 * Boots the Express app on an ephemeral port with a deliberately unreachable
 * DATABASE_URL and exercises the behaviour that must hold in production without
 * needing a real database or a running chain:
 *
 *   - the built SPA is served, and deep links fall back to it
 *   - hashed assets are served with the correct content type and caching
 *   - Helmet's security headers are present
 *   - CORS allows same-origin (including POST) and refuses foreign origins
 *   - unknown /api paths return JSON, not an HTML page
 *   - rate-limit headers are emitted
 *   - malformed input returns 400 and oversized bodies return 413
 *
 * Run with:  pnpm run test:http
 *
 * The DATABASE_URL below is never contacted: the pg pool connects lazily, and
 * the endpoints exercised here do not query. No secret is involved.
 */

const APP_ENTRY = "../src/app.ts";

process.env.NODE_ENV ??= "production";
process.env.DATABASE_URL ??= "postgresql://smoke:smoke@127.0.0.1:59999/smoke";
// A throwaway value satisfying the production length rule.
process.env.JWT_SECRET ??= "smoke-test-only-secret-not-a-real-credential";

const { default: app } = await import(APP_ENTRY);
const { workspaceRoot, resolveContractArtifactPath, resolveFrontendDistDir } =
  await import("../src/lib/paths.ts");
const { bootstrapSchemaSql } = await import(
  "../../../lib/db/src/schema-sql.ts"
);
const schema = await import("../../../lib/db/src/schema/supply-chain.ts");
const { getTableColumns } = await import("drizzle-orm");

const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -> ${detail}` : ""}\n`,
  );
  if (!ok) failures.push(label);
}

// --- bootstrap DDL must stay in step with the Drizzle schema ---------------
// The project has no migration files, so the hand-written `CREATE TABLE IF NOT
// EXISTS` statements are the only thing that provisions a fresh database. If a
// column is renamed in the Drizzle schema and not here, every query against a
// newly deployed database fails at runtime. This compares them directly.
function ddlColumnsFor(tableName: string): string[] {
  const match = bootstrapSchemaSql.match(
    new RegExp(
      `CREATE TABLE IF NOT EXISTS "${tableName}"\\s*\\(([\\s\\S]*?)\\n\\);`,
    ),
  );
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .map((line) => line.match(/^"([a-z0-9_]+)"/)?.[1])
    .filter((name): name is string => Boolean(name));
}

const TABLES = [
  ["supply_chain_users", schema.usersTable],
  ["supply_chain_products", schema.productsTable],
  ["supply_chain_events", schema.eventsTable],
] as const;

for (const [tableName, table] of TABLES) {
  const drizzleColumns = Object.values(getTableColumns(table))
    .map((column) => column.name)
    .sort();
  const ddlColumns = ddlColumnsFor(tableName).sort();
  const missingInDdl = drizzleColumns.filter((c) => !ddlColumns.includes(c));
  const extraInDdl = ddlColumns.filter((c) => !drizzleColumns.includes(c));

  check(
    `${tableName}: every Drizzle column exists in the bootstrap DDL`,
    missingInDdl.length === 0,
    missingInDdl.length ? `missing: ${missingInDdl.join(", ")}` : "",
  );
  check(
    `${tableName}: the bootstrap DDL has no unknown columns`,
    extraInDdl.length === 0,
    extraInDdl.length ? `extra: ${extraInDdl.join(", ")}` : "",
  );
}

check(
  "events table declares the ON DELETE CASCADE foreign key",
  /"product_id" text NOT NULL REFERENCES "supply_chain_products" \("product_id"\) ON DELETE CASCADE/.test(
    bootstrapSchemaSql,
  ),
);

process.stdout.write(`workspaceRoot = ${workspaceRoot}\n`);

// --- path resolution must work from src/ as well as from the bundled dist/ ---
check("workspaceRoot resolves to the repo root", workspaceRoot.endsWith("Blockchain-Supply-Chain"));
try {
  check("contract artifact resolves", resolveContractArtifactPath().endsWith("SupplyChain.json"));
} catch {
  check("contract artifact resolves", false, "artifact missing - run pnpm run chain:compile");
}
const distDir = resolveFrontendDistDir();
check(
  "frontend build is discoverable",
  Boolean(distDir),
  distDir ?? "undefined - run pnpm run build",
);

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address() as { port: number };
const base = `http://127.0.0.1:${port}`;

async function probe(pathname: string, init?: RequestInit) {
  const response = await fetch(`${base}${pathname}`, init);
  return { response, body: await response.text() };
}

const root = await probe("/");
check("GET / serves the SPA", root.response.status === 200, `status=${root.response.status}`);
check(
  "GET / returns HTML",
  /text\/html/.test(root.response.headers.get("content-type") ?? ""),
);

const deepLink = await probe("/verify/some-product-123");
check(
  "GET /verify/:id falls back to the SPA",
  deepLink.response.status === 200 && /text\/html/.test(deepLink.response.headers.get("content-type") ?? ""),
  `status=${deepLink.response.status}`,
);

const assetMatch = root.body.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
check("index.html references a hashed JS asset", Boolean(assetMatch), assetMatch?.[0] ?? "none found");
if (assetMatch) {
  const asset = await probe(assetMatch[0]);
  check("hashed asset is served", asset.response.status === 200, `status=${asset.response.status}`);
  check("asset has a JavaScript content type", /javascript/.test(asset.response.headers.get("content-type") ?? ""));
  check(
    "asset is immutably cacheable",
    /max-age=31536000|immutable/.test(asset.response.headers.get("cache-control") ?? ""),
    asset.response.headers.get("cache-control") ?? "none",
  );
}

check("helmet sets X-Content-Type-Options", root.response.headers.get("x-content-type-options") === "nosniff");
check("helmet sets X-Frame-Options", root.response.headers.get("x-frame-options") !== null, root.response.headers.get("x-frame-options") ?? "missing");
check("helmet sets a Content-Security-Policy", root.response.headers.get("content-security-policy") !== null);
check("helmet sets Referrer-Policy", root.response.headers.get("referrer-policy") !== null, root.response.headers.get("referrer-policy") ?? "missing");

const noOrigin = await probe("/api/healthz");
const foreignOrigin = await probe("/api/healthz", {
  headers: { origin: "https://evil.example.com" },
});
const selfOrigin = await probe("/api/healthz", { headers: { origin: base } });
check(
  "no CORS header without an Origin request header",
  noOrigin.response.headers.get("access-control-allow-origin") === null,
);
check(
  "no CORS header for an unlisted origin",
  foreignOrigin.response.headers.get("access-control-allow-origin") === null,
  foreignOrigin.response.headers.get("access-control-allow-origin") ?? "none",
);
check(
  "CORS allows this server's own origin",
  selfOrigin.response.headers.get("access-control-allow-origin") === base,
  selfOrigin.response.headers.get("access-control-allow-origin") ?? "none",
);

const unknownApi = await probe("/api/definitely-not-a-route");
check(
  "unknown /api route returns JSON, not HTML",
  unknownApi.response.status === 404 &&
    /application\/json/.test(unknownApi.response.headers.get("content-type") ?? ""),
  `status=${unknownApi.response.status}`,
);

const spaRoute = await probe("/track");
check(
  "non-API deep route still reaches the SPA",
  /text\/html/.test(spaRoute.response.headers.get("content-type") ?? ""),
  `status=${spaRoute.response.status}`,
);

const rateLimit = unknownApi.response.headers.get("ratelimit") ?? "";
check("API emits a RateLimit header", rateLimit !== "", rateLimit);
check(
  "RateLimit header carries limit and remaining",
  /limit=\d+/.test(rateLimit) && /remaining=\d+/.test(rateLimit),
  rateLimit,
);

const badLogin = await probe("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: "not-an-email" }),
});
check("malformed login returns 400", badLogin.response.status === 400, `status=${badLogin.response.status}`);
check(
  "same-origin login is not blocked by CORS",
  badLogin.response.headers.get("access-control-allow-origin") === base,
  badLogin.response.headers.get("access-control-allow-origin") ?? "none",
);

const oversized = await probe("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: "a@b.com", password: "x".repeat(2_000_000) }),
});
check("oversized body keeps its 413 status", oversized.response.status === 413, `status=${oversized.response.status}`);

server.close();

process.stdout.write(
  `\n${failures.length === 0 ? "ALL HTTP CHECKS PASSED" : `FAILURES (${failures.length}): ${failures.join(", ")}`}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);