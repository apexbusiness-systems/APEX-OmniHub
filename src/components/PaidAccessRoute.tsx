import { useEffect, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePaidAccess, SubscriptionTier } from '@/hooks/usePaidAccess';
import { Loader2, Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PaidAccessRouteProps {
  readonly children: React.ReactNode;
  /** Minimum tier required (defaults to 'starter' - any paid tier) */
  readonly requiredTier?: SubscriptionTier;
  /** Custom redirect path for unauthenticated users */
  readonly authRedirect?: string;
  /** Custom component to show when user lacks access */
  readonly fallback?: React.ReactNode;
}

const tierLevels: Record<SubscriptionTier, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
};

const tierNames: Record<SubscriptionTier, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/**
 * Route wrapper that requires paid subscription access
 *
 * Usage:
 * ```tsx
 * <PaidAccessRoute>
 *   <Dashboard />
 * </PaidAccessRoute>
 *
 * // Or with specific tier requirement:
 * <PaidAccessRoute requiredTier="pro">
 *   <AdvancedFeatures />
 * </PaidAccessRoute>
 * ```
 */
export const PaidAccessRoute = ({
  children,
  requiredTier = 'starter',
  authRedirect = '/auth',
  fallback,
}: PaidAccessRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { isPaid, tier, loading: subLoading } = usePaidAccess();
  const navigate = useNavigate();

  const loading = authLoading || subLoading;
  const hasRequiredTier = tierLevels[tier] >= tierLevels[requiredTier];
  const hasAccess = isPaid && hasRequiredTier;

  // Redirect unauthenticated users
  useEffect(() => {
    if (!authLoading && !user) {
      navigate(authRedirect); // NOSONAR
    }
  }, [user, authLoading, navigate, authRedirect]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return null;
  }

  // Has access - render children
  if (hasAccess) {
    return <>{children}</>;
  }

  // Custom fallback
  if (fallback) {
    return <>{fallback}</>;
  }

  // Default upgrade prompt
  return <UpgradePrompt currentTier={tier} requiredTier={requiredTier} />;
};

interface UpgradePromptProps {
  readonly currentTier: SubscriptionTier;
  readonly requiredTier: SubscriptionTier;
}

// ⚡ Bolt: Moved `features` object outside of the `UpgradePrompt` component to prevent unnecessary memory reallocation on every render.
// Expected Impact: Reduces garbage collection overhead, particularly if the component re-renders frequently.
const features = {
  starter: [
    'Full Dashboard Access',
    'Link & File Management',
    'Basic Automations',
    'Email Support',
  ],
  pro: [
    'Everything in Starter',
    'Advanced Automations',
    'Priority Support',
    'API Access',
    'Custom Integrations',
  ],
  enterprise: [
    'Everything in Pro',
    'Dedicated Account Manager',
    'SLA Guarantee',
    'Custom Development',
    'On-premise Options',
  ],
};

// ⚡ Bolt: Wrapped `UpgradePrompt` in `React.memo` to prevent unnecessary re-renders.
// Since `currentTier` and `requiredTier` are primitives (strings), React can efficiently compare them.
// Expected Impact: Prevents re-rendering the feature list when parent components (like `PaidAccessRoute`) update state unnecessarily.
const UpgradePrompt = memo(function UpgradePrompt({ currentTier, requiredTier }: UpgradePromptProps) {
  const navigate = useNavigate();

  const tierFeatures = features[requiredTier as keyof typeof features] || features.starter;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background to-muted/20">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Upgrade Required</CardTitle>
          <CardDescription>
            This feature requires a {tierNames[requiredTier]} subscription or higher.
            {currentTier !== 'free' && (
              <span className="block mt-1">
                Your current plan: <strong>{tierNames[currentTier]}</strong>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-yellow-500" />
              {tierNames[requiredTier]} Features
            </h4>
            <ul className="space-y-2">
              {tierFeatures.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <Button className="w-full" size="lg" onClick={() => navigate('/pricing')}>
              Upgrade to {tierNames[requiredTier]}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => navigate('/')}
            >
              Back to Home
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Questions? Contact info-outreach@apexomnihub.icu
          </p>
        </CardContent>
      </Card>
    </div>
  );
});

export default PaidAccessRoute;
