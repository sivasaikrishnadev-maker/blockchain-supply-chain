/**
 * Cross-platform Hardhat CLI wrapper.
 *
 * Why this exists:
 *
 * 1. The project documented that Hardhat's first-run telemetry consent prompt
 *    must be suppressed on non-interactive runs (see .agents/memory/), because a
 *    shell or hosted build can expose a TTY with no usable readline input, so
 *    the prompt fails with a closed readline and blocks the command. The
 *    original scripts set HARDHAT_DISABLE_TELEMETRY_PROMPT with the POSIX
 *    `VAR=value cmd` form, which fails on Windows.
 * 2. `cross-env` would fix that, but adding a dependency for one variable is
 *    not worth it.
 *
 * This wrapper sets the variable in-process and then hands control to Hardhat's
 * own CLI entrypoint. Because it runs before any Hardhat module is imported, it
 * does not depend on the order in which Hardhat loads its config relative to the
 * consent check.
 *
 * Hardhat reads `process.argv.slice(2)`, so the arguments are passed straight
 * through: `node scripts/hardhat.mjs compile --config hardhat.config.cjs`.
 */

import { createRequire } from "node:module";

process.env.HARDHAT_DISABLE_TELEMETRY_PROMPT ??= "true";

const require = createRequire(import.meta.url);
const bootstrap = require.resolve("hardhat/internal/cli/bootstrap.js");

require(bootstrap);