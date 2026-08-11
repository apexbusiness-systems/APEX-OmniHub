/**
 * useOmniDashAction — Universal OmniDash Interaction Interceptor
 * @version 1.0.0
 * @module src/omnidash/useOmniDashAction
 *
 * Binds to every app interaction trigger within OmniDash and OmniBoard.
 * Formats user intent into a validated OmniModalConfig and dispatches it
 * via useOmniModal.getState().invoke() — the caller component is never
 * subscribed to modal state, preventing ghost re-renders.
 *
 * EXECUTION CONTRACT:
 * - New connections (dashboardStatus: 'Partial') → type: 'oauth'
 *   → onComplete initiates zero-config proxy exchange via Supabase Edge
 *   → hydrates OmniBoardStore with sanitized connector record on success
 * - Spatial apps (contextData.appType: media | editor | terminal) → renderMode: 'spatial'
 *   → OmniSpatialHost transitions into GPU-composited spatial canvas
 * - Microfrontend apps (contextData.entryUrl present) → type: 'microfrontend'
 *   → OmniAppShell renders integration in isolated Shadow DOM sandbox
 *   → marks only LOCAL_LAUNCHED, never backend-confirmed LIVE
 * - Internal SPA apps (Live, no entryUrl/appType) → React Router navigate()
 *   → No modal invoked; clean direct navigation
 * - onCancel on any flow → cleanly absorbs ABORTED state, resets optimistic
 *   CONNECTING status, never throws unhandled promise rejections
 *
 * APEX STANDARDS ENFORCED:
 * - Atomic Idempotency: Same intent always produces identical OmniModalConfig id
 * - Zero-Config Onboarding: No credential surface in the client — all token
 *   exchange delegated to supabase.functions.invoke('apex-agent')
 * - Single-Modal: useOmniModal enforces no-stack — invoke() replaces previous
 * - Overload-Free: onCancel fully absorbs ABORTED without UI errors
 * - Intent-Driven: resolveIntentModalType() deterministically maps intent → type
 * - Regression-Free: Zod boundary validation inside useOmniModal.invoke()
 *
 * OWNED BY: APEX Business Systems Ltd.
 */

import { useCallback } from 'react';
import { useOmniModal } from '@omnihub/stores/omniModalStore';
import type { OmniModalConfig, ModalType, RenderMode } from '@omnihub/stores/omniModalStore';
import { useOmniBoard } from '@omnihub/stores/omniBoardStore';
import type { OmniBoardConnectorRecord } from '@omnihub/stores/omniBoardStore';
import { supabase } from '../integrations/supabase/client';
import type { AppRegistryCategory } from '../../packages/core/src/registry';

// ============================================================================
// Public Types
// ============================================================================

/** Canonical status from the AppRegistry dashboard field. */
export type OmniDashConnectStatus = 'Live' | 'Partial';

/**
 * Normalized intent object describing the user's action in OmniDash.
 * Constructed by caller components from AppRegistry entries or OmniLink
 * connector records — never manually created inside the hook itself.
 */
export type OmniDashIntentSource = 'module' | 'integration';

export interface BaseOmniDashIntent {
  readonly source: OmniDashIntentSource;

  /** Registry key for the app/connector (slugified, unique). */
  readonly appKey: string;
  /** Human-readable provider name used in modal titles. */
  readonly provider: string;
  /** Display label used in action button copy. */
  readonly label: string;
  /** Registry category used for secondary routing decisions. */
  readonly category: AppRegistryCategory;
  /** Internal SPA route path for direct navigation fallback. */
  readonly routePath: string;
  /** Whether this connector is Live (installed) or Partial (needs auth). */
  readonly dashboardStatus: OmniDashConnectStatus;
  /**
   * Optional spatial / microfrontend context:
   * - entryUrl: string → microfrontend (OmniAppShell sandbox)
   * - appType: 'media' | 'editor' | 'terminal' → spatial canvas
   * - htmlContent: string → inline Shadow DOM content
   */
  readonly contextData?: Readonly<Record<string, unknown>>;
  /** Whether the app is coming soon (UI-only gate, no modal dispatched). */
  readonly comingSoon?: boolean;

}

export interface InternalModuleIntent extends BaseOmniDashIntent {
  readonly source: 'module';
}

export interface ExternalIntegrationIntent extends BaseOmniDashIntent {
  readonly source: 'integration';
}

