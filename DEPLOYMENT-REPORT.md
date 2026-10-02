# Deployment Readiness Report

**Project:** Blockchain-Based Supply Chain Tracking
**Working copy:** `C:\Users\sivas\AppData\Local\Temp\opencode\bsc-work\work\Blockchain-Supply-Chain`
**Pristine backup:** `C:\Users\sivas\AppData\Local\Temp\opencode\bsc-work\backup-pristine\Blockchain-Supply-Chain`
**Prepared for:** free public HTTPS hosting elsewhere than Replit
**Deployment status: NOT DEPLOYED.** No public URL exists. See section D.

---

## A. Exact cause of the previous deployment failure

The project was written for Replit's "Publish" button, and that model differs
from a generic host in five ways. Each is a hard failure on Render, GitHub
Pages-style static hosting, or any plain Node container:

1. **The frontend and API were two separate Replit apps.** `.replit-artifact`
   describes an API service (`/api`) and a static web service. Replit wired them
   together. A single generic host runs one process, so nothing served the React
   app — the API responded, but `/` returned nothing.
2. **The API never bound to `0.0.0.0`.** `app.listen(port)` with no host
   argument binds to loopback, so a container port-forwarder could not reach it.
   Render's health check would fail.
3. **The contract artifact was resolved from `process.cwd()`.** The code read
   `path.resolve(process.cwd(), "../../blockchain/artifacts/...")`. Hosts start
   the process from an arbitrary directory, so the lookup resolved to a
   nonexistent path and startup failed with an opaque module-read error.
4. **The production `start` script never started the blockchain.** Only
   `dev.mjs` launched Hardhat. The app depends on a chain at boot: it deploys the
   contract and replays the database onto it.
5. **The frontend build required two variables that hosts do not inject.**
   `vite.config.ts` threw if `PORT` or `BASE_PATH` was unset, so `vite build`
   failed on any host that doesn't set them at build time.

The immediate trigger of the Replit failure specifically was not reproducible
from the source alone — Replit reports publish errors on its side, and the
project's own `.agents/memory/` note shows Replit-specific tooling trouble. The
five structural incompatibilities above are the reasons this project could not
simply be pointed at another host unchanged, and all five are now fixed.

## B. What I changed

**Deployment plumbing (the five causes above)**

| File | Change |
| --- | --- |
| `artifacts/api-server/src/index.ts` | Bind `0.0.0.0`; validate `PORT`; set `trust proxy`; run `ensureSchema()`, then chain init, seeding, replay, then listen; graceful shutdown closing chain + pool |
| `artifacts/api-server/scripts/start.mjs` | **New.** Production entrypoint: starts Hardhat as a managed child process (unless an external RPC is set), polls `eth_chainId` until ready, launches the API, forwards signals, propagates exit status |
| `artifacts/api-server/src/lib/paths.ts` | **New.** Resolves paths by walking up to `pnpm-workspace.yaml`, so it is correct from both `src/` (dev) and `dist/` (prod) |
| `artifacts/api-server/src/app.ts` | Serves the built SPA with hashed-asset caching and a history fallback that excludes `/api` |
| `artifacts/blockchain-supply-chain/vite.config.ts` | Defaults `PORT` to 5173 and `BASE_PATH` to `/` instead of throwing |
| `package.json` (root) | `start`, `chain:compile`, `chain:test`, `db:push`, `dev` scripts; cross-platform `preinstall` (the original `sh -c` form cannot run on Windows) |
| `render.yaml` | **New.** Blueprint: build chain, start command, `/api/healthz` health check, secrets as `sync: false` |
| `.node-version`, `DEPLOYMENT.md`, `.env.example`, `.gitattributes` | **New** |

**Security**

