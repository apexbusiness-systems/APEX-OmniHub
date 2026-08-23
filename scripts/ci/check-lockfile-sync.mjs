#!/usr/bin/env node
/**
 * check-lockfile-sync — Bun-native regression guard for lockfile synchronization.
 *
 * Enforces:
 * 1. package.json dependency ranges match bun.lock workspace definitions exactly.
 * 2. bun pm ls completes cleanly with all direct dependencies resolved.
 * 3. Legacy package-lock.json does not exist (prevents npm lockfile drift/re-introduction).
 *
 * Deterministic, offline, zero external network calls.
 * Exit 0 = synchronized & valid, Exit 1 = drift detected.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const errors = [];

// Guard 1: Anti-npm drift check (package-lock.json must NOT exist)
const legacyLock = resolve(root, "package-lock.json");
if (existsSync(legacyLock)) {
  errors.push("Legacy package-lock.json detected in repo root! Delete it to prevent engine divergence.");
}

// Guard 2: bun.lock existence check
const bunLockPath = resolve(root, "bun.lock");
if (!existsSync(bunLockPath)) {
  errors.push("bun.lock missing from repo root — run: bun install");
} else {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const bunLockRaw = readFileSync(bunLockPath, "utf8").replace(/,(\s*[}\]])/g, "$1");
    const bunLock = JSON.parse(bunLockRaw);
    const ws = bunLock.workspaces?.[""] ?? {};

    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const want = pkg[section] ?? {};
      const have = ws[section] ?? {};
      for (const [dep, range] of Object.entries(want)) {
        if (!(dep in have)) {
          errors.push(`bun.lock missing ${section}.${dep} (${range}) — run: bun install`);
        } else if (have[dep] !== range) {
          errors.push(`bun.lock range drift ${dep}: package.json=${range} bun.lock=${have[dep]} — run: bun install`);
        }
      }
      for (const dep of Object.keys(have)) {
        if (!(dep in want)) {
          errors.push(`bun.lock stale entry ${section}.${dep} not in package.json — run: bun install`);
        }
      }
    }
  } catch (err) {
    errors.push(`Failed to parse package.json or bun.lock: ${err.message}`);
  }
}

// Guard 3: Bun lockfile tree resolution check via bun pm ls
try {
  const stdout = execSync("bun pm ls", { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (!stdout || stdout.length === 0) {
    errors.push("bun pm ls returned empty output");
  }
} catch (err) {
  errors.push(`bun pm ls failed: ${err.message}`);
}

if (errors.length > 0) {
  console.error("[check-lockfile-sync] FAIL — Lockfile synchronization issue(s) detected:");
  for (const e of errors) {
    console.error(" - " + e);
  }
  process.exit(1);
}

console.log("[check-lockfile-sync] OK — package.json and bun.lock are strictly in sync (Bun-native gate).");
process.exit(0);