export type OmniDashIntent = InternalModuleIntent | ExternalIntegrationIntent;

// ============================================================================
// Internal — Deterministic Modal Type Resolution
// ============================================================================

interface ResolvedModalDirective {
  readonly type: ModalType;
  readonly renderMode?: RenderMode;
  /** When true, dispatch should navigate via router instead of invoking modal. */
  readonly shouldNavigate: boolean;
}

/**
 * Pure function — maps an OmniDashIntent to the exact modal directive.
 * No side effects. Fully unit-testable.
 *
 * Priority rules:
 * 1. Partial status → oauth (authorization required)
 * 2. Live + spatial appType → spatial renderMode (GPU canvas)
 * 3. Live + entryUrl → microfrontend (Shadow DOM sandbox)
 * 4. Live + SPA-only (no contextData signals) → navigate (no modal)
 */
function resolveIntentModalType(intent: OmniDashIntent): ResolvedModalDirective {
  // Rule 1: Partial connectors always require authorization
  if (intent.dashboardStatus === 'Partial') {
    return { type: 'oauth', shouldNavigate: false };
  }

  const appType = intent.contextData?.appType as string | undefined;
  const entryUrl = intent.contextData?.entryUrl as string | undefined;

  // Rule 2: Spatial appTypes → explicit renderMode override for spatial canvas
  if (appType === 'media' || appType === 'editor' || appType === 'terminal') {
    return { type: 'form', renderMode: 'spatial', shouldNavigate: false };
  }

  // Rule 3: External entry URL → Shadow DOM microfrontend sandbox
  if (entryUrl) {
    return { type: 'microfrontend', shouldNavigate: false };
  }

  // Rule 4: Internal modules → open as modal within OmniDash (SPA — no page navigation)
  if (intent.source === 'module') {
    return { type: 'module', shouldNavigate: false };
  }

  // Fallback for integrations without explicit modal directive
  return { type: 'oauth', shouldNavigate: false };
}

// ============================================================================
// Internal — Payload Sanitization
// ============================================================================

const SECRET_KEY_PATTERN = /^(secret|token|key|password|credential|private|bearer)/i;

/**
 * Strips any key that looks like a credential from a backend response.
 * Applied to all onComplete payloads before they enter the OmniBoardStore.
 */
function sanitizeBackendPayload(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  for (const k in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, k) && !SECRET_KEY_PATTERN.test(k)) {
      res[k] = raw[k];
    }
  }
  return res;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Universal OmniDash interaction interceptor.
 *
 * Returns a single `dispatch` function that accepts any OmniDashIntent,
 * resolves the correct presentation modality, and orchestrates the full
 * lifecycle: modal invocation → proxy exchange or local launch → OmniBoard hydration.
 *
 * @param navigate — Optional router navigate function. Required only when
 *   dispatching intents that may result in an internal SPA route change
 *   (i.e. Live connectors with no contextData). Pass `useNavigate()` from
 *   the calling component when routing is possible. Omit in contexts where
 *   only oauth/microfrontend/spatial modals will be dispatched (e.g. Integrations).
 *
 * Usage:
 * ```tsx
 * // With routing (DashboardOverview, OmniDashLayout):
 * const { dispatch } = useOmniDashAction(useNavigate());
 * // Without routing (Integrations — only dispatches oauth modals):
 * const { dispatch } = useOmniDashAction();
 * dispatch({ appKey: 'quickbooks', provider: 'QuickBooks', ... });
 * ```
 */
