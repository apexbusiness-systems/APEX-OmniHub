/**
 * ApexAppsMcpModule — First-party APEX ecosystem app connect over MCP / OmniPort.
 *
 * A SEPARATE, INDEPENDENT modal (its own OmniSpatialHost dialog) — distinct from
 * the OmniBoardWizard, which owns third-party provider connections. Opened by
 * "Add APEX App" via module key `apex-apps-mcp` (see omniSurfaceOwnership.ts).
 *
 * Zero-friction, prompt-first UX: the user describes the app in natural language
 * ("connect my notes app"), we resolve it against the live APEX ecosystem
 * registry, confirm with one tap, then launch that app's OmniPort so they can
 * connect and chat. No backend work, no keys, nothing technical to configure.
 *
 * HONEST GATEWAY: we never mark an app "connected" without a verified record.
 * Launching opens the app's real OmniPort surface; durable MCP install-state
 * persistence is a tracked follow-up (APEX-APPS-MCP-PERSIST).
 *
 * OWNED BY: APEX Business Systems Ltd.
 */
import { useMemo, useState, useCallback } from 'react';
import { LIVE_APEX_APPS } from '../../contracts/apexApps';
import { resolveApexApp, type ApexApp } from './apexAppsResolve';
import { supabase } from '@/lib/supabase';

interface Props {
  readonly onClose: () => void;
}

type Step = 'prompt' | 'confirm' | 'not_found' | 'launched';

const ORANGE = '249,115,22';

export default function ApexAppsMcpModule({ onClose }: Props) {
  const [step, setStep] = useState<Step>('prompt');
  const [prompt, setPrompt] = useState('');
  const [resolved, setResolved] = useState<ApexApp | null>(null);

  const apps = useMemo(() => LIVE_APEX_APPS, []);

  const handleResolve = () => {
    const match = resolveApexApp(prompt);
    if (match) {
      setResolved(match);
      setStep('confirm');
    } else {
      setResolved(null);
      setStep('not_found');
    }
  };

  const handleConnect = () => {
    if (!resolved) return;
    // Real, verifiable handoff: open the chosen app's OmniPort in a new tab.
    // This never navigates the current OmniHub tab away (_blank is enforced).
    if (typeof window !== 'undefined') {
      window.open(resolved.url, '_blank', 'noopener,noreferrer');
    }
    setStep('launched');
  };

  // PRCC-TASK3: Write user-confirmed install state to apex_app_installs.
  // Called only when the user explicitly clicks "It connected!" in the
  // launched step. Never called for cancelled or skipped flows.
  // Best-effort, non-blocking — a write failure must not block the user.
  const confirmInstall = useCallback(async (app: ApexApp) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('apex_app_installs').upsert(
      {
        user_id: user.id,
        app_id: app.id,
        app_label: app.label,
        app_url: app.url,
        status: 'user_confirmed',
      },
      { onConflict: 'user_id,app_id' },
    ).then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error('[ApexAppsMcpModule] confirmInstall failed:', error.message);
    });
  }, []);

  const reset = () => {
    setPrompt('');
    setResolved(null);
    setStep('prompt');
  };

  // ── Prompt step ────────────────────────────────────────────────────────────
  if (step === 'prompt' || step === 'not_found') {
    return (
      <div className="flex flex-col gap-4" data-testid="apex-apps-mcp">
        <label htmlFor="apex-apps-prompt" className="text-sm text-muted-foreground">
          Describe the APEX app you want to connect — just type it in plain words.
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="apex-apps-prompt"
            data-testid="apex-apps-prompt-input"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleResolve();
              }
            }}
            placeholder="e.g. connect my DueRadar"
            aria-label="Describe the APEX app to connect"
            autoFocus
            className="min-h-11 flex-1 rounded-lg border border-white/15 bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/70"
          />
          <button
            type="button"
            data-testid="apex-apps-resolve-button"
            onClick={handleResolve}
            disabled={prompt.trim().length === 0}
            className={[
              'min-h-11 rounded-lg px-4 text-sm font-semibold text-white transition-opacity',
              prompt.trim().length === 0
                ? 'cursor-not-allowed bg-primary/40'
                : 'bg-primary hover:opacity-90',
            ].join(' ')}
          >
            Find app
          </button>
        </div>

        {step === 'not_found' && (
          <div
            data-testid="apex-apps-notfound"
            role="status"
            aria-live="polite"
            className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-300"
          >
            We couldn’t match “{prompt.trim()}” to an APEX app yet. Pick one below or
            try a different name.
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Available APEX apps
          </span>
          <div className="flex flex-wrap gap-2">
            {apps.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setResolved(a);
                  setPrompt(a.label);
                  setStep('confirm');
                }}
                className="min-h-11 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-medium text-foreground hover:border-primary/60"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Confirm step ───────────────────────────────────────────────────────────
  if (step === 'confirm' && resolved) {
    return (
      <div className="flex flex-col gap-4" data-testid="apex-apps-mcp">
        <div
          data-testid="apex-apps-confirm-card"
          className="rounded-xl border px-4 py-4"
          style={{ borderColor: `rgba(${ORANGE},0.35)`, background: `rgba(${ORANGE},0.06)` }}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            APEX App
          </div>
          <div className="mt-1 text-lg font-semibold text-foreground">{resolved.label}</div>
          <div className="mt-0.5 break-all text-xs text-muted-foreground">{resolved.url}</div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            We’ll open {resolved.label}’s OmniPort so you can connect and chat — no
            keys or setup needed.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid="apex-apps-not-this"
            onClick={reset}
            className="min-h-11 rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
          >
            Not this
          </button>
          <button
            type="button"
            data-testid="apex-apps-connect-button"
            onClick={handleConnect}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  // ── Launched step (honest: shows confirmation gate, not a fake "connected" badge) ──
  return (
    <div className="flex flex-col gap-4" data-testid="apex-apps-mcp">
      <div
        data-testid="apex-apps-launched"
        role="status"
        aria-live="polite"
        className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-4"
      >
        <div className="text-base font-semibold text-emerald-300">
          Opened {resolved?.label}’s OmniPort
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {resolved?.label} opened in a new tab. Finish connecting there, then
          confirm below so APEX OmniHub can reflect your connection.
        </p>
        {resolved && (
          <a
            href={resolved.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-xs font-semibold text-primary underline"
          >
            Open {resolved.label} again ↗
          </a>
        )}
      </div>

      {/* PRCC-TASK3: Confirmation gate — user tells OmniHub the connection worked.
          "It connected!" → upserts apex_app_installs (status: user_confirmed)
          → App Gallery can reflect real state on next load.
          "Skip" → closes without writing — honest: connection state stays unknown. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          data-testid="apex-apps-skip-confirm"
          onClick={reset}
          className="min-h-11 rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
        >
          Connect another
        </button>
        <button
          type="button"
          data-testid="apex-apps-skip-done"
          onClick={onClose}
          className="min-h-11 rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground border border-white/10"
        >
          Skip — I’ll confirm later
        </button>
        <button
          type="button"
          data-testid="apex-apps-confirm-connected"
          onClick={async () => {
            if (resolved) await confirmInstall(resolved);
            onClose();
          }}
          className="min-h-11 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          It connected! ✔
        </button>
      </div>
    </div>
  );
}
