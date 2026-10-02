/**
 * Production entrypoint.
 *
 * Replaces `pnpm start` for hosted deployments. It performs the two things the
 * hosted environment needs and the API process cannot do for itself:
 *
 *  1. Start the local Hardhat development chain as a *managed child process*
 *     when no external `BLOCKCHAIN_RPC_URL` is configured, and wait until it
 *     answers `eth_chainId`.
 *  2. Start the compiled API server, forwarding signals and exiting with its
 *     status.
 *
 * Nothing here is new technology: it orchestrates the same Hardhat node and the
 * same `dist/index.mjs` that `scripts/dev.mjs` already used locally.
 *
 * IMPORTANT - local Hardhat on free hosting
 * ---------------------------------------
 * `hardhat node` keeps the chain in memory. It is therefore recreated from
 * scratch on every restart, redeploy, or platform spin-down, and the contract
 * address changes each time. The API compensates by replaying the PostgreSQL
 * records onto the fresh ledger (`restoreBlockchainState`), so the
 * demonstration keeps working, but the ledger history is not permanent.
 *
 * For a persistent ledger, set BLOCKCHAIN_RPC_URL, CONTRACT_ADDRESS and
 * PRIVATE_KEY and this script will not start a local node at all.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const blockchainRoot = path.join(workspaceRoot, "blockchain");
const serverEntry = path.join(packageRoot, "dist", "index.mjs");

const LOCAL_RPC_URL = "http://127.0.0.1:8545";
const RPC_READY_TIMEOUT_MS = Number(process.env.RPC_READY_TIMEOUT_MS ?? 60_000);

/**
 * Hosting platforms do not always set NODE_ENV, and code paths that relax
 * security checks when NODE_ENV is unset (demo password fallback, weaker secret
 * rules) are exactly the ones that must not run in a deployed container.
 * Therefore this launcher - not the platform - owns the default.
 */
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

let chainProcess;
let apiProcess;
let shuttingDown = false;

function log(message) {
  process.stdout.write(`[start] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[start] ${message}\n`);
  stop(1);
}

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  chainProcess?.kill("SIGTERM");
  apiProcess?.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

/**
 * Locate the Hardhat CLI without going through pnpm.
 *
 * Calling pnpm from a process supervisor adds a package-manager dependency to
 * the runtime path; resolving Hardhat's own bin entry needs only Node.
 */
function resolveHardhatCommand() {
  const bootstrap = path.join(
    blockchainRoot,
    "node_modules",
    "hardhat",
    "internal",
    "cli",
    "bootstrap.js",
  );
  if (existsSync(bootstrap)) {
    return { command: process.execPath, args: [bootstrap] };
  }
  const binDir = path.join(blockchainRoot, "node_modules", ".bin");
  for (const name of process.platform === "win32"
    ? ["hardhat.cmd", "hardhat"]
    : ["hardhat"]) {
    const candidate = path.join(binDir, name);
    if (existsSync(candidate)) {
      return { command: candidate, args: [] };
    }
  }
  return undefined;
}

async function waitForRpc(url) {
  const deadline = Date.now() + RPC_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (chainProcess && chainProcess.exitCode !== null) {
      throw new Error(
        "The local Hardhat node exited before it became ready. Run `pnpm run chain:compile` and check the Hardhat output above.",
      );
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the deadline.
    }
    await delay(400);
  }
  throw new Error(
    `The blockchain RPC at ${url} did not become ready within ${RPC_READY_TIMEOUT_MS}ms.`,
  );
}

async function main() {
  if (!existsSync(serverEntry)) {
    throw new Error(
      `The API server build was not found at ${serverEntry}. Run "pnpm --filter @workspace/api-server run build" before starting.`,
    );
  }

  const externalRpc = Boolean(process.env.BLOCKCHAIN_RPC_URL);
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || LOCAL_RPC_URL;

  if (!externalRpc) {
    const allowLocalChain = process.env.BLOCKCHAIN_ALLOW_LOCAL_CHAIN === "true";
    if (process.env.NODE_ENV === "production" && !allowLocalChain) {
      throw new Error(
        "BLOCKCHAIN_RPC_URL is not set. A hosted deployment needs either an external EVM RPC " +
          "(persistent ledger) or an explicit BLOCKCHAIN_ALLOW_LOCAL_CHAIN=true, which accepts that the " +
          "local Hardhat chain is in-memory and is recreated on every restart.",
      );
    }
    if (allowLocalChain) {
      log(
        "WARNING: BLOCKCHAIN_ALLOW_LOCAL_CHAIN=true. The chain is in-memory; every restart redeploys the " +
          "contract and replays the database onto it. Ledger history is not permanent.",
      );
    }

    const artifact = path.join(
      blockchainRoot,
      "artifacts",
      "contracts",
      "SupplyChain.sol",
      "SupplyChain.json",
    );
    if (!existsSync(artifact)) {
      throw new Error(
        `The compiled contract artifact is missing (${artifact}). Run "pnpm run chain:compile" as part of the deployment build.`,
      );
    }

    const hardhat = resolveHardhatCommand();
    if (!hardhat) {
      throw new Error(
        "Hardhat could not be found. Install dependencies with pnpm before starting.",
      );
    }

    log("starting the local Hardhat chain (in-memory; recreated on every restart)");
    chainProcess = spawn(
      hardhat.command,
      [
        ...hardhat.args,
        "node",
        "--config",
        "hardhat.config.cjs",
        "--hostname",
        "127.0.0.1",
        "--port",
        "8545",
      ],
      {
        cwd: blockchainRoot,
        stdio: "inherit",
        env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" },
      },
    );
    chainProcess.once("error", (error) =>
      fail(`Could not start the local Hardhat node: ${error.message}`),
    );
  } else {
    log(`using the external blockchain RPC configured by BLOCKCHAIN_RPC_URL`);
  }

  await waitForRpc(rpcUrl);
  log("blockchain RPC is ready");

  log("starting the API server");
  apiProcess = spawn(process.execPath, ["--enable-source-maps", serverEntry], {
    cwd: packageRoot,
    stdio: "inherit",
    env: { ...process.env, BLOCKCHAIN_RPC_URL: rpcUrl },
  });
  apiProcess.once("error", (error) =>
    fail(`Could not start the API server: ${error.message}`),
  );
  apiProcess.once("exit", (code, signal) => {
    if (signal) {
      log(`API server stopped by signal ${signal}`);
      stop(0);
      return;
    }
    stop(code ?? 1);
  });
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Startup failed");
});
