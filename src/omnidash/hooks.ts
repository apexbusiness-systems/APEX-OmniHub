import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchSettings,
  updateSettings,
  fetchUsageMetering,
  aggregateUsageMetering,
  fetchMemoryHealthStats,
} from './api';
import type {
  UsageMeteringSummary,
  UsageMeteringRow,
  MemoryHealthStats,
} from './api';
import { OMNIDASH_FLAG, OmniDashSettings } from './types';

export function useAdminAccess() {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['omnidash-role', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;

      // DB-only: Check user_roles table (single source of truth, matches RLS is_admin())
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (roleError) throw roleError;
      return roleData?.role === 'admin';
    },
    staleTime: 5 * 60 * 1000, // 5 minute cache (balance freshness vs performance)
    retry: 1, // Retry once on failure (network flakiness)
  });

  return {
    isAdmin: !!data,
    loading: isLoading,
    error,
    featureEnabled: OMNIDASH_FLAG,
  };
}

export function useOmniDashSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<OmniDashSettings>({
    queryKey: ['omnidash-settings', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) throw new Error('User not found');
      return fetchSettings(user.id);
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<OmniDashSettings>) => {
      if (!user) throw new Error('User not found');
      return updateSettings(user.id, patch);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['omnidash-settings', user?.id], data);
    },
  });

  return { ...query, updateSettings: mutation.mutateAsync, updating: mutation.isPending };
}

export function useUsageMetering(days = 7) {
  const { user } = useAuth();

  const query = useQuery<UsageMeteringRow[]>({
    queryKey: ['omnidash-usage-metering', user?.id, days],
    enabled: !!user,
    queryFn: async () => {
      if (!user) throw new Error('User not found');
      return fetchUsageMetering(user.id, days);
    },
    refetchInterval: 30_000, // Real-time: poll every 30s
    staleTime: 15_000,
  });

  // ⚡ Bolt: Memoized the aggregation and token reduction to prevent O(n) re-calculations on every hook render
  const { summary, totalTokens } = useMemo(() => {
    const sum: UsageMeteringSummary[] = query.data
      ? aggregateUsageMetering(query.data)
      : [];

    const tokens = sum.reduce(
      (acc, s) => acc + s.total_input_tokens + s.total_output_tokens,
      0,
    );

    return { summary: sum, totalTokens: tokens };
  }, [query.data]);

  return { ...query, summary, totalTokens };
}

export function useMemoryHealth() {
  const { user } = useAuth();

  const query = useQuery<MemoryHealthStats>({
    queryKey: ['omnidash-memory-health', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) throw new Error('User not found');
      return fetchMemoryHealthStats(user.id);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return query;
}

// ============================================================================
// Real-time Supabase Channel Bindings (Phase 1 — USO Gateway)
// ============================================================================

/**
 * Tables that OmniDash subscribes to for real-time Postgres changes.
 * Maps to the OMNIDASH_COLUMNS definitions in api.ts.
 */
const OMNIDASH_REALTIME_TABLES = [
  'omnidash_settings',
  'omnidash_today_items',
  'omnidash_pipeline_items',
  'omnidash_kpi_daily',
  'omnidash_incidents',
] as const;

type OmniDashTable = typeof OMNIDASH_REALTIME_TABLES[number];

/**
 * useRealtimeOmniDash — Binds OmniDash UI to supabase.channel() for
 * real-time Postgres changes. Automatically invalidates TanStack Query
 * caches when the database changes, ensuring the UI stays synchronized
 * without polling.
 *
 * APEX STANDARDS:
 * - Uses Supabase Realtime channels (not polling)
 * - Invalidates specific query keys (not full cache flush)
 * - Cleans up subscriptions on unmount
 * - Idempotent: multiple mounts don't create duplicate channels
 */
export function useRealtimeOmniDash() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const channelName = `omnidash-realtime-${user.id}`;
    const channel = supabase.channel(channelName);

    // Map table changes to TanStack Query invalidations
    const tableQueryKeyMap: Record<OmniDashTable, string[]> = {
      omnidash_settings: ['omnidash-settings', user.id],
      omnidash_today_items: ['omnidash-today-items', user.id],
      omnidash_pipeline_items: ['omnidash-pipeline-items', user.id],
      omnidash_kpi_daily: ['omnidash-kpi-daily', user.id],
      omnidash_incidents: ['omnidash-incidents', user.id],
    };

    // Subscribe to all OmniDash tables
    for (const table of OMNIDASH_REALTIME_TABLES) {
      channel.on(
        'postgres_changes' as 'system',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `user_id=eq.${user.id}`,
        } as Record<string, string>,
        () => {
          // Invalidate the specific query cache for this table
          const queryKey = tableQueryKeyMap[table];
          if (queryKey) {
            queryClient.invalidateQueries({ queryKey });
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
