#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const passthroughArgs = rawArgs.filter((arg) => arg !== "--dry-run");

const knipScopeArgs = ["--include", "files,exports,types"];
const knipFixArgs = [
  "--fix",
  "--fix-type",
  "files,exports,types",
  "--allow-remove-files",
  "--format",
];

const knipArgs = dryRun
  ? ["knip", ...knipScopeArgs, ...passthroughArgs]
  : ["knip", ...knipScopeArgs, ...knipFixArgs, ...passthroughArgs];

console.log(
  dryRun
    ? "Running pnpm knip dry-run for files/exports/types…"
    : "Running pnpm knip autofix for files/exports/types…",
);

const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  knipArgs,
  {
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
