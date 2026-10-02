# Deployment guide

This document describes how to publish the Blockchain-Based Supply Chain
Tracking application to a public HTTPS URL at no cost, and states honestly what
has and has not been verified.

Read this before deploying. Two decisions in here have real consequences: the
**database** is external to the app, and the **blockchain** is either persistent
or ephemeral depending on which mode you choose.

---

## 1. What gets deployed

One service, not two.

The React frontend calls the API on relative `/api/...` URLs, so the compiled
frontend is served by the same Express process that exposes `/api`. This means:

- no CORS configuration is needed in the normal setup;
- one free instance instead of two;
- one hostname for both the app and the API.

```
Browser ──https──> Render free web service (Express)
                      ├── /api/...   -> JSON API
                      ├── /api/healthz -> health check
                      └── /*          -> built React SPA (history fallback)
                            │
                            ├── PostgreSQL (external, free tier)
                            └── EVM JSON-RPC (local Hardhat or external testnet)
```

---

## 2. Honest status of verification

| Area | Status |
| --- | --- |
| Typecheck (all 4 TS projects) | Passing |
| Contract compile from a clean checkout | Passing |
| Contract tests (2) | Passing |
| Frontend production build | Passing |
| API production build | Passing |
| HTTP layer: static serving, SPA fallback, security headers, CORS, rate limits, 400/413 handling (24 assertions) | Passing |
| Production start script: refuses without an explicit blockchain decision | Passing |
| Production start script: launches chain, waits for RPC, starts API | Passing |
| **Database connectivity and the full product lifecycle against a live database** | **Not verified — needs a real PostgreSQL instance** |
| **Public deployment on Render** | **Not performed — no deployment was made** |

The last two rows matter. A college demonstration can be run end-to-end once a
database exists; until then, do not describe the app as fully tested.

---

## 3. Prerequisites

- A GitHub repository holding this code. The Replit-only Git remote that shipped
  with the project has been removed.
- A free-tier managed **PostgreSQL** database.
- A Render account.

---

## 4. The database

The app stores all business data in PostgreSQL and **never writes to disk**, so
the database must be external and persistent. The container filesystem is wiped
on every redeploy and spin-down.

Render's own free Postgres offering has been discontinued, so use a third-party
free tier such as Neon, Supabase, Aiven, or ElectricSQL. Free tiers and their
limits change frequently — confirm the current terms yourself before relying on
one for a graded demonstration.

You need the full connection string, for example:

```
postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

The schema is created automatically on first boot by an idempotent bootstrap
(`CREATE TABLE IF NOT EXISTS`). There is no separate migration step to run, so a
brand-new empty database is all you need.

If you prefer Drizzle's own tooling instead, `pnpm run db:push` is also
available.

---

## 5. Environment variables

`.env.example` is the complete reference. For Render, set these in the
Dashboard under **Environment** and mark the secrets.

Required:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Secret. |
| `JWT_SECRET` | `generateValue: true` in `render.yaml` generates one. Must be ≥ 32 chars. |
| `MANUFACTURER_PASSWORD` | Demo account password. Must be ≥ 12 chars. |
| `DISTRIBUTOR_PASSWORD` | Must differ from the manufacturer password. |
| `RETAILER_PASSWORD` | Must differ from the other two. |

Generate demo passwords with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

The three demo accounts are created automatically on first boot. A **unique**
password per role is enforced by a startup warning, because one shared password
across roles means a single leak unlocks every role.

> If a database was seeded before you set these values, the stored hashes are not
> updated automatically. Delete the three `*@demo.com` rows, or change their
> passwords, before exposing the app publicly.

---

## 6. Blockchain strategy — read this before choosing

There are two modes. The app supports both; the tradeoff is persistence.

### Mode A — external EVM network (persistent ledger, recommended)

Set:

```
BLOCKCHAIN_RPC_URL=https://your-testnet-rpc.example
CONTRACT_ADDRESS=0x...            # an already-deployed SupplyChain contract
PRIVATE_KEY=0x...                 # dedicated testnet key, holds only test funds
```

- The ledger survives restarts and redeploys.
- Registering a product costs a real network transaction, so it takes seconds.
- You must obtain a funded testnet key and a public RPC endpoint yourself.
- Add the network to `blockchain/hardhat.config.cjs` if you want to use the
  Hardhat scripts against it.
- **Never** use a Hardhat default account key, and never use a key that holds
  real funds. The contract has no on-chain access control, so whoever holds this
  key can write to the ledger directly.

### Mode B — local Hardhat node (zero cost, ephemeral ledger)

Set `BLOCKCHAIN_ALLOW_LOCAL_CHAIN=true` and leave the three variables above
unset.

- Costs nothing and needs no accounts or API keys.
- The chain lives **in memory**. Every restart, redeploy, or platform spin-down
  recreates it from scratch and redeploys the contract at a new address.
- The app compensates by replaying PostgreSQL records onto the fresh ledger at
  startup, so the demonstration still shows the full product history.
- On startup the launcher prints Hardhat's standard banner containing its
  **publicly known** test account keys. These are not secrets — they are
  published in Hardhat's documentation and must never be used on a live
  network.

The server refuses to start in production without either `BLOCKCHAIN_RPC_URL`
or an explicit `BLOCKCHAIN_ALLOW_LOCAL_CHAIN=true`. It will not silently choose
an ephemeral ledger for you.

---

## 7. Deploying to Render

`render.yaml` is a Blueprint that sets the build, start, and health check.

1. Push this code to a GitHub repository.
2. In Render, choose **New → Blueprint** and select the repository.
3. Render reads `render.yaml`. For each `sync: false` variable it prompts you:
   - `DATABASE_URL` — paste the connection string from section 4.
   - `MANUFACTURER_PASSWORD`, `DISTRIBUTOR_PASSWORD`, `RETAILER_PASSWORD` —
     generate three different values.
   - `JWT_SECRET` — keep `generateValue: true`.
4. Click **Apply**. The first build runs the compile-and-build chain.
5. When the deploy succeeds, Render prints a URL such as
   `https://blockchain-supply-chain.onrender.com`.

