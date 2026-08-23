import { LegalPage } from '@/components/legal/LegalPage';
import { SEOMeta } from '@/components/SEOMeta';

export function OmniLinkPrivacyPage() {
  return (
    <>
      <SEOMeta title="OmniLink Privacy Policy" description="APEX OmniLink mobile application privacy policy and data handling practices." noIndex={true} />
      <LegalPage
        title="OmniLink Privacy Policy"
        documentPath="memory/omni-recall/docs/compliance/PRIVACY_POLICY.md"
        markdownLoader={() => import('@/content/legal/privacyPolicyContent')}
      />
    </>
  );
}
