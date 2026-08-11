/**
 * Web3 Guardrails and Middleware
 *
 * Purpose: Security guardrails for Web3 module
 *
 * Features:
 *   - Static asset allowlist (manifest, service worker)
 *   - Endpoint protection (require auth + verified wallet)
 *   - Rate limiting helpers
 *   - Request validation
 *
 * Author: OmniLink APEX
 * Date: 2026-01-01
 */

import { supabase } from '@/integrations/supabase/client';
import { logSecurityEvent } from '@/lib/monitoring';

/**
 * Public endpoints that should NEVER require wallet verification
 * These are typically static assets and service workers
 */
export const PUBLIC_PATHS = [
  '/manifest.json',
  '/manifest.webmanifest',
  '/sw.js',
  '/service-worker.js',
  '/workbox-',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/_next/static',
  '/static/',
  '/assets/',
  '/images/',
  '/fonts/',
  '.css',
  '.js',
  '.map',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
] as const;

/**
 * Endpoints that require wallet verification
 */
export const PROTECTED_ENDPOINTS = [
  '/api/premium',
  '/api/gated-content',
  '/api/nft-holders',
] as const;

// ⚡ Bolt: Pre-compile regex for O(1) matching instead of O(N) array iteration with .some()
const PUBLIC_PATHS_REGEX = new RegExp(
  PUBLIC_PATHS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

const PROTECTED_ENDPOINTS_REGEX = new RegExp(
  `^(${PROTECTED_ENDPOINTS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'i'
);

/**
 * Check if path is a public asset
 */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS_REGEX.test(path);
}

/**
 * Check if endpoint requires wallet verification
 */
export function requiresWalletVerification(path: string): boolean {
  return PROTECTED_ENDPOINTS_REGEX.test(path);
}

/**
 * Verify user has authenticated session
 */
export async function verifySession(): Promise<{
  authenticated: boolean;
  userId?: string;
  error?: string;
}> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      return { authenticated: false, error: 'No active session' };
    }

    return { authenticated: true, userId: session.user.id };
  } catch (error) {
    return { authenticated: false, error: (error as Error).message };
  }
}

/**
 * Verify user has a verified wallet
 */
export async function verifyWalletIdentity(
  userId: string
): Promise<{ verified: boolean; walletAddress?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('wallet_identities')
      .select('wallet_address')
      .eq('user_id', userId)
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { verified: false, error: error.message };
    }

    if (!data) {
      return { verified: false, error: 'No verified wallet found' };
    }

    return { verified: true, walletAddress: data.wallet_address };
  } catch (error) {
    return { verified: false, error: (error as Error).message };
  }
}

/**
 * Combined authentication and wallet verification check
 */
export async function verifyAccess(): Promise<{
  allowed: boolean;
  userId?: string;
  walletAddress?: string;
  error?: string;
}> {
  // Check session
  const sessionCheck = await verifySession();
  if (!sessionCheck.authenticated) {
    return { allowed: false, error: sessionCheck.error };
  }

  // Check wallet verification
  const walletCheck = await verifyWalletIdentity(sessionCheck.userId!);
  if (!walletCheck.verified) {
    await logSecurityEvent('suspicious_activity', {
      userId: sessionCheck.userId,
      reason: walletCheck.error,
    });
    return { allowed: false, error: walletCheck.error };
  }

  return {
    allowed: true,
    userId: sessionCheck.userId,
    walletAddress: walletCheck.walletAddress,
  };
}

/**
 * Middleware wrapper for protected routes/actions
 */
export async function withWalletGuard<T>(
  action: (userId: string, walletAddress: string) => Promise<T>
): Promise<T> {
  const access = await verifyAccess();

  if (!access.allowed) {
    throw new Error(`Access denied: ${access.error}`);
  }

  return action(access.userId!, access.walletAddress!);
}

/**
 * Client-side rate limiting for wallet operations
 */
const rateLimitCache = new Map<string, { count: number; resetAt: number }>();

export function checkClientRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitCache.get(key);

  if (!record || now >= record.resetAt) {
    rateLimitCache.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetIn: windowMs };
  }

  if (record.count >= maxAttempts) {
    return { allowed: false, remaining: 0, resetIn: record.resetAt - now };
  }

  record.count++;
  rateLimitCache.set(key, record);

  return { allowed: true, remaining: maxAttempts - record.count, resetIn: record.resetAt - now };
}

/**
 * Validate Ethereum address format
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Sanitize wallet address (lowercase, trim)
 */
export function sanitizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
}
