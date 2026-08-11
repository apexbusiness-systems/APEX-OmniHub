/**
 * Semantic Translator
 * Translates canonical events to app-specific formats
 *
 * APEX REGRESSION SHIELD: Provides Zod runtime validation
 * against CanonicalEventSchema to prevent malformed payloads
 * from causing unhandled TypeErrors in the React state tree.
 */

import { CanonicalEvent } from '../types/canonical';
import { CanonicalEventSchema } from '../types/schema';
import { type LangCode } from '@/i18n/locales';

export interface TranslatedEvent {
  eventId: string;
  correlationId: string;
  appId: string;
  userId?: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/**
 * Extract raw payload/metadata safely from an untrusted event object.
 * Used when Zod validation fails and the event shape is unknown.
 */
function extractRawFields(event: CanonicalEvent): {
  rawPayload: Record<string, unknown>;
  rawMetadata: Record<string, unknown>;
} {
  const raw = event as unknown as Record<string, unknown>;
  const rawPayload =
    typeof raw['payload'] === 'object' && raw['payload'] !== null
      ? (raw['payload'] as Record<string, unknown>)
      : {};
  const rawMetadata =
    typeof raw['metadata'] === 'object' && raw['metadata'] !== null
      ? (raw['metadata'] as Record<string, unknown>)
      : {};
  return { rawPayload, rawMetadata };
}

/**
 * Build a DROPPED result when schema validation fails.
 */
function buildDroppedResult(
  event: CanonicalEvent,
  correlationId: string,
  appId: string,
  errorMessage: string
): TranslatedEvent {
  const { rawPayload, rawMetadata } = extractRawFields(event);
  return {
    eventId: event.eventId ? String(event.eventId) : 'unknown_event_id',
    correlationId,
    appId,
    userId: event.userId ? String(event.userId) : undefined,
    payload: {
      ...rawPayload,
      _translation_status: 'DROPPED',
      _error: 'Malformed Payload Schema',
      _details: errorMessage,
    },
    metadata: {
      ...rawMetadata,
      risk_lane: 'RED',
      audit_reason: 'schema_validation_failed',
    },
  };
}

/**
 * Normalize a raw locale string (trim whitespace, replace _ with -).
 */
function normalizeLocale(l: string): string {
  return l.trim().replaceAll('_', '-');
}

/**
 * Map a two-letter country code to an ISO-639-1 language code.
 * Only well-known mappings are returned; unknown codes yield null.
 */
function countryCodeToLang(cc: string): string | null {
  const map: Record<string, string> = {
    FR: 'fr', DE: 'de', ES: 'es', JP: 'ja', PT: 'pt', CN: 'zh',
    BR: 'pt', MX: 'es', AT: 'de', CH: 'de', BE: 'fr', CA: 'en',
    US: 'en', GB: 'en', AU: 'en',
  };
  return map[cc.trim().toUpperCase()] ?? null;
}

/**
 * Resolve target locale from event metadata.
 *
 * Priority:
 *  1. metadata.locale (explicit BCP-47 tag → base lang extracted)
 *  2. metadata.location.countryCode → mapped language
 *  3. metadata.countryCode → mapped language
 *  4. Fallback: 'en'
 */
function resolveTargetLocale(event: CanonicalEvent): string {
  const md = event.metadata ?? {};
  const explicit = md['locale'];
  if (typeof explicit === 'string' && explicit.trim()) {
    // Extract base language from BCP-47 (e.g. 'fr-FR' → 'fr')
    return normalizeLocale(explicit).split('-')[0].toLowerCase();
  }

  const loc = md['location'];
  let cc = '';
  if (
    typeof loc === 'object' &&
    loc !== null &&
    'countryCode' in loc &&
    typeof loc.countryCode === 'string'
  ) {
    cc = String(loc.countryCode);
  } else if (typeof md['countryCode'] === 'string') {
    cc = String(md['countryCode']);
  }

  return (cc ? countryCodeToLang(cc) : null) ?? 'en';
}

/**
 * Semantic translator for app-specific event formats
 */
export class SemanticTranslator {
  private readonly translators = new Map<
    string,
    (event: CanonicalEvent) => TranslatedEvent
  >();

  // Local deterministic dictionary for demo purposes
  private static readonly DICTIONARY: Record<string, Record<string, string>> = {
    'fr': {
      'Hello Translator': 'Bonjour Traducteur',
      'Hello': 'Bonjour',
      'Settings': 'Paramètres',
      'Language': 'Langue',
      'Save': 'Enregistrer'
    },
    'es': {
      'Hello Translator': 'Hola Traductor',
      'Hello': 'Hola',
      'Settings': 'Configuración',
      'Language': 'Idioma',
      'Save': 'Guardar'
    }
  };

  // ⚡ Bolt: Pre-calculated reverse dictionary for O(1) lookups during detranslation
  private static readonly REVERSE_DICTIONARY: Record<string, Record<string, string>> =
    Object.fromEntries(
      Object.entries(SemanticTranslator.DICTIONARY).map(([lang, dict]) => [
        lang,
        Object.fromEntries(Object.entries(dict).map(([k, v]) => [v, k]))
      ])
    );