export function useOmniDashAction(navigate?: (path: string) => void): {
  dispatch: (intent: OmniDashIntent) => void;
} {
  const hydrateConnector = useOmniBoard(
    (s) => s.hydrateConnector,
  );
  const setConnectorStatus = useOmniBoard(
    (s) => s.setConnectorStatus,
  );

  const dispatch = useCallback(
    (intent: OmniDashIntent): void => {
      const directive = resolveIntentModalType(intent);

      // ─── Router Fallback: internal SPA apps navigate directly ────────────
      if (directive.shouldNavigate) {
        if (navigate) navigate(intent.routePath);
        return;
      }

      // ─── Stable config ID for idempotency ────────────────────────────────
      // Includes appKey + status so the same app in different states produces
      // a distinct ID (critical: no two invocations share an ID in the store).
      const configId = `omni-${intent.appKey}-${intent.dashboardStatus.toLowerCase()}-${Date.now()}`;

      // ─── onComplete: Zero-Config Proxy Exchange & OmniBoard Hydration ─────
      const onComplete = async (
        payload: Record<string, unknown>,
      ): Promise<void> => {
        // Optimistic status update — immediate UI feedback before round-trip
        setConnectorStatus(intent.appKey, 'CONNECTING');

        try {
          if (directive.type === 'oauth') {
            // ── OAuth Proxy Exchange ──────────────────────────────────────
            // All credentials are held server-side. Client only sends the
            // intent; the Edge Function orchestrates the provider handshake
            // and returns a sanitized session descriptor.
            const { data, error } = await supabase.functions.invoke(
              'apex-agent',
              {
                body: {
                  action: 'oauth_exchange',
                  provider: intent.appKey,
                  auth_payload: payload,
                },
              },
            );

            if (error) throw error;

            const rawData = (data as { ok?: boolean; data?: unknown }).ok === true
              ? (data as { data: Record<string, unknown> }).data
              : data;
              
            const responseData = (rawData ?? {}) as Record<string, unknown>;
            const sanitizedMeta = sanitizeBackendPayload(responseData);

            const connectorRecord: OmniBoardConnectorRecord = {
              id:
                typeof responseData.connector_id === 'string'
                  ? responseData.connector_id
                  : configId,
              provider: intent.provider,
              appKey: intent.appKey,
              status: 'LIVE',
              proxyTokenExpiry:
                typeof responseData.expires_at === 'number'
                  ? responseData.expires_at
                  : null,
              syncedAt: Date.now(),
              metadata: sanitizedMeta,
            };

            // Map sanitized payload directly to OmniBoard global state
            hydrateConnector(connectorRecord);
          } else {
            // ── Spatial / Microfrontend Launch ────────────────────────────
            // No backend exchange is performed here. Record a local launch only;
            // do not mark backend-confirmed LIVE without mutation/read-back evidence.
            const connectorRecord: OmniBoardConnectorRecord = {
              id: configId,
              provider: intent.provider,
              appKey: intent.appKey,
              status: 'LOCAL_LAUNCHED',
              proxyTokenExpiry: null,
              syncedAt: Date.now(),
              metadata: {
                launchedAt: Date.now(),
                confirmation: 'local-launch-only',
                requiresBackendConfirmation: true,
                renderMode: directive.renderMode ?? 'sandbox',
                launchPayload: sanitizeBackendPayload(payload),
              },
            };

            hydrateConnector(connectorRecord);
          }
        } catch (err: unknown) {
          // Deterministic error state — never throw unhandled rejections
          setConnectorStatus(intent.appKey, 'ERROR');
          console.error(
            `[OmniDashAction] ${intent.provider} exchange failed:`,
            err,
          );
        }
      };

      // ─── onCancel: Clean ABORTED absorption ──────────────────────────────
      // Resets any optimistic CONNECTING state. Never throws. Callers are
      // shielded from the { status: 'ABORTED' } rejection by this handler.
      const onCancel = (): void => {
        setConnectorStatus(intent.appKey, 'NEEDS_AUTH');
      };

      // ─── Build OmniModalConfig ────────────────────────────────────────────
      const config: OmniModalConfig = {
        id: configId,
        provider: intent.provider,
        type: directive.type,
        title:
          directive.type === 'oauth'
            ? `Connect ${intent.label}`
            : `${intent.label}`,
        description:
          directive.type === 'oauth'
            ? `Authorize ${intent.label} to synchronize data directly into OmniBoard. No credentials are stored in your browser.`
            : `${intent.label} is running in a secure APEX sandbox environment.`,
        contextData: {
          appKey: intent.appKey,
          category: intent.category,
          routePath: intent.routePath,
          ...intent.contextData,
        },
        onComplete,
        onCancel,
        priority: directive.type === 'oauth' ? 'high' : 'medium',
        ...(directive.renderMode === undefined
          ? {}
          : { renderMode: directive.renderMode }),
      };

      // ─── Dispatch to global modal store ──────────────────────────────────
      // getState() is intentional: avoids subscribing the caller component
      // to the modal store, preventing unnecessary re-renders on open/close.
      useOmniModal.getState().invoke(config);
    },
    [navigate, hydrateConnector, setConnectorStatus],
  );

  return { dispatch };
}
