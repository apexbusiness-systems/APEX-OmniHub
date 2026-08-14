/**
 * SettingsModule — Platform settings with live backend toggles.
 *
 * Section A: Theme (device-only, instant effect).
 * Section B: Backend-persisted platform settings (omnidash_settings table).
 *   RLS gate: (is_admin(uid) OR is_paid_user(uid)) AND user_id = auth.uid()
 *   Write errors with code '42501' = RLS rejection (insufficient privilege).
 * Section C: Layout preferences stored in localStorage (device-only).
 * Section D: Guardian Mode — connection state (honest setup CTA if unconnected).
 *
 * OWNED BY: APEX Business Systems Ltd.
 */
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOmniModuleState } from '@/hooks/useOmniModuleState';
import { useOmniModal } from '@/stores/omniModalStore';
import { useLayoutContext } from '../../contexts/LayoutContext';
import { useTheme, type ThemeType } from '../../hooks/useTheme';
import { WidgetSettingsPanel } from '../WidgetSettingsModal';
import { PWAInstallButton } from '../../../src/components/PWAInstallButton';




interface Props {
  readonly onClose: () => void;
}

const SETTING_DEFAULTS: Record<string, boolean> = {
  demo_mode: false,
  anonymize_kpis: true,
  freeze_mode: false,
  show_connected_ecosystem: false,
};

const SETTING_META: Record<string, { label: string; description: string }> = {
  demo_mode: {
    label: 'Demo Mode',
    description: 'Replaces live data with curated demo values across all widgets. Useful for presentations or onboarding.',
  },
  anonymize_kpis: {
    label: 'Anonymize KPIs',
    description: 'Masks revenue and sensitive metric values with redacted placeholders. Live counts and trends remain visible.',
  },
  freeze_mode: {
    label: 'Freeze Mode',
    description: 'Pauses all real-time data polling. Widgets display the last-known snapshot until Freeze Mode is turned off.',
  },
  show_connected_ecosystem: {
    label: 'Show Connected Ecosystem',
    description: 'Reveals the APEX Ecosystem panel that lists integrated tools and their live connection status.',
  },
};

// ⚡ Bolt: Pre-calculate Object keys and entries outside the render loop
// to prevent array allocations and GC overhead on every render.
const SETTING_KEYS = Object.keys(SETTING_META);
const SETTING_ENTRIES = Object.entries(SETTING_META);

const THEME_OPTIONS: { value: ThemeType; label: string; description: string }[] = [
  { value: 'light', label: 'Light', description: 'Light background' },
  { value: 'dark',  label: 'Dark',  description: 'Dark background' },
  { value: 'system', label: 'System', description: 'Match OS preference' },
];

