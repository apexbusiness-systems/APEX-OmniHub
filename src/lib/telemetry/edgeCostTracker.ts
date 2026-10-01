/**
 * EdgeCostTracker — Micro-Compute Cost Telemetry
 *
 * Tracks edge compute execution cost per transaction to mathematically
 * prove the Zero Marginal Cost Distribution model.
 *
 * Embeds timing data into API responses via headers:
 * - X-APEX-Edge-Duration-Ms: Wall-clock execution time
 * - X-APEX-Edge-Cost-Micros: Estimated cost in micro-dollars
 *
 * APEX STANDARDS:
 * - Zero overhead: Uses performance.now() for sub-ms precision
 * - Configurable rate: Cost per ms of compute is environment-driven
 * - Aggregation: Running totals for dashboard display
 *
 * @module lib/telemetry/edgeCostTracker
 * @license Proprietary - APEX Business Systems Ltd.
 */

// ============================================================================
// Types
// ============================================================================

export interface EdgeCostConfig {
  /** Cost per millisecond of compute in micro-dollars (default: 0.0125 = $0.0000125/ms) */
  costPerMsMicros: number;
  /** Maximum entries to retain in the rolling window (default: 1000) */
  maxEntries: number;
}

export interface EdgeRequestMetrics {
  readonly requestId: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
  readonly costMicros: number;
  readonly endpoint: string;
}

export interface EdgeCostSummary {
  readonly totalRequests: number;
  readonly totalDurationMs: number;
  readonly totalCostMicros: number;
  readonly avgDurationMs: number;
  readonly avgCostMicros: number;
  readonly p95DurationMs: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: EdgeCostConfig = {
  costPerMsMicros: 0.0125, // $0.0000125 per ms (~$0.045/hr of continuous compute)
  maxEntries: 1000,
};

const TELEMETRY_HEADERS = {
  DURATION: 'X-APEX-Edge-Duration-Ms',
  COST: 'X-APEX-Edge-Cost-Micros',
  REQUEST_ID: 'X-APEX-Request-Id',
} as const;

// ============================================================================
// EdgeCostTracker Class
// ============================================================================

export class EdgeCostTracker {
  private readonly config: EdgeCostConfig;
  private entries: EdgeRequestMetrics[];
  private readonly activeRequests: Map<string, { startTime: number; endpoint: string }>;

  constructor(config?: Partial<EdgeCostConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entries = [];
    this.activeRequests = new Map();
  }

  /**
   * Marks the start of an edge request.
   * Returns a requestId for correlation.
   */
  startRequest(endpoint: string, requestId?: string): string {
    const id = requestId ?? generateRequestId();
    this.activeRequests.set(id, {
      startTime: performance.now(),
      endpoint,
    });
    return id;
  }

  /**
   * Marks the end of an edge request and calculates cost.
   * Returns the computed metrics.
   */
  endRequest(requestId: string): EdgeRequestMetrics | null {
    const active = this.activeRequests.get(requestId);
    if (!active) return null;

    this.activeRequests.delete(requestId);

    const endTime = performance.now();
    const durationMs = endTime - active.startTime;
    const costMicros = durationMs * this.config.costPerMsMicros;

    const metrics: EdgeRequestMetrics = {
      requestId,
      startTime: active.startTime,
      endTime,
      durationMs: Math.round(durationMs * 1000) / 1000, // 3 decimal places
      costMicros: Math.round(costMicros * 1000) / 1000,
      endpoint: active.endpoint,
    };

    this.entries.push(metrics);

    // Trim to max entries (rolling window)
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }

    return metrics;
  }

  /**
   * Returns telemetry headers to embed in an API response.
   */
  getResponseHeaders(requestId: string, metrics: EdgeRequestMetrics): Record<string, string> {
    return {
      [TELEMETRY_HEADERS.DURATION]: String(metrics.durationMs),
      [TELEMETRY_HEADERS.COST]: String(metrics.costMicros),
      [TELEMETRY_HEADERS.REQUEST_ID]: requestId,
    };
  }

  /**
   * Returns aggregate cost summary across all tracked requests.
   */
  getSummary(): EdgeCostSummary {
    if (this.entries.length === 0) {
      return {
        totalRequests: 0,
        totalDurationMs: 0,
        totalCostMicros: 0,
        avgDurationMs: 0,
        avgCostMicros: 0,
        p95DurationMs: 0,
      };
    }

    let totalDurationMs = 0;
    let totalCostMicros = 0;
    for (const entry of this.entries) {
      totalDurationMs += entry.durationMs;
      totalCostMicros += entry.costMicros;
    }
    const sorted = [...this.entries].sort((a, b) => a.durationMs - b.durationMs);
    const p95Index = Math.floor(sorted.length * 0.95);

    return {
      totalRequests: this.entries.length,
      totalDurationMs: Math.round(totalDurationMs * 1000) / 1000,
      totalCostMicros: Math.round(totalCostMicros * 1000) / 1000,
      avgDurationMs: Math.round((totalDurationMs / this.entries.length) * 1000) / 1000,
      avgCostMicros: Math.round((totalCostMicros / this.entries.length) * 1000) / 1000,
      p95DurationMs: sorted[p95Index]?.durationMs ?? 0,
    };
  }

  /**
   * Returns all tracked entries in the rolling window.
   */
  getEntries(): readonly EdgeRequestMetrics[] {
    return this.entries;
  }

  /**
   * Resets all tracked data.
   */
  reset(): void {
    this.entries = [];
    this.activeRequests.clear();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36)).join('').slice(0, 8);
  return `edge-${timestamp}-${random}`;
}

// ============================================================================
// Edge Function Integration Helper
// ============================================================================

/**
 * Wraps an edge function handler with automatic cost telemetry.
 * Adds X-APEX-Edge-Duration-Ms and X-APEX-Edge-Cost-Micros headers.
 */
export function withEdgeTelemetry(
  handler: (request: Request) => Promise<Response>,
  config?: Partial<EdgeCostConfig>,
): (request: Request) => Promise<Response> {
  const tracker = new EdgeCostTracker(config);

  return async (request: Request): Promise<Response> => {
    const endpoint = new URL(request.url).pathname;
    const requestId = tracker.startRequest(endpoint);

    const response = await handler(request);

    const metrics = tracker.endRequest(requestId);
    if (!metrics) return response;

    // Clone response and add telemetry headers
    const headers = new Headers(response.headers);
    const telemetryHeaders = tracker.getResponseHeaders(requestId, metrics);
    for (const [key, value] of Object.entries(telemetryHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
