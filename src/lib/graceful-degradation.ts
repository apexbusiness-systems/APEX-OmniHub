/**
 * Graceful degradation utilities for production resilience
 */

import { logError, logAnalyticsEvent } from './monitoring';

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logError(lastError!, { action: 'retry_exhausted', metadata: { maxRetries } });
  throw lastError!;
}

/**
 * Execute with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string = 'Operation timed out'
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(timeoutError)), timeoutMs)
  );
  
  return Promise.race([promise, timeout]);
}

/**
 * Result type for safe operations
 */
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

/**
 * Safe JSON parse with Result type
 */
export function tryParse<T>(
  json: string
): ParseResult<T> {
  try {
    return { success: true, data: JSON.parse(json) };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    // Log with limited metadata to avoid PII exposure
    logError(err, {
      action: 'json_parse_failed',
      metadata: {
        inputLength: json.length,
        preview: json.slice(0, 20) // Reduced to 20 for privacy
      }
    });
    return { success: false, error: err };
  }
}

/**
 * Safe JSON parse with fallback (deprecated - use tryParse for better error handling)
 */
export function safeParse<T>(
  json: string,
  fallback: T
): T {
  const result = tryParse<T>(json);
  return result.success ? result.data : fallback;
}

/**
 * Execute function with fallback
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => T | Promise<T>
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    logError(error as Error, { action: 'using_fallback' });
    return await fallback();
  }
}

/**
 * Circuit breaker pattern
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      logError(
        new Error('Circuit breaker opened'),
        { metadata: { failures: this.failures } }
      );
    }
  }
  
  getState(): string {
    return this.state;
  }
  
  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }
}

/**
 * Resource loader with fallback
 */
export async function loadResourceWithFallback(
  primaryUrl: string,
  fallbackUrl?: string
): Promise<Response> {
  try {
    const response = await fetch(primaryUrl);
    if (!response.ok) throw new Error('Primary resource load failed');
    return response;
  } catch (error) {
    if (fallbackUrl) {
      logError(error as Error, { action: 'loading_fallback_resource' });
      return fetch(fallbackUrl);
    }
    throw error;
  }
}

/**
 * Degraded mode checker
 */
export class ServiceHealthChecker {
  private readonly services = new Map<string, boolean>();
  
  markServiceDown(service: string): void {
    this.services.set(service, false);
    void logAnalyticsEvent('service.degraded', { service });
  }
  
  markServiceUp(service: string): void {
    this.services.set(service, true);
    void logAnalyticsEvent('service.restored', { service });
  }
  
  isServiceHealthy(service: string): boolean {
    return this.services.get(service) ?? true;
  }
  
  getAllServices(): Map<string, boolean> {
    return new Map(this.services);
  }
  
  isAnyServiceDown(): boolean {
    // ⚡ Bolt: Use an iterator instead of Array.from() to avoid O(N) array allocation overhead
    for (const healthy of this.services.values()) {
      if (!healthy) return true;
    }
    return false;
  }
}

export const serviceHealth = new ServiceHealthChecker();
