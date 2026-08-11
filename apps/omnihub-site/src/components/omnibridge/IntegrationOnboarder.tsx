/**
 * IntegrationOnboarder — 3-step wizard for onboarding arbitrary apps into OmniLink.
 *
 * Step A: App name + URL (free text, 2 fields)
 * Step B: 3 forced-choice questions (deterministic classification, no AI)
 *   Q1: Auth method → API Key | OAuth | Username+Password | None
 *   Q2: Data direction → I call it | It calls me | Both
 *   Q3: Intent → Monitor | Trigger actions | Receive events | All
 * Output: Constructs IntegrationDef → createOmniLinkIntegration → onComplete(def)
 *
 * Props: { onComplete: (def: IntegrationDef) => void }
 * userId: resolved internally via supabase.auth.getSession()
 * All UI from @/components/ui/* only.
 */
import { type ElementType, useState, useCallback, memo } from 'react';
import { type IntegrationDef } from '@/omniconnect/core/registry';
import { createOmniLinkIntegration } from '@/omnidash/omnilink-api';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Globe } from 'lucide-react';

// ---------------------------------------------------------------------------
// Deterministic classification maps (no AI needed)
// ---------------------------------------------------------------------------
type AuthChoice = 'API Key' | 'OAuth' | 'Username+Password' | 'None';
type DirectionChoice = 'I call it' | 'It calls me' | 'Both';
type IntentChoice = 'Monitor' | 'Trigger actions' | 'Receive events' | 'All';

const AUTH_MAP: Record<AuthChoice, Partial<IntegrationDef>> = {
  'API Key': { requiresApiKey: true },
  'OAuth': { requiresApiKey: true },
  'Username+Password': { requiresApiKey: false, requiresUsername: true },
  'None': { requiresApiKey: false },
};

const DIRECTION_MAP: Record<DirectionChoice, Partial<IntegrationDef>> = {
  'I call it': { category: 'automation' as IntegrationDef['category'] },
  'It calls me': { category: 'platform' as IntegrationDef['category'] },
  'Both': { category: 'platform' as IntegrationDef['category'] },
};

const INTENT_MAP: Record<IntentChoice, Partial<IntegrationDef>> = {
  'Monitor': { scopes: ['read'] },
  'Trigger actions': { scopes: ['read', 'write'] },
  'Receive events': { scopes: ['events'] },
  'All': { scopes: ['read', 'write', 'events'] },
};

// ---------------------------------------------------------------------------
// Probe helper — fires background HEAD requests, returns pre-filled Q1 answer
// Degrades gracefully: wizard works fully if probe fails or returns null.
// ---------------------------------------------------------------------------
async function probeUrl(url: string): Promise<{ q1: AuthChoice | null }> {
  try {
    const res = await fetch('/api/omniboard/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { q1: null };
    const data = await res.json() as { q1: string | null; confidence: 'high' | 'low' };
    if (data.confidence === 'high' && data.q1) return { q1: data.q1 as AuthChoice };
  } catch {
    // probe failed — silent fallback
  }
  return { q1: null };
}

// ---------------------------------------------------------------------------
// Shared choice selector — extracted outside the parent component so it is
// not re-created on every render (resolves SonarQube S6478).
// ---------------------------------------------------------------------------
interface ChoiceProps<T extends string> {
  readonly label: string;
  readonly options: readonly T[];
  readonly selected: T | null;
  readonly onSelect: (v: T) => void;
}

function Choice<T extends string>({ label, options, selected, onSelect }: ChoiceProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={[
              'px-3 py-1.5 rounded-lg border text-sm transition-all',
              selected === opt
                ? 'border-primary bg-primary text-primary-foreground font-semibold'
                : 'border-border bg-background hover:border-primary hover:bg-accent',
            ].join(' ')}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
type IntegrationOnboarderProps = Readonly<{
  onComplete: (def: IntegrationDef) => void;
}>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
// ⚡ Bolt: Wrapped IntegrationOnboarder in React.memo() to prevent unnecessary re-renders when parent states change.
export const IntegrationOnboarder = memo(function IntegrationOnboarder({ onComplete }: IntegrationOnboarderProps) {
  const [step, setStep] = useState<'A' | 'B'>('A');
  const [appName, setAppName] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [probing, setProbing] = useState(false);

  const [q1, setQ1] = useState<AuthChoice | null>(null);
  const [q2, setQ2] = useState<DirectionChoice | null>(null);
  const [q3, setQ3] = useState<IntentChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUrlBlur = useCallback(async () => {
    if (!appUrl) return;
    setProbing(true);
    const result = await probeUrl(appUrl);
    if (result.q1) setQ1(result.q1);
    setProbing(false);
  }, [appUrl]);

  const canAdvance = appName.trim().length > 0;
  const canSubmit = q1 !== null && q2 !== null && q3 !== null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? 'anonymous';
      const type = appName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      await createOmniLinkIntegration(userId, appName.trim(), type);
      const def: IntegrationDef = {
        id: `custom_${type}_${Date.now()}`,
        name: appName.trim(),
        type,
        description: appUrl || `Custom integration: ${appName.trim()}`,
        icon: Globe as unknown as ElementType,
        version: '1.0',
        status: 'ga',
        docsUrl: appUrl || undefined,
        ...AUTH_MAP[q1!],
        ...DIRECTION_MAP[q2!],
        ...INTENT_MAP[q3!],
      };
      onComplete(def);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, appName, appUrl, q1, q2, q3, onComplete]);

  if (step === 'A') {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div>
          <Label htmlFor="app-name">App name <span aria-hidden="true">*</span></Label>
          <Input
            id="app-name"
            placeholder="e.g. Stripe, HubSpot, MyAPI"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="app-url">
            App URL <span className="text-muted-foreground">(optional — used for auto-detection)</span>
          </Label>
          <Input
            id="app-url"
            placeholder="https://api.example.com"
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            onBlur={handleUrlBlur}
            type="url"
          />
          {probing && (
            <p className="text-xs text-muted-foreground mt-1">Probing URL for auth signals…</p>
          )}
        </div>
        <Button onClick={() => setStep('B')} disabled={!canAdvance} className="w-full mt-2">
          Next →
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <p className="text-sm">
        Connecting <strong>{appName}</strong>. Answer 3 quick questions to classify it.
      </p>
      <Choice
        label="1. How does this app authenticate?"
        options={['API Key', 'OAuth', 'Username+Password', 'None'] as const}
        selected={q1}
        onSelect={setQ1}
      />
      <Choice
        label="2. Who initiates data flow?"
        options={['I call it', 'It calls me', 'Both'] as const}
        selected={q2}
        onSelect={setQ2}
      />
      <Choice
        label="3. What is the primary intent?"
        options={['Monitor', 'Trigger actions', 'Receive events', 'All'] as const}
        selected={q3}
        onSelect={setQ3}
      />
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => setStep('A')} disabled={submitting} className="flex-1" variant="outline">
          ← Back
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="flex-1">
          {submitting ? 'Connecting…' : 'Connect App'}
        </Button>
      </div>
    </div>
  );
});
