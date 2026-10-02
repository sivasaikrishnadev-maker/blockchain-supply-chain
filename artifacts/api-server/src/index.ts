import app from "./app";
import { closeBlockchain, initializeBlockchain } from "./lib/blockchain";
import { restoreBlockchainState } from "./lib/restore-blockchain-state";
import { logger } from "./lib/logger";
import { seedDemoUsers } from "./lib/seed";
import { ensureSchema, pool } from "@workspace/db";

/**
 * Resolve the listening port.
 *
 * Hosting platforms (Render, Replit, Fly, Heroku) inject `PORT`, so it is used
 * when present. The 5000 fallback only applies when the variable is absent
 * entirely, which keeps `node dist/index.mjs` usable on a laptop.
 */
const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 5000;

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(
    rawPort ? `Invalid PORT value: "${rawPort}"` : "PORT must be a valid TCP port.",
  );
}

/** Bind on every interface. Containers must listen on 0.0.0.0 to be reachable. */
const host = process.env["HOST"] ?? "0.0.0.0";

/** Health checks and rate limiting must see the real client IP behind a proxy. */
app.set("trust proxy", 1);

async function start(): Promise<void> {
  // Order matters: the database must be reachable and provisioned before the
  // chain is touched, because restoring ledger state writes to both.
  await ensureSchema();
  logger.info("Database schema is present");

  const deployedHere = await initializeBlockchain();
  await seedDemoUsers();
  if (deployedHere) {
    await restoreBlockchainState();
  }

  const server = app.listen(port, host, () => {
    logger.info({ port, host }, "Server listening");
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await closeBlockchain();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

start().catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.message : "unknown startup error" },
    "API server could not start",
  );
  process.exit(1);
});
