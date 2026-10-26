/**
 * OmniTracePanel — forensic decision-replay surface over the REAL
 * `audit_logs` table.
 *
 * This is NOT a mock and NOT a second audit store. It queries the user's own
 * audit events directly from Supabase using the SITE supabase client
 * (`../lib/supabase`), which carries the authenticated session so the
 * `audit_logs` RLS policy (`actor_id = auth.uid()`) scopes rows to the current
 * user. Rows are ordered chronologically and grouped into decision chains by
 * the pure logic in `../lib/omniTrace`.
 *
 * Honesty note: a correlation id is only used when one is actually present in
 * `audit_logs.metadata`. When none exists, events are grouped into a
 * chronological timeline (per actor + day) and labelled as such — we never
 * claim a linked agent chain that the data does not contain.
 */
import { useCallback, useEffect, useState, memo } from 'react';
import { supabase, hasSupabaseConfig } from '../lib/supabase';
import { useAuth } from '../lib/useAuth';
import {
  buildDecisionChains,
  hasLinkedChains,
  type AuditLogRow,
  type DecisionChain,
} from '../lib/omniTrace';

const MAX_ROWS = 200;

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; chains: DecisionChain[] };

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function describeEvent(event: AuditLogRow): string {
  const resource =
    event.resource_type && event.resource_id
      ? `${event.resource_type}:${event.resource_id}`
      : event.resource_type ?? '';
  return resource ? `${event.action_type} — ${resource}` : event.action_type;
}

export function OmniTracePanel() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  const load = useCallback(async () => {
    if (!hasSupabaseConfig) {
      setState({
        kind: 'error',
        message: 'Supabase is not configured in this environment, so audit history cannot be loaded.',
      });
      return;
    }
    setState({ kind: 'loading' });
    // RLS policy "Users can view own audit logs" restricts this to the
    // authenticated user's rows (actor_id = auth.uid()). We never pass an
    // actor filter ourselves — the database enforces it.
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, actor_id, action_type, resource_type, resource_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      setState({ kind: 'error', message: error.message });
      return;
    }

    const rows = (data ?? []) as AuditLogRow[];
    setState({ kind: 'ready', chains: buildDecisionChains(rows) });
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;
    const id = globalThis.setTimeout(() => void load(), 0);
    return () => globalThis.clearTimeout(id);
  }, [authLoading, isAuthenticated, load]);

  if (authLoading) {
    return (
      <div className="card" style={{ maxWidth: '820px', margin: '0 auto' }}>
        <p className="text-secondary">Checking your session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="card" style={{ maxWidth: '820px', margin: '0 auto' }}>
        <h3 className="heading-3">Sign in to replay your decisions</h3>
        <p className="text-secondary mt-4">
          OmniTrace reads only your own audit history. Authenticate to load your
          decision timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: '820px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 className="heading-3">Forensic Decision Replay</h3>
          <p className="text-secondary mt-4">
            Your real audit events, ordered chronologically and grouped into
            decision chains. RLS keeps this scoped to your account.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void load()}
          disabled={state.kind === 'loading'}
        >
          {state.kind === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        {state.kind === 'loading' && (
          <p className="text-secondary">Loading your audit history…</p>
        )}

        {state.kind === 'error' && (
          <p className="text-secondary">Could not load audit history: {state.message}</p>
        )}

        {state.kind === 'ready' && state.chains.length === 0 && (
          <p className="text-secondary">
            No audit events recorded for your account yet. Actions you take across
            APEX OmniHub will appear here as a replayable decision timeline.
          </p>
        )}

        {state.kind === 'ready' && state.chains.length > 0 && (
          <>
            <p className="text-secondary" style={{ fontSize: '0.8rem' }}>
              {hasLinkedChains(state.chains)
                ? 'Chains linked by correlation id where present; remaining events shown as a chronological timeline.'
                : 'No correlation id found in metadata — events are shown as a chronological decision timeline grouped by day.'}
            </p>
            {state.chains.map((chain) => (
              <section key={chain.key} style={{ marginTop: 'var(--space-6)' }}>
                <h4 className="heading-3" style={{ fontSize: '1rem' }}>
                  {chain.label}
                  <span
                    className="text-secondary"
                    style={{ fontSize: '0.7rem', marginLeft: 'var(--space-2)', textTransform: 'uppercase' }}
                  >
                    {chain.grouping === 'correlation' ? 'linked chain' : 'timeline'}
                  </span>
                </h4>
                <ul className="fortress-list" style={{ marginTop: 'var(--space-2)' }}>
                  {chain.events.map((event) => (
                    <TraceEventRow key={event.id} event={event} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ⚡ Bolt: Extracted row into a memoized component.
// This prevents React from re-rendering every item in the trace when parent states change.
const TraceEventRow = memo(function TraceEventRow({ event }: { event: AuditLogRow }) {
  return (
    <li className="fortress-list__item">
      <span className="text-secondary" style={{ fontSize: '0.72rem' }}>
        {formatTime(event.created_at)}
      </span>
      <span style={{ marginLeft: 'var(--space-2)' }}>{describeEvent(event)}</span>
    </li>
  );
});
