import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

/**
 * Every filesystem path in this app is resolved from the location of this
 * module, never from `process.cwd()`.
 *
 * Why: hosting platforms start the process from an arbitrary working directory
 * (the repo root, the package folder, or `/`), so a cwd-relative path such as
 * `../../blockchain/...` resolves to a different place depending on how the app
 * was launched. Resolving from `import.meta.url` makes the lookup deterministic.
 *
 * This module runs in two different layouts:
 *   - production: bundled into `artifacts/api-server/dist/index.mjs`
 *   - local dev:  executed from `artifacts/api-server/src/lib/paths.ts`
 * Rather than hard-coding a number of `..` segments that is only correct for one
 * of those, the workspace root is found by walking up to the marker file that
 * always exists in both layouts.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Walk up from `startDir` until the pnpm workspace root marker is found. */
function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  // Bounded so a misconfigured checkout fails fast instead of walking to the
  // filesystem root.
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, WORKSPACE_MARKER))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    `Could not locate ${WORKSPACE_MARKER} at or above ${startDir}. ` +
      "Run the server from inside the repository checkout.",
  );
}

/** Repository root of the pnpm monorepo. */
export const workspaceRoot = findWorkspaceRoot(moduleDir);

/** Directory of the `@workspace/api-server` package. */
export const packageRoot = path.join(workspaceRoot, "artifacts", "api-server");

/** Repository root (kept as a distinct name where it reads more clearly). */
export const repoRoot = workspaceRoot;

const artifactCandidates = [
  process.env["BLOCKCHAIN_ARTIFACT_PATH"],
  path.join(
    workspaceRoot,
    "blockchain",
    "artifacts",
    "contracts",
    "SupplyChain.sol",
    "SupplyChain.json",
  ),
].filter((candidate): candidate is string => Boolean(candidate));

/**
 * Locate the compiled `SupplyChain` contract artifact.
 *
 * The artifact is produced by `pnpm run chain:compile` during the deployment
 * build, so it is not committed to version control. Throwing here - rather than
 * silently falling back to a development key or a hard-coded address - makes a
 * missing build step fail loudly instead of starting with a broken ledger.
 */
export function resolveContractArtifactPath(): string {
  const found = artifactCandidates.find((candidate) => existsSync(candidate));
  if (found) {
    return found;
  }
  throw new Error(
    `The compiled SupplyChain contract artifact was not found. Run "pnpm run chain:compile" (or "pnpm --filter @workspace/blockchain run compile") before starting the server. Looked in:\n${artifactCandidates
      .map((candidate) => `  - ${candidate}`)
      .join("\n")}`,
  );
}

/** Directory holding the production frontend build, if it has been built. */
export function resolveFrontendDistDir(): string | undefined {
  const candidate = path.join(
    workspaceRoot,
    "artifacts",
    "blockchain-supply-chain",
    "dist",
    "public",
  );
  return existsSync(path.join(candidate, "index.html")) ? candidate : undefined;
}