const STATE_KIND_STYLES: Readonly<Record<string, { background: string; color: string; border: string }>> = {
  live:        { background: 'rgba(52,211,153,0.1)',  color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' },
  demo:        { background: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)' },
  unavailable: { background: 'rgba(239,68,68,0.1)',   color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' },
};
const DEFAULT_STATE_STYLE = { background: 'rgba(161,161,170,0.1)', color: '#a1a1aa', border: '1px solid rgba(161,161,170,0.3)' };

export default function SettingsModule({ onClose: _onClose }: Props) {
  const state = useOmniModuleState('settings');
  const { close } = useOmniModal();
  const { hiddenWidgets, panelLayout, toggleWidget, setPanelLayout, resetWidgetPositions } = useLayoutContext();
  const { theme, setTheme } = useTheme();

  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const effectiveStatus = useCallback((itemId: string, backendStatus: string): boolean => {
    if (itemId in optimistic) return optimistic[itemId];
    return backendStatus === 'active';
  }, [optimistic]);

  const handleToggle = useCallback(async (itemId: string, currentlyActive: boolean) => {
    const nextValue = !currentlyActive;
    setOptimistic(prev => ({ ...prev, [itemId]: nextValue }));
    setSaving(itemId);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Authentication required.');
        setOptimistic(prev => ({ ...prev, [itemId]: currentlyActive }));
        return;
      }

      const { error } = await supabase
        .from('omnidash_settings')
        .upsert(
          { user_id: user.id, [itemId]: nextValue, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );

      if (error) {
        if (error.code === '42501') {
          toast.error('Settings management requires admin or paid tier access.');
        } else {
          toast.error(`Failed to save setting: ${error.message}`);
        }
        setOptimistic(prev => ({ ...prev, [itemId]: currentlyActive }));
        return;
      }

      toast.success(`${SETTING_META[itemId]?.label ?? itemId} updated.`);
    } catch (err) {
      toast.error(`Failed to save setting: ${err instanceof Error ? err.message : String(err)}`);
      setOptimistic(prev => ({ ...prev, [itemId]: currentlyActive }));
    } finally {
      setSaving(null);
    }
  }, []);

  const handleResetDefaults = useCallback(async () => {
    setSaving('__reset__');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Authentication required.');
        return;
      }

      const { error } = await supabase
        .from('omnidash_settings')
        .upsert(
          {
            user_id: user.id,
            demo_mode: SETTING_DEFAULTS['demo_mode'],
            anonymize_kpis: SETTING_DEFAULTS['anonymize_kpis'],
            freeze_mode: SETTING_DEFAULTS['freeze_mode'],
            show_connected_ecosystem: SETTING_DEFAULTS['show_connected_ecosystem'],
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) {
        if (error.code === '42501') {
          toast.error('Settings management requires admin or paid tier access.');
        } else {
          toast.error(`Failed to reset settings: ${error.message}`);
        }
        return;
      }

      setOptimistic({});
      toast.success('Settings reset to defaults.');
    } catch (err) {
      toast.error(`Failed to reset settings: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(null);
    }
  }, []);

  const stateStyle = STATE_KIND_STYLES[state.stateKind] ?? DEFAULT_STATE_STYLE;
  const total = SETTING_KEYS.length;
  const enabled = SETTING_KEYS.filter(id => {
    const backendStatus = state.items.find(i => i.id === id)?.status ?? (SETTING_DEFAULTS[id] ? 'active' : 'inactive');
    return effectiveStatus(id, backendStatus);
  }).length;
  const allValidated = total > 0 && state.items.every(i => i.status !== 'error');
  const versionStat = state.stats.find(s => s.label === 'Version');

  if (state.loading) {
    return (
      <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading module data...
      </div>
    );
  }

  return (
    <div className="py-3 flex flex-col gap-4" data-testid="module-shell">
      {/* State indicator */}
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1">{state.headline}</p>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={stateStyle}
        >
          {state.stateKind.toUpperCase()}
        </span>
      </div>

      {/* Configuration health */}
      {total > 0 && (
        <div className="rounded-lg border border-border/30 px-3 py-2 bg-muted/10">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Configuration Health
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-block h-2 w-2 rounded-full ${allValidated ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <span className="text-foreground font-medium">{enabled} of {total} settings enabled</span>
            {versionStat && (
              <span className="ml-auto text-muted-foreground">{versionStat.value}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Section A: Theme (device-only, instant effect) ── */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Appearance</p>
        <div className="rounded-lg border border-border/30 bg-card px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground font-medium">Theme</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Changes the dashboard colour scheme immediately. Saved to this device.
              </p>
            </div>
          </div>
          <fieldset className="flex gap-1.5 mt-1" aria-label="Theme selection">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={theme === opt.value}
                title={opt.description}
                onClick={() => setTheme(opt.value)}
                className={[
                  'flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors',
                  theme === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/20 text-muted-foreground border-border/30 hover:text-foreground',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </fieldset>
        </div>

        {/* PWA Install Harness Option */}
        <PWAInstallButton inline />
      </div>

      {/* ── Section B: Platform Settings (backend-persisted) ── */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Platform Settings</p>
        {state.stateKind === 'unavailable' && (
          <p className="text-xs text-muted-foreground">Settings unavailable — sign in with a paid account to manage platform settings.</p>
        )}
        {SETTING_ENTRIES.map(([itemId, meta]) => {
          const backendStatus = state.items.find(i => i.id === itemId)?.status ?? (SETTING_DEFAULTS[itemId] ? 'active' : 'inactive');
          const isActive = effectiveStatus(itemId, backendStatus);
          const isSaving = saving === itemId;
          return (
            <div
              key={itemId}
              className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border border-border/30 bg-card"
            >
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-sm text-foreground font-medium">{meta.label}</span>
                <span className="text-xs text-muted-foreground leading-snug">{meta.description}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                aria-label={`Toggle ${meta.label}`}
                disabled={isSaving || saving === '__reset__' || state.stateKind === 'unavailable'}
                onClick={() => void handleToggle(itemId, isActive)}
                className={[
                  'mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  isActive ? 'bg-green-500' : 'bg-muted',
                ].join(' ')}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin text-white m-auto" />
                ) : (
                  <span
                    className={[
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform',
                      isActive ? 'translate-x-4' : 'translate-x-0',
                    ].join(' ')}
                  />
                )}
              </button>
            </div>
          );
        })}
        {total > 0 && (
          <button
            type="button"
            disabled={saving !== null || state.stateKind === 'unavailable'}
            onClick={() => void handleResetDefaults()}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50 self-start"
          >
            {saving === '__reset__' ? 'Resetting…' : 'Reset to defaults'}
          </button>
        )}
      </div>

      {/* ── Section C: Layout Preferences (localStorage, device-only) ── */}
      <div className="flex flex-col gap-2 border-t border-border/30 pt-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Layout Preferences — this device only
        </p>
        <WidgetSettingsPanel
          hiddenWidgets={hiddenWidgets}
          panelLayout={panelLayout}
          onToggleWidget={toggleWidget}
          onSetPanelLayout={setPanelLayout}
          onResetPositions={resetWidgetPositions}
          onClose={close}
        />
      </div>

      {/* ── Section D: Guardian Mode (honest setup state) ── */}
      <div className="flex flex-col gap-2 border-t border-border/30 pt-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Security</p>
        <div className="rounded-lg border border-border/30 bg-card px-3 py-2.5 flex items-start gap-3">
          <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5 flex-1">
            <p className="text-sm text-foreground font-medium">Guardian Mode</p>
            <p className="text-xs text-muted-foreground leading-snug">
              Enables Zero Trust access controls and continuous security monitoring. Requires Guardian to be provisioned for your organisation.
            </p>
            <span className="mt-1.5 inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded w-fit"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              Setup Required
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Contact your APEX administrator to enable Guardian for this account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
