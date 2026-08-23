import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// Accepted high/critical vulnerabilities (e.g. non-applicable to client-only SPA)
const ACCEPTED_ADVISORIES = new Set([
  'GHSA-qwww-vcr4-c8h2', // React Router RSC Mode CSRF Bypass; APEX OmniHub is a Vite client SPA (RSC mode not enabled)
]);

console.log('Running npm security audit (production dependencies only)...');
let raw = '';
try {
  raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8' });
} catch (e) {
  raw = e.stdout || '';
}

try {
  const json = JSON.parse(raw);
  const getAdvIds = (item) =>
    (item.via || []).flatMap((vi) =>
      typeof vi === 'object'
        ? [(vi.url || '').split('/').pop()]
        : json.vulnerabilities && json.vulnerabilities[vi]
        ? getAdvIds(json.vulnerabilities[vi])
        : []
    );

  const unacceptedVulns = Object.values(json.vulnerabilities || {}).filter((v) => {
    if (v.severity !== 'high' && v.severity !== 'critical') return false;
    const advs = getAdvIds(v);
    return advs.length === 0 || advs.some((id) => !ACCEPTED_ADVISORIES.has(id));
  });

  if (unacceptedVulns.length > 0) {
    console.error('High/critical vulnerabilities found in production dependencies:', JSON.stringify(unacceptedVulns, null, 2));
    process.exit(1);
  }

  console.log('✅ No un-accepted high/critical vulnerabilities in production dependencies');
} catch (e) {
  console.error('Failed to parse npm audit output:', e);
  process.exit(1);
}
