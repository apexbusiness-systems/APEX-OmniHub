# Cloudflare Project Parity

This document measures the build environment divergence between the production Cloudflare Pages project (`apex-omnihub`) and the shadow project (`apex-omnihub-shadow`).

| Field | `apex-omnihub` (prod) | `apex-omnihub-shadow` (shadow) | Divergent? |
|-------|-----------------------|---------------------------------|------------|
| Build system / build image version | 3 | 3 | |
| Build command | `npm run build` | *(empty)* | **DIVERGENT** |
| Build output directory | `dist` | *(empty)* | **DIVERGENT** |
| Root directory | *(empty)* | *(empty)* | |
| `NODE_VERSION` env var | `22` | *(missing)* | **DIVERGENT** |
| `NPM_FLAGS` / `BUN_VERSION` env vars | *(missing)* | *(missing)* | |
| Framework | `react-router` | *(empty)* | **DIVERGENT** |
| All other environment variable names | `ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DOMAIN_TOKEN_AOID`, `CLOUDFLARE_SHADOW_PROJECT_NAME`, `CONTROL_SIGNING_SECRET_SBBL_HQ`, `CONTROL_TARGET_URL_SBBL_HQ`, `ENABLE_SHADOW_DEPLOYMENT`, `GH_TOKEN_TEMP`, `GROQ_API_KEY`, `MCP_GATEWAY_API_KEY`, `OMNIBOARD_MOCK_OAUTH`, `OMNIBRIDGE_M2M_CLIENTS`, `OMNIBRIDGE_SBBL_NATIVE_SECRET`, `REDIS_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TF_PROD_TOKEN`, `VITE_CONNECT_AI_ENABLED`, `VITE_DASHBOARD_URL`, `VITE_OMNIDASH_ENABLED`, `VITE_OMNILINK_MOBILE_ONLY`, `VITE_ORCHESTRATOR_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DOMAIN_TOKEN_AOID`, `MCP_GATEWAY_API_KEY`, `OMNIBOARD_MOCK_OAUTH`, `TF_PROD_TOKEN`, `VITE_ORCHESTRATOR_URL`, `VITE_SUPABASE_URL` | **DIVERGENT** |

## Production Build Failure — First Error & Root Cause Analysis (TASK-R.2 / H1)

### Production Build Log First Error Line
```text
npm error Missing: @esbuild/aix-ppc64@0.28.1 from lock file
```

### Mechanism Proof & Hypothesis H1 Verification
1. **The Infrastructure Divergence Mechanism (H1):**
   - In production (`apex-omnihub`), Cloudflare Pages config set `Build command: npm run build` and `Framework: react-router`.
   - When Cloudflare's v3 build image detects an explicit `npm` build command, it automatically invokes `npm ci` expecting a platform-complete `package-lock.json`.
   - When `package-lock.json` was generated on Windows, optional cross-platform native binaries (such as `@esbuild/aix-ppc64@0.28.1`, `@esbuild/android-arm64`, `@supabase/cli` native bindings) were omitted from the lockfile tree.
   - When Cloudflare's Linux build container executed `npm ci`, npm threw the fatal error:
     `npm error Missing: @esbuild/aix-ppc64@0.28.1 from lock file` and aborted before starting compilation.

2. **The Shadow Success Mechanism:**
   - In shadow (`apex-omnihub-shadow`), `Build command` and `Framework` were empty.
   - Cloudflare Pages auto-detection discovered `bun.lock`, invoked `bun install`, correctly downloaded all platform binary targets, executed `bun run build`, and deployed green.

3. **Remediation Parity Resolution:**
   - Aligning Cloudflare production settings to match shadow defaults (or delegating dependency resolution to Bun via `bun.lock` and `bun install`) removed the `npm ci` lockfile check gate, resolving the deployment failure without touching application source code.
