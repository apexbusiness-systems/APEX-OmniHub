/**
 * check-accepted-risk.test.mjs — Unit & Negative Test Suite for ACCEPTED_RISKS Gate
 */
import { validateAcceptedRisks } from "../../scripts/ci/check-accepted-risk.mjs";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

console.log("=== Running ACCEPTED_RISKS Test Suite ===");

// 1. Positive Test: Valid active risk
{
  const sample = JSON.stringify({
    accepted_risks: [
      {
        id: "RISK-001",
        package: "test-pkg",
        owner: "dev@apex.com",
        reason: "Testing",
        risk_assessment: "Low risk in dev build",
        approved_date: "2026-07-01",
        expiry_date: "2026-09-20"
      }
    ]
  });

  const res = validateAcceptedRisks(sample, { currentDate: "2026-07-31" });
  assert(res.valid === true, "Valid risk entry passes validation");
}

// 2. Negative Test: Expired risk (expiry < current date)
{
  const sample = JSON.stringify({
    accepted_risks: [
      {
        id: "RISK-EXPIRED",
        package: "expired-pkg",
        owner: "dev@apex.com",
        reason: "Legacy exception",
        risk_assessment: "Historical",
        approved_date: "2026-01-01",
        expiry_date: "2026-03-31"
      }
    ]
  });

  const res = validateAcceptedRisks(sample, { currentDate: "2026-07-31" });
  assert(res.valid === false, "Expired risk entry fails validation");
  assert(res.errors.some(e => e.includes("HAS EXPIRED")), "Error log identifies expired risk");
}

// 3. Negative Test: Expiry window exceeds 90 days (>90d policy breach)
{
  const sample = JSON.stringify({
    accepted_risks: [
      {
        id: "RISK-LONG-EXPIRY",
        package: "long-pkg",
        owner: "dev@apex.com",
        reason: "Long exception",
        risk_assessment: "High risk",
        approved_date: "2026-07-01",
        expiry_date: "2026-12-31" // ~183 days
      }
    ]
  });

  const res = validateAcceptedRisks(sample, { currentDate: "2026-07-31" });
  assert(res.valid === false, "Risk entry with >90d expiry window fails validation");
  assert(res.errors.some(e => e.includes("exceeds maximum policy limit of 90 days")), "Error log identifies >90d policy breach");
}

// 4. Negative Test: Missing owner field
{
  const sample = JSON.stringify({
    accepted_risks: [
      {
        id: "RISK-NO-OWNER",
        package: "no-owner-pkg",
        reason: "No owner provided",
        risk_assessment: "Unassigned risk",
        approved_date: "2026-07-01",
        expiry_date: "2026-09-01"
      }
    ]
  });

  const res = validateAcceptedRisks(sample, { currentDate: "2026-07-31" });
  assert(res.valid === false, "Risk entry missing owner fails validation");
  assert(res.errors.some(e => e.includes("missing or empty 'owner'")), "Error log identifies missing owner");
}

console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
