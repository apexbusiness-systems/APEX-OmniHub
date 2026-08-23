import "./ssg-websocket";
import { ViteReactSSG } from "vite-react-ssg";
import type { RouteObject } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { PrivacyPage } from "./pages/Privacy";
import { TermsPage } from "./pages/Terms";
import { RequestAccessPage } from "./pages/RequestAccess";
import FounderStory from "./pages/FounderStory";
import { TechSpecsPage } from "./pages/TechSpecs";
import { OmniSentryPage } from "./pages/OmniSentry";
import { OmniTracePage } from "./pages/OmniTrace";
import { EyesVisionPage } from "./pages/EyesVision";
import { ManModePage } from "./pages/ManMode";
import { SupportPage } from "./pages/Support";
import { OmniLinkSupportPage } from "./pages/OmniLinkSupport";
import { OmniLinkPrivacyPage } from "./pages/OmniLinkPrivacy";
import { AdvancedAnalyticsPage } from "./pages/AdvancedAnalytics";
import { AiAutomationPage } from "./pages/AiAutomation";
import { FortressPage } from "./pages/Fortress";
import { MaestroPage } from "./pages/Maestro";
import { OmniPortPage } from "./pages/OmniPort";
import { OrchestratorPage } from "./pages/Orchestrator";
import { OmniBoardPage } from "./pages/OmniBoard";
import { OmniSkillsPage } from "./pages/product/OmniSkills";
import { BYOMPage } from "./pages/product/BYOM";
import { TriForcePage } from "./pages/TriForce";
import Web3Integrations from "./pages/integrations/Web3Integrations";
import OmniDash from "./pages/product/OmniDash";
import { DemoPage } from "./pages/Demo";
import { PhysiOmniPilotPage } from "./pages/PhysiOmniPilot";
import { PricingPage } from "./pages/Pricing";
import { ManifestoPage } from "./pages/Manifesto";
import "./i18n";
import "./styles/globals.css";
import "./styles/theme.css";
import "./styles/components.css";
import "./styles/omnidash-layout.css";

// Pre-auth marketing routes only — post-auth /omnidash/* stays CSR
const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/omnilink-privacy", element: <OmniLinkPrivacyPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/request-access", element: <RequestAccessPage /> },
  { path: "/story", element: <FounderStory /> },
  { path: "/tech-specs", element: <TechSpecsPage /> },
  { path: "/omni-sentry", element: <OmniSentryPage /> },
  { path: "/omni-trace", element: <OmniTracePage /> },
  { path: "/eyes", element: <EyesVisionPage /> },
  { path: "/features/man-mode", element: <ManModePage /> },
  { path: "/man-mode", element: <ManModePage /> },
  { path: "/support", element: <SupportPage /> },
  { path: "/omnilink-support", element: <OmniLinkSupportPage /> },
  { path: "/advanced-analytics", element: <AdvancedAnalyticsPage /> },
  { path: "/ai-automation", element: <AiAutomationPage /> },
  { path: "/fortress", element: <FortressPage /> },
  { path: "/maestro", element: <MaestroPage /> },
  { path: "/omniport", element: <OmniPortPage /> },
  { path: "/orchestrator", element: <OrchestratorPage /> },
  { path: "/omniboard", element: <OmniBoardPage /> },
  { path: "/product/omniskills", element: <OmniSkillsPage /> },
  { path: "/product/byom", element: <BYOMPage /> },
  { path: "/tri-force", element: <TriForcePage /> },
  { path: "/integrations/web3", element: <Web3Integrations /> },
  { path: "/product/omnidash", element: <OmniDash /> },
  { path: "/demo", element: <DemoPage /> },
  { path: "/physiomni-pilot", element: <PhysiOmniPilotPage /> },
  { path: "/pricing", element: <PricingPage /> },
  { path: "/manifesto", element: <ManifestoPage /> },
  { path: "/apex-manifesto", element: <ManifestoPage /> },
];

export const createRoot = ViteReactSSG({ routes });
