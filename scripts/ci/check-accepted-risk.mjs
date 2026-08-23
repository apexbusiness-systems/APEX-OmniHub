#!/usr/bin/env node
/**
 * check-accepted-risk.mjs — Gate validator for ACCEPTED_RISKS.json
 *
 * Enforces:
 * 1. ACCEPTED_RISKS.json schema compliance (id, package, owner, reason, risk_assessment, approved_date, expiry_date).
 * 2. Mandatory owner & risk assessment non-empty fields.
 * 3. Expiry date policy: approved_date -> expiry_date window MUST be <= 90 days.
 * 4. Expiry date check: expiry_date MUST NOT be in the past relative to evaluation date.
 *
 * Zero external dependencies. Exit 0 = valid, Exit 1 = policy violation.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateAcceptedRisks(fileContent, options = {}) {
  const currentDateStr = options.currentDate || new Date().toISOString().split("T")[0];
  const currentDate = new Date(currentDateStr + "T00:00:00Z");
  const errors = [];

  let data;
  try {
    data = JSON.parse(fileContent);
  } catch (err) {
    return { valid: false, errors: [`JSON parse error in ACCEPTED_RISKS: ${err.message}`] };
  }

  if (!data || !Array.isArray(data.accepted_risks)) {
    return { valid: false, errors: ["ACCEPTED_RISKS.json missing required array field 'accepted_risks'"] };
  }

  const maxExpiryDays = data.policy?.max_expiry_days ?? 90;

  for (const [idx, item] of data.accepted_risks.entries()) {
    const prefix = `Entry #${idx + 1} (${item.id || item.package || "unnamed"})`;

    if (!item.id || typeof item.id !== "string" || item.id.trim() === "") {
      errors.push(`${prefix}: missing or empty 'id'`);
    }
    if (!item.package || typeof item.package !== "string" || item.package.trim() === "") {
      errors.push(`${prefix}: missing or empty 'package'`);
    }
    if (!item.owner || typeof item.owner !== "string" || item.owner.trim() === "") {
      errors.push(`${prefix}: missing or empty 'owner'`);
    }
    if (!item.reason || typeof item.reason !== "string" || item.reason.trim() === "") {
      errors.push(`${prefix}: missing or empty 'reason'`);
    }
    if (!item.risk_assessment || typeof item.risk_assessment !== "string" || item.risk_assessment.trim() === "") {
      errors.push(`${prefix}: missing or empty 'risk_assessment'`);
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!item.approved_date || !dateRegex.test(item.approved_date)) {
      errors.push(`${prefix}: invalid 'approved_date' format (expected YYYY-MM-DD, got '${item.approved_date}')`);
    }
    if (!item.expiry_date || !dateRegex.test(item.expiry_date)) {
      errors.push(`${prefix}: invalid 'expiry_date' format (expected YYYY-MM-DD, got '${item.expiry_date}')`);
    }

    if (dateRegex.test(item.approved_date) && dateRegex.test(item.expiry_date)) {
      const approved = new Date(item.approved_date + "T00:00:00Z");
      const expiry = new Date(item.expiry_date + "T00:00:00Z");

      if (isNaN(approved.getTime())) {
        errors.push(`${prefix}: unparseable 'approved_date' '${item.approved_date}'`);
      }
      if (isNaN(expiry.getTime())) {
        errors.push(`${prefix}: unparseable 'expiry_date' '${item.expiry_date}'`);
      }

      if (!isNaN(approved.getTime()) && !isNaN(expiry.getTime())) {
        const diffMs = expiry.getTime() - approved.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          errors.push(`${prefix}: expiry_date (${item.expiry_date}) is before approved_date (${item.approved_date})`);
        } else if (diffDays > maxExpiryDays) {
          errors.push(`${prefix}: risk approval window of ${diffDays} days exceeds maximum policy limit of ${maxExpiryDays} days`);
        }

        if (expiry.getTime() < currentDate.getTime()) {
          errors.push(`${prefix}: accepted risk HAS EXPIRED on ${item.expiry_date} (current evaluation date: ${currentDateStr})`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    count: data.accepted_risks.length
  };
}

// CLI Execution entry point
const mainScriptUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === mainScriptUrl) {
  const root = resolve(import.meta.dirname, "..", "..");
  const filePath = resolve(root, "ACCEPTED_RISKS.json");

  if (!existsSync(filePath)) {
    console.error("[check-accepted-risk] FAIL — ACCEPTED_RISKS.json does not exist in repository root!");
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf8");
  const result = validateAcceptedRisks(content);

  if (!result.valid) {
    console.error("[check-accepted-risk] FAIL — ACCEPTED_RISKS validation errors:");
    for (const err of result.errors) {
      console.error(" - " + err);
    }
    process.exit(1);
  }

  console.log(`[check-accepted-risk] OK — All ${result.count} accepted risk entries are valid, owned, and within <=90d expiry windows.`);
  process.exit(0);
}