  private isTranslatable(val: unknown): boolean {
    if (typeof val !== 'string') return false;
    // Skip typical identifiers or technical tokens
    if (/^[0-9a-fA-F-]{36}$/.exec(val)) return false; // UUID
    if (val.startsWith('http://') || val.startsWith('https://')) return false;
    if (val.includes('@') && !val.includes(' ')) return false; // Basic email
    if (/^[A-Z_]+$/.exec(val)) return false; // ENUM_STYLE
    return true;
  }

  private translateValue(val: unknown, targetLang: string): unknown {
    if (Array.isArray(val)) {
      return val.map(item => this.translateValue(item, targetLang));
    }
    if (typeof val === 'object' && val !== null) {
      const result: Record<string, unknown> = {};
      for (const k in val) {
        if (Object.prototype.hasOwnProperty.call(val, k)) {
          result[k] = this.translateValue((val as Record<string, unknown>)[k], targetLang);
        }
      }
      return result;
    }
    if (!this.isTranslatable(val)) return val;
    
    const str = val as string;
    const langDict = SemanticTranslator.DICTIONARY[targetLang] || {};
    return langDict[str] || `[${targetLang}] ${str}`; // Fallback: prepend locale tag
  }

  protected detranslateValue(val: unknown, targetLang: string): unknown {
    if (Array.isArray(val)) {
      return val.map(item => this.detranslateValue(item, targetLang));
    }
    if (typeof val === 'object' && val !== null) {
      const result: Record<string, unknown> = {};
      for (const k in val) {
        if (Object.prototype.hasOwnProperty.call(val, k)) {
          result[k] = this.detranslateValue((val as Record<string, unknown>)[k], targetLang);
        }
      }
      return result;
    }
    if (typeof val !== 'string') return val;
    
    const reverseLangDict = SemanticTranslator.REVERSE_DICTIONARY[targetLang] || {};
    // ⚡ Bolt: O(1) reverse lookup instead of O(N) array iteration
    if (Object.prototype.hasOwnProperty.call(reverseLangDict, val)) {
      return reverseLangDict[val];
    }
    // Fallback: strip locale tag
    const prefix = `[${targetLang}] `;
    if (val.startsWith(prefix)) {
      return val.slice(prefix.length);
    }
    return val;
  }

  async translate(
    events: CanonicalEvent[],
    appId: string,
    correlationId: string,
    _targetLocale: LangCode = 'en'
  ): Promise<TranslatedEvent[]> {
    if (import.meta.env.DEV) console.log(`[${correlationId}] Translating ${events.length} events for app ${appId}`);

    return events.map((event) => {
      // 0. Payload Schema Validation (Zero-Drift Enforcement)
      const validation = CanonicalEventSchema.safeParse(event);
      if (!validation.success) {
        console.error(
          `[${correlationId}] Schema validation failed for event ${event.eventId || 'UNKNOWN'}`
        );
        return buildDroppedResult(
          event,
          correlationId,
          appId,
          validation.error.message
        );
      }

      const validEvent = validation.data;
      const originalPayload = JSON.stringify(validEvent.payload);

      // Resolve locale from event metadata; defaults to 'en'
      const targetLocale = resolveTargetLocale(event);

      // 1. Forward Translate
      const translatedPayload: Record<string, unknown> = {};
      for (const key in validEvent.payload) {
        if (Object.prototype.hasOwnProperty.call(validEvent.payload, key)) {
          translatedPayload[key] = this.translateValue(validEvent.payload[key], targetLocale);
        }
      }

      // 2. Verification (Back Translate)
      const backTranslated: Record<string, unknown> = {};
      for (const key in translatedPayload) {
        if (Object.prototype.hasOwnProperty.call(translatedPayload, key)) {
          backTranslated[key] = this.detranslateValue(translatedPayload[key], targetLocale);
        }
      }

      // 3. Equivalence Check
      const backTranslatedStr = JSON.stringify(backTranslated);
      if (originalPayload !== backTranslatedStr) {
        console.error(
          `[${correlationId}] Translation verification failed for event ${event.eventId}`
        );
        // FAIL-CLOSED: Tag as failed, do not forward corrupted content
        return {
          eventId: validEvent.eventId,
          correlationId,
          appId,
          userId: validEvent.userId,
          payload: {
            ...validEvent.payload,
            _translation_status: 'FAILED',
            _error: 'Verification failed',
          },
          metadata: {
            ...validEvent.metadata,
            risk_lane: 'RED',
            audit_reason: 'translation_verification_failed',
          },
        };
      }

      return {
        eventId: validEvent.eventId,
        correlationId,
        appId,
        userId: validEvent.userId,
        payload: translatedPayload,
        metadata: {
          ...validEvent.metadata,
          locale: targetLocale,
          verified: true,
        },
      };
    });
  }

  registerTranslator(
    appId: string,
    translator: (event: CanonicalEvent) => TranslatedEvent
  ): void {
    this.translators.set(appId, translator);
  }

  unregisterTranslator(appId: string): boolean {
    return this.translators.delete(appId);
  }
}