Build steps, for reference:

```
pnpm install --frozen-lockfile --prod=false
pnpm run chain:compile
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/blockchain-supply-chain run build
```

Start command: `pnpm start`.

### Cold starts

Free instances spin down when idle, and the first request afterwards can take
roughly a minute. Open the app a minute before you present it.

---

## 8. Verifying the deployment

Run these in order; the first three are covered by
`pnpm --filter @workspace/api-server run test:http` locally.

| # | Check | Expected |
| --- | --- | --- |
| 1 | `GET /api/healthz` | `200` with a JSON body |
| 2 | `GET /` | The React app loads |
| 3 | `GET /verify/<any-id>` | The app loads (history fallback works) |
| 4 | Browser console on any page | No errors, no failed requests |
| 5 | Sign in as the manufacturer | Dashboard loads |
| 6 | Register a product | Returns a blockchain transaction hash |
| 7 | Scan / open the QR code | Opens `/verify/<product-id>` |
| 8 | Public verify page | "Record Integrity Verified" |
| 9 | Distributor receives, Retailer receives, Retailer marks available | Status advances each time |
| 10 | Sign in as distributor | Only permitted actions are offered |
| 11 | `git log`/repo search for password strings | Nothing found |
| 12 | Restart the service | Data still present, QR still verifies |

Step 12 is the one that catches an ephemeral-ledger surprise in Mode B: after a
restart the contract is redeployed, but the replay step should restore the full
history so verification still succeeds. Confirm this on the real deployment.

---

## 9. If something leaks

Treat any exposed `DATABASE_URL`, `JWT_SECRET`, or demo password as compromised:

1. Rotate `JWT_SECRET` in Render — this invalidates every existing session.
2. Change the database password and update `DATABASE_URL`.
3. Change all three demo passwords and delete the seeded accounts so they are
   recreated with the new values.
4. If a private key was ever committed or pasted anywhere, rotate it on the
   testnet and treat the previous key as burned.
5. `PRIVATE_KEY` should live only in Render's Environment tab. If it was ever
   written to `.env.example`, a log, or a screenshot, rotate it.

`.gitignore` now excludes `.env*`, `*.pem`, `*.key`, keystores, and Hardhat's
local `vars.json`, which can hold encrypted key material.

---

## 10. Known limitations

- The web app stores the session token in `localStorage`. This is convenient for
  a demonstration but is exposed to any successful XSS; a hardened deployment
  would use an HttpOnly cookie plus CSRF protection. Helmet's CSP reduces the
  XSS surface but does not eliminate it.
- Public product and verification endpoints are unauthenticated by design, so a
  printed QR code works for anyone. They are rate limited, but product IDs are
  guessable, so total non-enumerability is not provided.
- `SupplyChain.sol` has no on-chain access control. Authorization is enforced by
  the API only.
- Free-tier cold starts make the first request slow.
- Local Hardhat (Mode B) keeps no permanent ledger history.