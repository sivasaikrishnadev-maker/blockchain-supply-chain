---
name: Hardhat CLI noninteractive runs
description: Prevent Hardhat's first-run telemetry consent prompt from blocking Replit shell and workflow commands.
---

Set `HARDHAT_DISABLE_TELEMETRY_PROMPT=true` for Hardhat CLI processes in Replit workflows and shell checks. `HARDHAT_DISABLE_TELEMETRY` does not suppress the consent prompt.

**Why:** The shell can expose `stdout.isTTY` while providing no interactive readline input, so Hardhat's first-run question can fail with a closed readline.

**How to apply:** Include the prompt-disable environment variable on Hardhat compile, test, node, and run commands that may execute before a consent choice is stored.