import app from "./app";
import { closeBlockchain, initializeBlockchain } from "./lib/blockchain";
import { restoreBlockchainState } from "./lib/restore-blockchain-state";
import { logger } from "./lib/logger";
import { seedDemoUsers } from "./lib/seed";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  const deployedHere = await initializeBlockchain();
  await seedDemoUsers();
  if (deployedHere) {
    await restoreBlockchainState();
  }
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
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
