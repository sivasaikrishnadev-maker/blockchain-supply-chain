import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(apiDirectory, "../..");
const externalRpc = Boolean(process.env.BLOCKCHAIN_RPC_URL);
let chainProcess;
let apiProcess;
let shuttingDown = false;

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  chainProcess?.kill("SIGTERM");
  apiProcess?.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

try {
  execFileSync(
    "pnpm",
    ["--filter", "@workspace/blockchain", "run", "compile"],
    { cwd: workspaceRoot, stdio: "inherit" },
  );

  if (!externalRpc) {
    chainProcess = spawn(
      "pnpm",
      ["--filter", "@workspace/blockchain", "run", "node"],
      {
        cwd: workspaceRoot,
        stdio: "ignore",
        env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" },
      },
    );
    chainProcess.once("error", (error) => {
      process.stderr.write(`Could not start the local Hardhat node: ${error.message}\n`);
      stop(1);
    });
  }

  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (chainProcess?.exitCode !== null && chainProcess?.exitCode !== undefined) {
      throw new Error("The local Hardhat node stopped before becoming ready.");
    }
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Keep waiting while the local development node starts.
    }
    await delay(500);
  }
  if (!ready) {
    throw new Error("The blockchain RPC did not become ready within 30 seconds.");
  }

  apiProcess = spawn(
    process.execPath,
    ["--enable-source-maps", "dist/index.mjs"],
    {
      cwd: apiDirectory,
      stdio: "inherit",
      env: { ...process.env, BLOCKCHAIN_RPC_URL: rpcUrl },
    },
  );
  apiProcess.once("error", (error) => {
    process.stderr.write(`Could not start the API server: ${error.message}\n`);
    stop(1);
  });
  apiProcess.once("exit", (code) => stop(code ?? 1));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Development startup failed"}\n`,
  );
  stop(1);
}