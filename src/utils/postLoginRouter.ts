/**
 * Post-Login Routing Utility
 *
 * Deterministic routing logic after successful authentication.
 * Routes users to appropriate destination based on:
 * 1. Intended destination (deep-link preservation)
 * 2. Admin status → /omnidash
 * 3. Paid user → /dashboard
 * 4. Free user → /omnidash (demo)
 *
 * ENTERPRISE-GRADE PRINCIPLES:
 * - Predictable: Same input always produces same output
 * - Atomic: Single decision point, no scattered logic
 * - Secure: Validates destination accessibility before routing
 * - Performant: No unnecessary checks, direct routing
 */

export interface PostLoginDestinationOptions {
  isAdmin: boolean;
  isPaid: boolean;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  intendedDestination?: string | null;
}

/**
 * Protected routes that require specific access levels
 */
const ROUTE_ACCESS: Record<string, (opts: PostLoginDestinationOptions) => boolean> = {
  '/dashboard': ({ isPaid }) => isPaid,
  '/links': ({ isPaid }) => isPaid,
  '/files': ({ isPaid }) => isPaid,
  '/automations': ({ isPaid }) => isPaid,
  '/integrations': ({ isPaid }) => isPaid,
};

// ⚡ Bolt: Pre-calculate the route entries to avoid Object.entries() overhead on every call.
const PRE_CALCULATED_ROUTE_ENTRIES = Object.entries(ROUTE_ACCESS);

/**
 * Validate if user can access a specific route
 */
function canAccessRoute(route: string, options: PostLoginDestinationOptions): boolean {
  if (route === '/omnidash') {
    return true;
  }

  if (route.startsWith('/omnidash/')) {
    return options.isAdmin || options.isPaid;
  }

  // Find matching route pattern (exact or prefix match)
  for (let i = 0; i < PRE_CALCULATED_ROUTE_ENTRIES.length; i++) {
    const [pattern, checkAccess] = PRE_CALCULATED_ROUTE_ENTRIES[i];
    if (route === pattern || route.startsWith(pattern + '/')) {
      return checkAccess(options);
    }
  }

  // Public routes (no gate)
  return true;
}

/**
 * Get upgrade reason for blocked route
 */
function getUpgradeReason(route: string): string {
  if (route.startsWith('/omnidash')) return 'omnidash';
  if (route.startsWith('/dashboard') ||
      route.startsWith('/links') ||
      route.startsWith('/files') ||
      route.startsWith('/automations') ||
      route.startsWith('/integrations')) {
    return 'premium';
  }
  return 'access';
}

/**
 * Determine post-login destination based on user access and intent
 *
 * @param options - User access levels and intended destination
 * @returns Destination route (absolute path)
 *
 * @example
 * ```ts
 * // Admin user, no specific intent
 * getPostLoginDestination({ isAdmin: true, isPaid: false, tier: 'free' })
 * // Returns: '/omnidash'
 *
 * // Paid user trying to access OmniDash
 * getPostLoginDestination({
 *   isAdmin: false,
 *   isPaid: true,
 *   tier: 'pro',
 *   intendedDestination: '/omnidash/pipeline'
 * })
 * // Returns: '/omnidash/pipeline' (paid users have access)
 *
 * // Free user trying to access premium feature
 * getPostLoginDestination({
 *   isAdmin: false,
 *   isPaid: false,
 *   tier: 'free',
 *   intendedDestination: '/dashboard'
 * })
 * // Returns: '/pricing?reason=premium' (blocked sub-feature, upgrade required)
 * ```
 */
export function getPostLoginDestination(options: PostLoginDestinationOptions): string {
  const { isAdmin, isPaid, intendedDestination } = options;

  // PRIORITY 1: Honor intended destination if accessible
  if (intendedDestination) {
    // Clean and validate destination (strip query params and fragments)
    const cleanDest = intendedDestination.split('?')[0].split('#')[0];

    if (canAccessRoute(cleanDest, options)) {
      // User can access intended destination - preserve full URL with query params
      return intendedDestination;
    }

    // User cannot access intended destination - redirect to upgrade with reason
    const reason = getUpgradeReason(cleanDest);
    return `/pricing?reason=${reason}&return=${encodeURIComponent(intendedDestination)}`;
  }

  // PRIORITY 2: Default routing based on access level
  if (isAdmin) {
    // Admins always go to OmniDash (command center)
    return '/omnidash';
  }

  if (isPaid) {
    // Paid users go to standard dashboard
    return '/dashboard';
  }

  // PRIORITY 3: Free users get OmniDash demo experience
  return '/omnidash';
}

/**
 * Check if a route requires paid access
 */
export function requiresPaidAccess(route: string): boolean {
  return canAccessRoute(route, {
    isAdmin: false,
    isPaid: false,
    tier: 'free',
  }) === false;
}

/**
 * Check if a route requires admin access
 */
export function requiresAdminAccess(route: string): boolean {
  // Check if route is accessible to paid non-admin
  const accessibleToPaid = canAccessRoute(route, {
    isAdmin: false,
    isPaid: true,
    tier: 'pro',
  });

  // If paid users can't access but admins can, it's admin-only
  const accessibleToAdmin = canAccessRoute(route, {
    isAdmin: true,
    isPaid: false,
    tier: 'free',
  });

  return !accessibleToPaid && accessibleToAdmin;
}
