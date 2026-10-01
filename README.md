# Blockchain-Based Supply Chain Tracking

A working demonstration of product custody from manufacturer registration through distributor and retailer handoffs. Supply partners use role-scoped accounts to move products through a fixed sequence; anyone with a product ID or QR code can view its public record and run a ledger integrity check.

## What it does

- Manufacturer accounts register products with a product ID, name, batch, category, manufacturing date, quantity, and description.
- Distributor accounts confirm receipt and record the transfer to a retailer.
- Retailer accounts confirm receipt and mark products available for sale.
- Every status change is checked on the server against the previous status. The only allowed sequence is:

  `Created → Received by Distributor → In Transit to Retailer → Received by Retailer → Available for Sale`

- Product identity data is hashed with SHA-256 and registered in a local Hardhat smart contract. Each custody event gets a separate hash and on-chain transaction.
- A public product page shows its details and event history. Its QR code opens a public verification page and can be downloaded as a PNG.
- Verification recalculates the product hash and compares it with the blockchain record. This checks record integrity; it does **not** prove that a physical item is genuine or that its label has not been copied.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Manufacturer | `manufacturer@demo.com` | `password123` |
| Distributor | `distributor@demo.com` | `password123` |
| Retailer | `retailer@demo.com` | `password123` |

These accounts are seeded on API startup for demonstration only. Do not use the demo credentials or local development chain for a production deployment.

## Run in Replit

The project has separate web and API workflows:

1. Start **API Server**. Its development launcher compiles and starts the local Hardhat node, deploys the contract, restores existing database records to a freshly deployed local ledger, seeds the demo accounts, and starts the API.
2. Start **Blockchain Supply Chain** to open the web app.
3. Sign in as a manufacturer, register a product, then sign in as the distributor and retailer accounts to record each handoff. The public **Track a product** page and product QR code do not require sign-in.

The API needs the workspace PostgreSQL `DATABASE_URL` and a `SESSION_SECRET`. The Replit workspace supplies the database and session secret; keep them in workspace secrets and do not commit them. The API uses PostgreSQL through Drizzle ORM, not MongoDB. It uses the existing Express/TypeScript API service, rather than FastAPI, so the demonstration fits the supplied workspace services.

For an optional external EVM network, set `BLOCKCHAIN_RPC_URL`, `CONTRACT_ADDRESS`, and `PRIVATE_KEY` through the workspace secrets flow. The local demo does not need these values. A configured contract address must already have code on the selected network.

## Try the full flow

1. Sign in as `manufacturer@demo.com`.
2. Register a product with a new Product ID (for example, `HNY002`) and a name such as **Organic Honey**. `HNY001` is the completed demo record in this workspace and is ready for public tracking.
3. Sign in as `distributor@demo.com`, open the product, and record **Received by Distributor**, then **In Transit to Retailer**.
4. Sign in as `retailer@demo.com`, record **Received by Retailer**, then **Available for Sale**.
5. Open the public tracking page or scan/download the QR code from the product record. Review the custody timeline and run the integrity check.

Each role only sees products in its part of the chain. Manufacturers see their own registrations, distributors see products awaiting or undergoing their handoff, and retailers see products in their receiving and sale stages.

## Main pages

- `/` — public landing page
- `/login` — demo team sign-in
- `/track` — account-free product lookup
- `/verify/:productId` — public hash comparison
- `/dashboard` — role-scoped supply chain summary
- `/products` — role-scoped inventory
- `/products/new` — manufacturer registration
- `/products/:productId` — product details, actions, timeline, transaction references, and QR code

## API

All endpoints are under `/api`.

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/auth/login` | Public |
| `GET` | `/auth/me` | Signed-in |
| `GET` | `/dashboard/stats` | Signed-in |
| `GET` | `/products` | Signed-in, role-scoped |
| `POST` | `/products` | Manufacturer |
| `GET` | `/products/:productId` | Public |
| `GET` | `/products/:productId/events` | Public |
| `GET` | `/products/:productId/verify` | Public |
| `POST` | `/products/:productId/receive` | Distributor |
| `POST` | `/products/:productId/transfer` | Distributor |
| `POST` | `/products/:productId/retailer-receive` | Retailer |
| `POST` | `/products/:productId/available` | Retailer |

The contract source is in `blockchain/contracts/SupplyChain.sol`. It records product IDs and hashes, event types and hashes, and timestamps. Application data and user accounts are stored in PostgreSQL; if the local Hardhat network restarts, the API replays saved product and event hashes to the newly deployed contract and refreshes transaction references.

## Checks

```sh
pnpm run typecheck
pnpm --filter @workspace/blockchain run compile
pnpm --filter @workspace/blockchain run test
PORT=20948 BASE_PATH=/ pnpm --filter @workspace/blockchain-supply-chain run build
```

The Hardhat network and its unlocked accounts are local development tools only. Never use their development keys or send real assets to them.