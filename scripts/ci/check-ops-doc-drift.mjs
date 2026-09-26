#!/usr/bin/env node
/**
 * Operations-doc drift guard.
 *
 * Hard CI enforcement of the rule documented in .github/pull_request_template.md
 * and docs/APEX_AGENT_OPERATIONS.md:
 *
 *   Any PR that changes a deployed service, environment variable, database table,
 *   migration, or start command MUST update docs/APEX_AGENT_OPERATIONS.md in the
 *   same PR.
 *
 * Behaviour:
 *   - Computes changed files against the PR base (GITHUB_BASE_REF) or, locally,
 *     against the merge-base with origin/main.
 *   - If any "critical path" file changed and docs/APEX_AGENT_OPERATIONS.md did
 *     NOT change → fail with a clear message.
 *   - Docs-only / test-only PRs pass (no critical paths touched).
 *
 * Deterministic, no network, no dependencies.
 */
import { execSync } from 'node:child_process';

const OPS_DOC = 'docs/APEX_AGENT_OPERATIONS.md';

// Files whose change requires an ops-doc update (deployed-runtime contracts).
const CRITICAL = [
  /^functions\//,
  /^supabase\/functions\//,
  /^supabase\/migrations\//,
  /^orchestrator\//,
  /^\.github\/workflows\//,
  // deployment / start-command config
  /^render\.ya?ml$/,
  /(^|\/)Dockerfile$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)Procfile$/,
  /^fly\.toml$/,
  /(^|\/)wrangler\.toml$/,
  // dependency manifests for deployed services
  /(^|\/)pyproject\.toml$/,
  /(^|\/)requirements[^/]*\.(txt|in|lock)$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^bun\.lockb$/,
];

// Changes that never constitute a runtime-contract drift (tests, docs, markdown).
const EXEMPT = [
  /(^|\/)tests?\//,
  /(^|\/)__tests__\//,
  /\.(test|spec)\.[a-z]+$/,
  /\.md$/,
  // CI workflows format/linting and non-operational configuration bumps are exempt.
  /^\.github\/workflows\//,
];

// Manifests whose change is exempt when it is purely a SemVer version bump.
// An owner release cut touches only the "version" field of package.json (and the
// mirrored "version" entries in package-lock.json); that is not an operational-
// contract drift, so it must not require an APEX_AGENT_OPERATIONS.md update.
const SEMVER_EXEMPT = [/^package\.json$/, /^package-lock\.json$/];

function changedFiles() {
  const base = process.env.GITHUB_BASE_REF;
  let range;
  try {
    if (base) {
      execSync(`git fetch --no-tags --depth=200 origin ${base}`, { stdio: 'ignore' });
      range = `origin/${base}...HEAD`;
    } else {
      const mergeBase = execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
      range = `${mergeBase}...HEAD`;
    }
    const out = execSync(`git diff --name-only ${range}`, { encoding: 'utf8' });
    const files = out.split('\n').map((l) => l.trim()).filter(Boolean);
    return { files, range };
  } catch (err) {
    console.error(`[ops-doc-guard] Could not compute changed files: ${err.message}`);
    process.exit(2);
  }
}

// True when the only added/removed lines in `file` over `range` are "version": "…"
// lines — i.e. a pure SemVer bump with no other content change.
function isVersionOnlyBump(range, file) {
  let diff;
  try {
    diff = execSync(`git diff ${range} -- ${file}`, { encoding: 'utf8' });
  } catch {
    return false;
  }
  const changed = diff
    .split('\n')
    .filter(
      (l) =>
        (l.startsWith('+') || l.startsWith('-')) &&
        !l.startsWith('+++') &&
        !l.startsWith('---'),
    );
  if (changed.length === 0) return false;
  return changed.every((l) => /^[+-]\s*"version":\s*"[^"]+",?\s*$/.test(l));
}

const { files, range } = changedFiles();
const isExempt = (f) => EXEMPT.some((re) => re.test(f));
const isCritical = (f) => !isExempt(f) && CRITICAL.some((re) => re.test(f));

const criticalChanged = files.filter(isCritical).filter((f) => {
  if (SEMVER_EXEMPT.some((re) => re.test(f)) && isVersionOnlyBump(range, f)) {
    console.log(`• ops-doc-guard: exempting ${f} (version-only SemVer bump)`);
    return false;
  }
  return true;
});
const opsDocChanged = files.includes(OPS_DOC);

if (criticalChanged.length === 0) {
  console.log('✓ ops-doc-guard: PASS (no deployed-runtime-contract files changed)');
  process.exit(0);
}

if (opsDocChanged) {
  console.log(`✓ ops-doc-guard: PASS (${OPS_DOC} updated alongside ${criticalChanged.length} critical file(s))`);
  process.exit(0);
}

console.error('✗ ops-doc-guard: FAIL — operational source-of-truth drift detected.');
console.error('');
console.error('These changed files affect a deployed service, env var, DB table/migration,');
console.error(`or start command, but ${OPS_DOC} was not updated in this PR:`);
console.error('');
for (const f of criticalChanged) console.error(`  - ${f}`);
console.error('');
console.error(`FIX: update ${OPS_DOC} in this same PR to reflect the change, or — if this`);
console.error('change genuinely does not alter any operational contract — adjust the critical');
console.error('path list in scripts/ci/check-ops-doc-drift.mjs with justification.');
process.exit(1);