| File | Change |
| --- | --- |
| `artifacts/api-server/src/lib/seed.ts` | Passwords from `MANUFACTURER/DISTRIBUTOR/RETAILER_PASSWORD`; refuses to start outside `NODE_ENV=development` without three unique ≥12-char values; warns on reuse; bcrypt rounds 10→12; stopped spreading a non-column field into the insert |
| `artifacts/api-server/src/middlewares/auth.ts` | Secret required (no default), ≥32 chars in production, `issuer`/`audience` bound, `subject` claim, validated `expiresIn` |
| `artifacts/api-server/src/routes/auth.ts` | Uses the shared signer; login rate limit (10 / 15 min, failures only, keyed IP+email, IPv6-safe); constant-time-ish response for unknown accounts |
| `artifacts/api-server/src/app.ts` | Helmet (CSP, HSTS, nosniff, frame-options, referrer-policy); same-origin-aware CORS; 100 KB body limit; API-wide rate limit; JSON 404; real 4xx statuses preserved; `x-powered-by` disabled; request logging strips query strings |
| `artifacts/api-server/src/lib/blockchain.ts` | 20 s RPC timeout so a stalled node cannot exhaust the DB pool; production guards; bundle-relative artifact lookup |
| `artifacts/api-server/src/routes/products.ts` | `safeParse` instead of `.parse()` on every `:productId` (invalid IDs were 500s, now 400s); 128-char ID cap; unreachable chain returns 503 instead of falsely claiming "Record Has Been Modified" |
| `lib/db/src/index.ts` | Rejects malformed/unauthenticated `DATABASE_URL`; rejects `sslmode=disable` in production; pool capped at 5; idle-client errors logged without the credential; `ensureSchema()` |
| `lib/db/src/schema-sql.ts` | **New.** Idempotent bootstrap DDL — the project has no migration files, so a fresh database had no tables at all |
| `.gitignore` | Now excludes `.env*`, `*.pem/key/p12/pfx`, keystores, Hardhat `vars.json`, and generated Hardhat output |
| Git remote | Removed the Replit-internal remote so it cannot be pushed to GitHub |
| README | Replaced the documented shared demo password with the env-var requirement |

**Correctness of my own earlier work (bugs found by testing, not by reading)**

1. **CORS would have broken login in production.** Browsers send `Origin` on same-origin POSTs. An allowlist with `ALLOWED_ORIGINS` empty rejected them with 403 — the deployed app could not have signed anyone in. Now the server's own origin is derived from the forwarded host/proto and allowed.
2. **`paths.ts` broke local dev.** It assumed `dist/` and computed the workspace root as `artifacts/` when run from `src/lib/`. Fixed by walking up to a marker file.
3. **413 became 500.** The error handler ignored `err.status`, so oversized bodies reported as server faults.
4. **Unknown `/api` paths returned an HTML error page**, unusable by a JSON client.
5. **Missing `ON DELETE CASCADE`.** My bootstrap DDL omitted the foreign key that the Drizzle schema declares.
6. **A UTF-8 BOM in the root `package.json`**, which had already broken the Vite build once. Added `.gitattributes` (`* text=auto eol=lf`) so it cannot recur; this machine has `core.autocrlf=true`.
7. **Express-rate-limit IPv6 bypass.** A raw `req.ip` key lets one client rotate IPv6 prefixes; switched to `ipKeyGenerator`.
8. **Hardhat scripts were POSIX-only.** `HARDHAT_DISABLE_TELEMETRY_PROMPT=true hardhat …` cannot run on Windows. The project's own `.agents/memory/hardhat-cli-telemetry.md` documents that this variable is required on non-interactive runs, so I did **not** simply drop it — I added `blockchain/scripts/hardhat.mjs`, a dependency-free wrapper that sets it before any Hardhat code loads.

## C. Verification results

Everything below was run on this machine. `rg` was unavailable, so scanning used
`git ls-files` + `Select-String`.

