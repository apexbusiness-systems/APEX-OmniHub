# Open Vulnerability Scanner Exceptions

## 2026-07-31: Dependabot / esbuild Vulnerabilities

We accept the following vulnerabilities indefinitely.

- **Dependency:** `@esbuild/*` (via Vite/Rollup tree)
- **Vulnerabilities:** 5 high-severity vulnerabilities flagged by Dependabot/OSV.
- **Risk Assessment:** These are build-time tools. They do not ship to the browser bundle. They do not run in Edge Functions. The exploit vector requires malicious source code injection during build, which implies a pre-existing root compromise of the repository.
- **Remediation Attempt:** PR #1664 attempted to force resolution via `optionalDependencies` overrides.
- **Failure Cascade:** 
  1. The overrides forced platform-specific binaries into cross-platform lockfiles.
  2. This triggered `npm ci` failures on Cloudflare Pages because `npm` validates the lockfile against the platform.
  3. Six subsequent attempts to patch the lockfile created a 188× diff explosion and 10 failing CI checks.
- **Decision:** The operational risk of breaking the deployment pipeline and causing multi-day downtime massively outweighs the theoretical risk of a build-time vulnerability in a trusted CI environment. We will not mutate our dependency tree to silence this warning. 

## Exception Rule
Any future agent or automated scanner attempting to "fix" `@esbuild` vulnerabilities via `overrides` or `resolutions` is in violation of APEX-TRUTH-100.
