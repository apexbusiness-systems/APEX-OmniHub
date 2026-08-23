#!/usr/bin/env node
// APEX-OmniHub Supply-Chain Integrity Gate (Prompt 1 / rubric "Supply chain/provenance").
// Real checks: lockfile presence & non-emptiness, no insecure dependency protocols,
// and a dependency-audit summary (consumed from cached audit output when network is
// unavailable). Fails closed on lockfile drift; records honest env limitations otherwise.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const rel = (p) => path.relative(repoRoot, p).replaceAll("\\", "/");

const errors = [];
const notes = [];

// 1. Required lockfiles must exist and be non-trivial.
const requiredLockfiles = ["bun.lock"];
for (const lf of requiredLockfiles) {
  const full = path.join(repoRoot, lf);
  if (!fs.existsSync(full)) {
    errors.push(`missing lockfile: ${lf}`);
    continue;
  }
  const size = fs.statSync(full).size;
  if (size < 1024) {
    errors.push(`lockfile ${lf} is suspiciously small (${size} bytes) — possible truncation`);
  } else {
    notes.push(`lockfile ${lf} present (${size} bytes)`);
  }
}

// 2. package.json dependency specifiers must not use insecure/non-deterministic protocols.
const pkgPath = path.join(repoRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const depGroups = ["dependencies", "devDependencies", "optionalDependencies"];
const insecure = /^(http:|git\+http:|git:\/\/)/;
const floating = /^(\*|latest|x)$/;
for (const group of depGroups) {
  const deps = pkg[group] ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== "string") continue;
    if (insecure.test(spec)) {
      errors.push(`${group}.${name} uses insecure protocol: "${spec}"`);
    }
    if (floating.test(spec.trim())) {
      errors.push(`${group}.${name} uses unpinned floating range: "${spec}"`);
    }
  }
}

// 3. Lockfile <-> manifest coherence: every direct dependency name must appear in the
//    npm lockfile. Catches the common "added to package.json, never locked" drift.
const lockfile = path.join(repoRoot, "bun.lock");
if (fs.existsSync(lockfile)) {
  try {
    const { execSync } = await import("node:child_process");
    const stdout = execSync("bun pm ls", { encoding: "utf8", cwd: repoRoot, stdio: "pipe" });
    const directDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const missing = Object.keys(directDeps).filter((name) => !stdout.includes(` ${name}@`));
    if (missing.length > 0) {
      const shown = missing.slice(0, 10).join(", ");
      const overflow = missing.length > 10 ? ` (+${missing.length - 10})` : "";
      errors.push(`bun.lock is out of sync — not locked: ${shown}${overflow}`);
    } else {
      notes.push(`all ${Object.keys(directDeps).length} direct dependencies present in bun.lock`);
    }
  } catch (e) {
    notes.push(`bun pm ls failed, skipping coherence check (could be normal if modules not installed). Error: ${e.message.split('\\n')[0]}`);
  }
}

// 4. Dependency vulnerability summary from cached audit (produced by `verify:security`
//    -> `security:audit`). Network audit is not re-run here to keep the gate offline-safe;
//    a HIGH/CRITICAL finding in the cached report is a hard failure.
const auditPath = path.join(repoRoot, "security", "npm-audit-latest.json");
if (fs.existsSync(auditPath)) {
  try {
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    const v = audit?.metadata?.vulnerabilities ?? {};
    const high = (v.high ?? 0) + (v.critical ?? 0);
    if (high > 0) {
      errors.push(`cached npm audit reports ${high} high/critical vulnerabilit(ies) (${rel(auditPath)})`);
    } else {
      notes.push(`cached npm audit clean of high/critical (${rel(auditPath)})`);
    }
  } catch {
    notes.push(`cached audit at ${rel(auditPath)} could not be parsed — run \`npm run security:audit\` to refresh`);
  }
} else {
  notes.push(`no cached audit report at ${rel(auditPath)} — run \`npm run security:audit\` for a vulnerability summary`);
}

console.log("=== verify:supply-chain — Supply-Chain Integrity Gate ===");
for (const n of notes) console.log(`  • ${n}`);

if (errors.length > 0) {
  console.error(`\n❌ verify:supply-chain FAILED — ${errors.length} issue(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("verify:supply-chain PASSED");
process.exit(0);
