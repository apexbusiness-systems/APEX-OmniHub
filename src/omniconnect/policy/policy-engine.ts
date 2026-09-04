/**
 * Policy Engine
 * Filters events based on app-specific policies
 */

import { CanonicalEvent, DataClassification, EventType } from '../types/canonical';
import { AppFilterProfile } from '../types/policy';
import { ValidationResult } from '../types/validation';
import { SchemaValidator } from './schema-validator';

/**
 * Policy engine for filtering and transforming events
 */
export class PolicyEngine {
  private readonly profiles = new Map<string, AppFilterProfile>();
  private readonly schemaValidator = new SchemaValidator();
  private readonly compiledRegexCache = new WeakMap<string[], RegExp>();

  private getRegex(list: string[]): RegExp {
    let regex = this.compiledRegexCache.get(list);
    if (!regex) {
      const escapedList = list.map(c => c.split("").map(char => /[.*+?^${}()|[\]\\]/.test(char) ? "\\" + char : char).join(""));
      regex = new RegExp(escapedList.join("|"), "i");
      this.compiledRegexCache.set(list, regex);
    }
    return regex;
  }

  async filter(
    events: CanonicalEvent[],
    appId: string,
    correlationId: string
  ): Promise<CanonicalEvent[]> {
    const profile = await this.getProfile(appId);
    if (!profile) {
      console.warn(`[${correlationId}] SECURITY BLOCK: No policy profile for app ${appId}. Failing closed.`);
      return [];
    }

    if (import.meta.env.DEV) console.log(`[${correlationId}] Applying policy filter for app ${appId}, ${events.length} events`);

    const filteredEvents: CanonicalEvent[] = [];

    for (const event of events) {
      if (this.shouldInclude(event, profile)) {
        filteredEvents.push(this.transform(event, profile));
      }
    }

    return filteredEvents;
  }

  async getProfile(appId: string): Promise<AppFilterProfile | null> {
    return this.profiles.get(appId) || null;
  }

  async setProfile(profile: AppFilterProfile): Promise<void> {
    this.profiles.set(profile.appId, profile);
  }

  async validateEvent(event: CanonicalEvent, appId: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const correlationId = event.correlationId || 'unknown';

    // 1. Schema Validation
    const schemaResult = this.schemaValidator.validate(event.eventType, event.payload);
    if (!schemaResult.valid) {
      errors.push(...schemaResult.errors);
    }

    // 2. Consent & Privacy (Critical Compliance)
    if (
      (event.classification === DataClassification.SENSITIVE ||
        event.classification === DataClassification.CRITICAL) &&
      !event.consentFlags.explicit_opt_in
    ) {
      errors.push("Consent missing: Sensitive/Critical data requires 'explicit_opt_in'");
    }

    // 3. Temporal Sanity
    const now = Date.now();
    const eventTime = new Date(event.timestamp).getTime();

    // Future check (5000ms buffer)
    if (eventTime > now + 5000) {
      errors.push(`Temporal drift: Timestamp is in the future (${event.timestamp})`);
    }

    // Stale check (24h) - skipped for HISTORICAL_IMPORT
    if (
      event.eventType !== EventType.HISTORICAL_IMPORT &&
      eventTime < now - 24 * 60 * 60 * 1000
    ) {
      errors.push(`Temporal drift: Event is too old (${event.timestamp})`);
    }

    // 4. App Policy Profile Check
    const profile = await this.getProfile(appId);
    if (profile && !this.shouldInclude(event, profile)) {
      errors.push('Policy violation: Event denied by app profile configuration');
    }

    if (errors.length > 0) {
      console.warn(`[${correlationId}] Event validation failed for app ${appId}:`, errors);
    }

    return {
      valid: errors.length === 0,
      reasons: errors,
      code: errors.length > 0 ? 'VALIDATION_FAILED' : undefined,
    };
  }

  private shouldInclude(event: CanonicalEvent, profile: AppFilterProfile): boolean {
    if (!profile.allowedEventTypes.includes(event.eventType)) return false;

    const { allow, deny } = profile.contentCategories;
    const body = JSON.stringify({ p: event.payload, m: event.metadata });

    // ⚡ Bolt: Use Regex testing to replace O(N*M) array iteration with O(1) regex evaluation
    if (deny.length > 0 && this.getRegex(deny).test(body)) return false;
    
    // Fail closed: if allow list is empty, we do not allow any payload that hasn't been explicitly allowed
    if (allow.length === 0) return false;
    
    return this.getRegex(allow).test(body);
  }

  // ⚡ Bolt: Define regex outside function scope so we only compile once
  private static readonly PII_REGEX = new RegExp(['email', 'phone', 'ssn', 'address', 'name', 'user_email', 'phoneNumber'].join('|'), 'i');
  private static readonly EMOTIONAL_REGEX = new RegExp(['sentiment', 'emotion', 'mood', 'emotional', 'score', 'mood_score'].join('|'), 'i');

  private transform(event: CanonicalEvent, profile: AppFilterProfile): CanonicalEvent {
    const clone: CanonicalEvent = JSON.parse(JSON.stringify(event));

    const rules = [
      {
        enabled: profile.piiHandling !== 'allow',
        // ⚡ Bolt: Pre-compiled regex lookup is O(1) compared to O(N) array search inside object traversal. Reduces deep recursive overhead.
        keysRegex: PolicyEngine.PII_REGEX,
        apply: (o: Record<string, unknown>, k: string) => {
          o[k] = profile.piiHandling === 'redact' ? '[REDACTED]' : '***';
        }
      },
      {
        enabled: !profile.emotionalDataEnabled,
        keysRegex: PolicyEngine.EMOTIONAL_REGEX,
        apply: (o: Record<string, unknown>, k: string) => { delete o[k]; }
      }
    ];

    rules.forEach(r => {
      if (r.enabled) {
        const check = (k: string) => r.keysRegex.test(k);
        [clone.payload, clone.metadata].forEach(p => this.walk(p as Record<string, unknown>, check, r.apply));
      }
    });

    return clone;
  }

  private walk(obj: Record<string, unknown>, check: (k: string) => boolean, apply: (o: Record<string, unknown>, k: string) => void): void {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.keys(obj).forEach(k => {
      if (check(k)) {
        apply(obj, k);
      } else if (obj[k] && typeof obj[k] === 'object') {
        this.walk(obj[k] as Record<string, unknown>, check, apply);
      }
    });
  }
}
