import fs from 'fs';

const MANIFEST_PATH = 'docs/ops/cloudflare-projects.json';
const PROD_PROJECT = 'apex-omnihub';
const SHADOW_PROJECT = 'apex-omnihub-shadow';
const ACCOUNT_ID = '0e1bce84773a0d1ce340145ea195e86f';

async function fetchProjectConfig(projectName, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${projectName}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: controller.signal
  });
  clearTimeout(timeout);
  if (!res.ok) {
    throw new Error(`Cloudflare API error for ${projectName}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.result;
}

function resolvePath(obj, path) {
  return path.split('.').reduce((prev, curr) => (prev ? prev[curr] : undefined), obj);
}

async function run() {
  const token = process.env.CLOUDFLARE_AGENT_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error("Missing CLOUDFLARE_AGENT_TOKEN or CLOUDFLARE_API_TOKEN in environment.");
    process.exit(1);
  }

  const manifestStr = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestStr);

  let prod, shadow;
  try {
    prod = await fetchProjectConfig(PROD_PROJECT, token);
    shadow = await fetchProjectConfig(SHADOW_PROJECT, token);
  } catch (err) {
    console.error("Failed to fetch project configurations:", err.message);
    process.exit(1);
  }

  let failed = false;

  console.log("Checking Cloudflare Project Parity...");

  for (const field of manifest.must_match) {
    const prodVal = resolvePath(prod, field);
    const shadowVal = resolvePath(shadow, field);

    if (prodVal !== shadowVal) {
      console.error(`❌ Divergence detected in ${field}:`);
      console.error(`   Prod:   ${prodVal}`);
      console.error(`   Shadow: ${shadowVal}`);
      failed = true;
    } else {
      console.log(`✅ ${field} matches (${prodVal})`);
    }
  }

  if (failed) {
    console.error("\nParity check failed. Please synchronize the diverging fields via the Cloudflare Dashboard.");
    process.exit(1);
  } else {
    console.log("\nAll required fields are in parity.");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