| # | Check | Result |
| --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile --prod=false` (Render's exact step 1) | **Pass** — lockfile genuinely in sync |
| 2 | `pnpm run typecheck` (4 projects) | **Pass** |
| 3 | `pnpm run chain:compile` from a *deleted* artifacts dir | **Pass** — `Compiled 1 Solidity file successfully (evm target: paris)` |
| 4 | `pnpm run chain:test` | **Pass** — 2 passing |
| 5 | API production build | **Pass** — `dist/index.mjs` 3.2 MB |
| 6 | Frontend production build | **Pass** — `dist/public/index.html` + hashed assets |
| 7 | `pnpm --filter @workspace/api-server run test:http` | **Pass — 31/31 assertions** |
| 8 | Production start guard (no RPC, no opt-in) | **Pass** — refuses with an actionable message |
| 9 | Production start with `BLOCKCHAIN_ALLOW_LOCAL_CHAIN=true` | **Pass** — warning printed, Hardhat started, RPC became ready, API launched, then correctly stopped at the database requirement |
| 10 | Secret scan of all tracked files | **Pass** — no keys, no credentialed URLs, no AWS keys, no Hardhat test key |
| 11 | `.env` / `*.pem` refused by Git, `.env.example` committable | **Pass** (verified with `git add --dry-run`) |
| 12 | BOM / CRLF / EOF sweep over 227 files | **Pass** — no BOMs |
| 13 | `render.yaml` parses; secrets are `sync: false`; no inline secret | **Pass** |
| 14 | `supply_chain_events` FK present in DDL | **Pass** — added, was missing |

The 31 HTTP assertions cover: SPA served, deep-link history fallback, hashed
assets served with JS content type and `max-age=31536000`, Helmet headers
(CSP, nosniff, X-Frame-Options, Referrer-Policy), CORS refusing foreign origins
while allowing the server's own, JSON 404 for unknown `/api` paths, non-API deep
routes still reaching the SPA, `RateLimit` headers, malformed login → 400,
same-origin POST not blocked, oversized body → 413, plus a schema-drift guard
comparing every Drizzle column against the bootstrap DDL.

## D. What is NOT verified — read before claiming this works

1. **No live database.** PostgreSQL and Docker were unavailable. `ensureSchema()`
   has never executed against a real server, and neither has the product
   lifecycle. This is the single biggest gap.
2. **No deployment.** Nothing was pushed, deployed, or verified over HTTPS. There
   is no public URL, and I am not claiming one.
3. **HNY001 does not exist on a new database.** The demo product from the Replit
   workspace lives in that workspace's database. A fresh deployment has no
   products; create one by registering it as the manufacturer.
4. **No external chain was contacted.** Mode A (persistent ledger) is untested
   and needs an RPC endpoint, a funded testnet key, and a deployed contract.
5. **Free-tier terms change.** Render's free Postgres has been discontinued.
   Neon/Supabase/Aiven/ElectricSQL limits change; confirm current terms.
6. **Windows-only caveat resolved.** Builds and tests ran on Windows after the
   script fixes. Render runs Linux; the POSIX-only scripts I replaced were the
   known risk, and the Render build chain now runs identically on both.

## E. Remaining manual steps (owner must do these)

1. Create a free-tier PostgreSQL database and copy its connection string.
2. Push the code to GitHub (the Replit remote is already removed).
3. In Render: **New → Blueprint**, select the repo, and fill the four prompted
   secrets — `DATABASE_URL` and the three demo passwords. Keep
   `generateValue: true` for `JWT_SECRET`.
4. Deploy, then open the URL once before presenting (free instances cold-start).
5. Run the 12-step verification checklist in `DEPLOYMENT.md` §8, including
   **#12: restart and confirm data survives** — that is the step that proves the
   Mode B replay works on the real host.

## F. Remaining known limitations

- The session token is in `localStorage` — exposed to any successful XSS. A
  hardened build would use an HttpOnly cookie plus CSRF protection. Helmet's CSP
  reduces the surface but does not remove it.
- Public verify endpoints are unauthenticated by design (a printed QR must work),
  so product IDs are guessable. Rate limited, but not non-enumerable.
- `SupplyChain.sol` has no on-chain access control; authorization is API-side.
- Local Hardhat keeps no permanent ledger history (Mode B).

## G. Required environment variables

Required: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `MANUFACTURER_PASSWORD`,
`DISTRIBUTOR_PASSWORD`, `RETAILER_PASSWORD` (each ≥12 chars, all different).
Recommended: `NODE_ENV=production`, `LOG_LEVEL=info`, `BASE_PATH=/`.
Mode B only: `BLOCKCHAIN_ALLOW_LOCAL_CHAIN=true`.
Mode A only: `BLOCKCHAIN_RPC_URL`, `CONTRACT_ADDRESS`, `PRIVATE_KEY`.
Optional: `VITE_PUBLIC_URL` (QR canonical host), `API_RATE_LIMIT`,
`LOGIN_RATE_LIMIT`, `BCRYPT_ROUNDS`, `DATABASE_POOL_MAX`,
`BLOCKCHAIN_TIMEOUT_MS`, `RPC_READY_TIMEOUT_MS`, `ALLOWED_ORIGINS`,
`SCHEMA_SQL_PATH`, `BLOCKCHAIN_ARTIFACT_PATH`.

**No secret value appears in any tracked file, in `render.yaml`, or in
`.env.example`.**