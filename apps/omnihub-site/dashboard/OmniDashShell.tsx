import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDemoMode } from "../src/contexts/DemoModeContext";
import { T } from "./designSystem";
import { StatusDot, GlassCard, SectionLabel } from "./components/designComponents";
import { OmniTraceFeed } from "./components/OmniTraceFeed";
import { SentinelPanel } from "./components/SentinelPanel";
import { OmniSentryWidget } from "./components/OmniSentryWidget";
import { DraggableWidget } from './DraggableWidget';
import { useLayoutPersistence } from "./hooks/useLayoutPersistence";
import { useDashboardData } from "./hooks/useDashboardData";
import { useViewport } from "./hooks/useViewport";
import { SystemHealthRow } from './components/SystemHealthRow';
import { OmniSearchPalette } from './components/OmniSearchPalette';
import { FooterObservabilityRow } from './components/FooterObservabilityRow';
import { useOmniModal, type OmniModalConfig } from '@/stores/omniModalStore';
import { useNotificationStore } from '../src/stores/notificationStore';
import { invokeMcpIntent } from '@/omnihub-gateway/mcp-client';
import { classifyMcpError } from './lib/classifyMcpError';
import { OmniSpatialHost } from '@/dashboard/components/OmniSpatialHost';
import { GlobalMediaDock } from '@/dashboard/components/media/GlobalMediaDock';
import { OmniMediaLaunchWidget } from '@/dashboard/components/media/OmniMediaLaunchWidget';
import { OmniMobileBottomNav, type MobileTab } from '@/dashboard/components/OmniMobileBottomNav';
import { OmniMobileDrawer } from '@/dashboard/components/OmniMobileDrawer';
import { supabase } from '@/lib/supabase';
import { ConnectAiAuthModal } from '../src/components/byom/ConnectAiAuthModal';
import { useAuth } from '@/lib/useAuth';
import { LayoutContext } from './contexts/LayoutContext';
import {
  OMNIDASH_SIDEBAR_WIDGETS,
  type OmniDashSidebarWidget,
} from '@/contracts/omnidash-sidebar-widgets';
import { toast } from 'sonner';
import { LanguageSelector } from '../src/components/LanguageSelector';
import { SidebarKpiBar } from './components/SidebarKpiBar';
import { useAppTranslation } from '../src/i18n/useAppTranslation';

import imgWordmark from "../../../src/assets/omnidash/omnidash-logo.png";
import imgIcons from "../../../src/assets/omnidash/icons.png";
import imgApexWm from "../../../src/assets/omnidash/apex_omnihub_wordmark.png";
import { AVATAR_PATH_MAP, AGENT_AVATARS, avatarPath, agentNameFromAvatarFile } from './contracts/agentAvatars';
import { APEX_APPS_MODULE_KEY } from './contracts/omniSurfaceOwnership';

// ─── TypeScript Interfaces ───────────────────────────────────────────────────
import type { CSSProperties, Dispatch, SetStateAction } from "react";

// ─── Layout constants ───
/**
 * Flanking-rail width (left nav + right panel) is owned by the `--omni-rail-width`
 * CSS custom property (theme.css default 300px), applied via the `.omni-sidebar`
 * / `.omni-right-panel` classes in omniSkin.css. A single token keeps the two
 * sides in sync AND lets the 1025–1365px narrow-desktop media query shrink them
 * so the center canvas never crams — something an inline literal cannot do.
 */

interface AppIconProps {
  idx: number;
  size?: number;
  style?: CSSProperties;
}

interface IconBadgeProps {
  idx: number;
  size?: number;
  style?: CSSProperties;
}




type NavEntry = OmniDashSidebarWidget;

interface NavItemProps {
  n: NavEntry;
  isActive: boolean;
  onClick: () => void;
}


import type { DashboardNavSection } from "./types/dashboard.types";

interface OmniDashSidebarProps {
  activeNav: DashboardNavSection;
  setActiveNav: Dispatch<SetStateAction<DashboardNavSection>>;
  kpi: import('./types/dashboard.types').KpiSummary;
  systemHealth?: import('./types/dashboard.types').SystemHealthState;
  demoMode: boolean;
}

/**
 * Shared surface controller — the single place that opens a sidebar module
 * modal and marks it as the current surface. Used by the desktop sidebar AND
 * the mobile/tablet "Apps" drawer so both stay in sync (P0 rule 1).
 */
function invokeSidebarModule(
  widget: OmniDashSidebarWidget,
  setActiveNav: Dispatch<SetStateAction<DashboardNavSection>>,
) {
  setActiveNav(widget.label);
  useOmniModal.getState().invoke({
    id: `sidebar-module-${widget.moduleKey}`,
    provider: 'omnidash',
    type: 'module',
    title: widget.label,
    contextData: { moduleKey: widget.moduleKey },
    onComplete: async () => {},
    onCancel: () => { setActiveNav('Home'); },
  });
}

interface OmniDashHeaderProps {
  isDark: boolean;
  setIsDark: Dispatch<SetStateAction<boolean>>;
  invoke: (config: OmniModalConfig) => void;
  userInitials: string;
  isDesktop: boolean;
}

export type OmniHealthState = 'green' | 'yellow' | 'red';

export interface OmniContextApp {
  id: string;
  label: string;
  health: OmniHealthState;
  iconIdx?: number;
}

type AgentWidgetProps = Record<string, never>;



// ─── APEX Brand Assets ────────────────────────────────────────────────────────
const IMG_BADGE = "/assets/apex-core-badge.svg";
const IMG_WORDMARK = imgWordmark;
// Avatar served from public/avatars/ — NOT a bundled import
const IMG_AVATAR = AVATAR_PATH_MAP.Default;
const IMG_ICONS = imgIcons;

const IMG_APEX_WM = imgApexWm;

// ─── Design System ────────────────────────────────────────────────────────────

function getHealthPalette(health: OmniHealthState): {
  bg: string;
  border: string;
  color: string;
  channel: string;
} {
  // Explicit rgba() — appending a literal hex-alpha pair directly after a CSS
  // var() token is invalid CSS and silently drops the fill/border.
  if (health === "red") {
    return { bg: "rgba(239,68,68,0.13)", border: "rgba(239,68,68,0.40)", color: T.red, channel: "239,68,68" };
  }
  if (health === "yellow") {
    return { bg: "rgba(234,179,8,0.13)", border: "rgba(234,179,8,0.40)", color: T.warn, channel: "234,179,8" };
  }
  return { bg: "rgba(34,197,94,0.13)", border: "rgba(34,197,94,0.40)", color: T.green, channel: "34,197,94" };
}

function inferContextHealth(id: string, includeSecurity: boolean): OmniHealthState {
  if (id.includes("awaiting")) return "red";
  if (id.includes("trace") || id.includes("ops") || (includeSecurity && id.includes("security"))) {
    return "yellow";
  }
  return "green";
}

// ─── Icon Sprite (9-icon grid from app_icons.png: 3x3, source 1024x1024) ─────
// Row 0: Brain(0), Shield(1), Photo(2)
// Row 1: Database(3), CPU(4), Mind(5)
// Row 2: Play(6), Clock(7), Folder(8)
const SPRITE_COLS = 3;


const AppIcon = ({ idx, size = 28, style = {} }: AppIconProps) => {
  const col = idx % SPRITE_COLS;
  const row = Math.floor(idx / SPRITE_COLS);
  // Scale: rendered cell = size, so full sprite = size * SPRITE_COLS
  const fullSize = size * SPRITE_COLS;
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      backgroundImage: `url(${IMG_ICONS})`,
      backgroundSize: `${fullSize}px ${fullSize}px`,
      backgroundPosition: `-${col * size}px -${row * size}px`,
      backgroundRepeat: "no-repeat",
      imageRendering: "auto",
      ...style
    }} />
  );
};


// ─── IconBadge — unified white-border icon wrapper ───────────────────────────
const IconBadge = ({ idx, size = 19, style = {} }: IconBadgeProps) => (
  <div style={{
    width: size + 14, height: size + 14, borderRadius: 10, flexShrink: 0,
    display:"flex", alignItems:"center", justifyContent:"center",
    background: "linear-gradient(145deg, #1a2236, #0e1525)",
    border: "2.5px solid rgba(255,255,255,0.82)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
    ...style,
  }}>
    <AppIcon idx={idx} size={size} />
  </div>
);
// ─── Helpers ─────────────────────────────────────────────────────────────────
// @keyframes (apexPulse, apexShimmer, apexFadeIn, navGlow, ringRotate,
// ringBreath, ringBreath2, scanLine) live in ./omniSkin.css, imported once
// in src/main.tsx — referenced here only by animation name.






// DraggableWidget is imported from ./DraggableWidget (extracted for testability).

// ─── NavItem ──────────────────────────────────────────────────────────────────
// ALL tiles use OmniBoard's exact look as the base.
// isActive = brighter border + stronger glow only.
const NavItem = ({ n, isActive, onClick }: NavItemProps) => {
  const { tx } = useAppTranslation();
  const [hov, setHov] = useState<boolean>(false);
  const displayLabel = n.labelKey ? tx(n.labelKey, { defaultValue: n.label }) : n.label;
    // Apple-quality orange glassmorph tile. Explicit rgba() is used (not `${T.orange}xx`)
    // because appending hex alpha to a CSS variable — e.g. `var(--omni-orange)28` — is
    // invalid CSS and silently paints a transparent, borderless tile.
    const ORANGE = "249,115,22"; // --omni-orange (#f97316) channels

    const RAIL_WIDGET_FILL_ALPHA = 0.06;

    const resolveTileBackground = (active: boolean, hover: boolean) => {
      if (active) return `rgba(${ORANGE},0.08)`;
      if (hover) return `rgba(${ORANGE},0.07)`;
      return `rgba(${ORANGE},${RAIL_WIDGET_FILL_ALPHA})`;
    };

    const resolveTileBorder = (active: boolean, hover: boolean) => {
      if (active) return `1px solid rgba(${ORANGE},0.40)`;
      if (hover) return `1px solid rgba(${ORANGE},0.32)`;
      return `1px solid rgba(${ORANGE},0.25)`;
    };

    const resolveTileShadow = () => "none";

    const resolveBorder = (isActive: boolean, hov: boolean) => {
      if (isActive) return `2.5px solid rgba(255,255,255,0.90)`;
      if (hov) return `2.5px solid rgba(255,255,255,0.70)`;
      return `2.5px solid rgba(255,255,255,0.55)`;
    };

    const resolveFilter = (isActive: boolean, hov: boolean) => {
      if (isActive) return `drop-shadow(0 0 4px rgba(${ORANGE},0.73)) brightness(1.15)`;
      if (hov) return `drop-shadow(0 0 2px rgba(${ORANGE},0.45)) brightness(1.05)`;
      return `drop-shadow(0 0 1px rgba(${ORANGE},0.40)) brightness(0.9)`;
    };
  return (
    <button
      className="omni-nav-item"
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData(
          'application/apex-tile',
          JSON.stringify({ id: n.id, label: n.label, iconIdx: n.iconIdx }),
        )
      }
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"7px 10px", 
        borderRadius: 10,
        width:"100%", textAlign:"left", cursor:"pointer",
        transition:"all .18s ease",
        fontSize:14.1,
        border: resolveTileBorder(isActive, hov),
        background: resolveTileBackground(isActive, hov),
        // Same blur/saturate intensity as the right-rail glass tiles
        // (OmniTrace/OmniSentry/Ops Controls/OmniMedia/System Status) —
        // owner request: uniform opacity across all rail widgets.
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
        color: isActive ? T.t1 : T.t2,
        fontWeight: isActive ? 600 : 400,
        boxShadow: resolveTileShadow(),
      }}>

  {/* Icon badge — iOS-style white frame, orange glow on active */}
      <div style={{
        width:36, height:36, borderRadius:10, flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        background: isActive
          ? `linear-gradient(145deg, #1e2a3e, #111d30)`
          : `linear-gradient(145deg, #1a2236, #0e1525)`,
        border: resolveBorder(isActive, hov),
        boxShadow: isActive
          ? `0 0 10px rgba(249,115,22,0.19), 0 2px 8px rgba(0,0,0,0.5)`
          : `0 2px 6px rgba(0,0,0,0.4)`,
        transition:"all .18s ease",
      }}>
        <AppIcon idx={n.iconIdx} size={21} style={{
          filter: resolveFilter(isActive, hov),
          transition:"filter .18s",
        }} />
      </div>

      <span>{displayLabel}</span>

      {isActive && (
        <div style={{
          marginLeft:"auto", width:5, height:5, borderRadius:"50%",
          background:T.orange, flexShrink:0,
          boxShadow:`0 0 6px ${T.orange}`,
          animation:"apexPulse 2.8s ease-in-out infinite",
        }} />
      )}
    </button>
  );
};

// ─── Shell: Sidebar ──────────────────────────────────────────────────────────
const OmniDashSidebar = ({ activeNav, setActiveNav, kpi, systemHealth, demoMode: sidebarDemoMode }: OmniDashSidebarProps) => {
  const { tx } = useAppTranslation();
  const [signingOut, setSigningOut] = useState<boolean>(false);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      globalThis.location.href = '/login';
    } catch {
      setSigningOut(false);
    }
  }, [signingOut]);

  const handleNav = (widget: OmniDashSidebarWidget) => invokeSidebarModule(widget, setActiveNav);

  return (
    <div className="omni-sidebar" style={{
      flexShrink:0,
      background:`linear-gradient(180deg, ${T.surface} 0%, ${T.bg} 100%)`,
      borderRight:`1px solid ${T.border}`,
      display:"flex", flexDirection:"column",
      // Horizontal inset is the shared rail token so the System KPIs block (left)
      // and the System Health/status block (right rail) get EXACTLY equal inner
      // content width at every breakpoint (owner P1 KPI/status width parity).
      padding:"10px var(--omni-rail-pad-x, 12px) 0",
      gap:3,
      overflowY:"auto",
    }}>
      {OMNIDASH_SIDEBAR_WIDGETS.map((widget) => (
        <NavItem
          key={widget.id}
          n={widget}
          isActive={activeNav === widget.label}
          onClick={() => handleNav(widget)}
        />
      ))}

      {/* Status Footer — System KPIs clipped to the footer block. Horizontal
          padding is 0 so SidebarKpiBar spans the sidebar's inner content box
          (rail − 2·--omni-rail-pad-x), giving it EXACT inner-width parity with
          the right-rail SystemHealthRow status block (owner P1). */}
      <div className="omni-sidebar-footer" style={{ marginTop:"auto", padding:"12px 0 20px", borderTop:`1px solid ${T.border}` }}>
        <SidebarKpiBar kpi={kpi} systemHealth={systemHealth} demoMode={sidebarDemoMode} />
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
          <StatusDot color={T.green} />
          <span style={{ fontSize:11.9, color:T.t2, fontWeight:500 }}>{tx('dashboard.sidebar.allSystemsOperational')}</span>
        </div>
        <div style={{ fontSize:10.8, color:T.t3 }}>{tx('dashboard.sidebar.companyName')}</div>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            marginTop:12, width:"100%",
            display:"flex", alignItems:"center", justifyContent:"center", gap:7,
            padding:"7px 0", borderRadius:10,
            background:"rgba(249,115,22,0.06)", border:"1px solid rgba(249,115,22,0.15)",
            color: signingOut ? T.t3 : "rgba(249,115,22,0.75)",
            fontSize:11.9, fontWeight:600, cursor: signingOut ? "not-allowed" : "pointer",
            letterSpacing:"0.04em", transition:"all .18s",
            opacity: signingOut ? 0.6 : 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ animation: signingOut ? "spin 1s linear infinite" : "none" }}>
            {signingOut
              ? <><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></>
              : <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>
            }
          </svg>
          {signingOut ? tx('dashboard.sidebar.signingOut') : tx('dashboard.sidebar.signOut')}
        </button>
      </div>
    </div>
  );
};

// ─── Shell: Header ────────────────────────────────────────────────────────────
const OmniDashHeader = ({ isDark, setIsDark, invoke, userInitials, isDesktop }: OmniDashHeaderProps) => {
  const { tx } = useAppTranslation();
  const [orgOpen, setOrgOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  // NS-H-001: Read from sessionStorage (provider config should not persist across browser sessions)
  const [aiProvider, setAiProvider] = useState<string | null>(() => sessionStorage.getItem('omni_ai_provider'));
  // PRCC-001 WP-2b: Connect AI opens the real BYOM credential modal
  // (ConnectAiAuthModal -> byom-login, AES-256-GCM vault) instead of the previous
  // cosmetic label-swap. Cross-reload reflection from provider_connections is a
  // tracked follow-up (needs a demoMode-guarded read; deferred to keep this diff
  // surgical and avoid coupling the header to a backend read on every mount).
  const [showConnectAi, setShowConnectAi] = useState<boolean>(false);

  // ⌘K / Ctrl+K opens search from anywhere on the dashboard (all viewports,
  // even where the header trigger is hidden).
  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const handleOmniSkills = () => {
    invoke({
      id: 'header-omniskills',
      provider: 'omnidash',
      type: 'module',
      title: 'OmniSkills',
      contextData: { moduleKey: 'omniskills' },
      onComplete: async () => { toast.success('OmniSkills configured'); },
      onCancel: () => {},
    });
  };

  // PRCC-001 WP-2b: open the real BYOM credential capture (ConnectAiAuthModal ->
  // byom-login). Replaces the registry-selection label-swap that set a display
  // string in sessionStorage without ever capturing or encrypting a credential.
  const handleConnectAI = () => {
    setShowConnectAi(true);
  };

  const handleConnectAiSuccess = () => {
    setShowConnectAi(false);
    const connected = sessionStorage.getItem('omni_ai_provider');
    if (connected) setAiProvider(connected);
  };

  const { demoMode } = useDemoMode();
  const notifications = useNotificationStore(state => state.notifications);
  const unreadCount = useNotificationStore(state => state.getUnreadCount());
  const markAllAsRead = useNotificationStore(state => state.markAllAsRead);

  const handleBell = () => {
    if (notifications.length === 0) {
      invoke({
        id: 'header-notifications',
        provider: 'omnidash',
        type: 'selection',
        title: tx('dashboard.header.notifications'),
        description: tx('dashboard.header.noNotifications'),
        schema: {
          items: [],
        },
        onComplete: async () => {},
        onCancel: () => {},
      });
      return;
    }

    invoke({
      id: 'header-notifications',
      provider: 'omnidash',
      type: 'selection',
      title: tx('dashboard.header.notifications'),
      description: tx('dashboard.header.recentActivity'),
      schema: {
        items: notifications.map(n => ({
          id: n.id,
          label: n.label,
          badge: n.badge
        }))
      },
      onComplete: async () => { 
        markAllAsRead();
        toast.info('Notifications marked read'); 
      },
      onCancel: () => {},
    });
  };
  return (
    <div data-testid="omnidash-top-header" style={{
      height:58, flexShrink:0,
      // Explicit rgba() — appending a literal hex-alpha pair directly after a CSS
      // var() token is invalid CSS. Theme-aware since this inline style overrides the cascade.
      background: isDark ? "rgba(11,17,32,0.94)" : "rgba(255,255,255,0.94)",
      borderBottom:`1px solid ${T.border}`,
      backdropFilter:"blur(20px)",
      display:"flex", alignItems:"center",
      padding:"0 20px 0 12px", gap:0,
      zIndex:100,
    }}>
      {/* Wordmark */}
      <div style={{ flexShrink:0, display:"flex", alignItems:"center", marginRight:10 }}>
        <img
          data-testid="top-header-logo"
          src={IMG_WORDMARK}
          alt="APEX-OmniHub"
          style={{ height:30, width: isDesktop ? 210 : 132, objectFit:"contain", display:"block" }}
        />
      </div>

      {/* OmniSkills */}
      <button onClick={handleOmniSkills} style={{
        display:"flex", alignItems:"center", gap:7, flexShrink:0,
        background:T.card, border:`1px solid ${T.border}`,
        borderRadius:10, padding:"0 11px", height:44,
        color:T.t1, fontSize:13, cursor:"pointer", fontWeight:500,
        whiteSpace:"nowrap", marginRight:10,
        transition:"border-color .15s, background .15s",
      }}>
        <IconBadge idx={0} size={17} />
        {tx('dashboard.header.omniSkills')}
      </button>

      {/* Search — desktop only; on mobile/tablet it is dropped so the action
          controls are never clipped. A flex spacer keeps actions right-aligned. */}
      {isDesktop ? (
        <div className="omni-header-search" style={{ flex:1, display:"flex", justifyContent:"center", marginRight:10 }}>
          <button
            type="button"
            data-testid="omnidash-search-trigger"
            aria-haspopup="dialog"
            onClick={() => setSearchOpen(true)}
            style={{
              display:"flex", alignItems:"center", gap:9,
              background:T.card, border:`1px solid ${T.border}`,
              borderRadius:10, padding:"0 12px",
              width:"100%", maxWidth:360, height:44,
              color:T.t2, fontSize:13, cursor:"pointer",
              textAlign:"left", fontFamily:"inherit",
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <span style={{color:T.t3, flex:1}}>{tx('dashboard.header.searchPlaceholder')}</span>
            <span style={{fontSize:10.3,color:T.t4,background:T.surface,padding:"2px 5px",borderRadius:5,fontWeight:600}}>⌘K</span>
          </button>
        </div>
      ) : (
        <div style={{ flex:1, minWidth:8 }} aria-hidden="true" />
      )}
      <OmniSearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Right actions — functional buttons */}
      <div className="omni-header-actions" style={{
        display:"flex", alignItems:"center", gap:8,
        // Mobile/tablet: shrink + scroll so no control is ever clipped/obfuscated.
        flexShrink: isDesktop ? 0 : 1,
        minWidth: 0,
        overflowX: isDesktop ? undefined : "auto",
      }}>
        {/* Org Selector */}
        <div style={{ position:"relative" }}>
          <button id="org-selector-btn" onClick={() => setOrgOpen(o => !o)} style={{
            display:"flex", alignItems:"center", gap:6,
            background:T.card, border:`1px solid ${orgOpen ? "rgba(249,115,22,0.40)" : T.border}`,
            borderRadius:10, padding:"0 10px", height:34,
            color:T.t1, fontSize:12.4, cursor:"pointer", fontWeight:500,
            whiteSpace:"nowrap", maxWidth:170, overflow:"hidden",
            transition:"border-color .15s",
          }}>
            <img src={IMG_BADGE} alt="Org Badge" style={{width:16,height:16,objectFit:"contain",flexShrink:0}} />
            <span style={{ maxWidth:105, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>APEX Business Systems{/* brand — not translated */}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transition:"transform .2s", transform: orgOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          {orgOpen && (
            <div style={{
              position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:200,
              background:T.card, border:`1px solid ${T.border}`,
              borderRadius:12, minWidth:210, overflow:"hidden",
              boxShadow:`0 8px 32px rgba(0,0,0,.5)`,
              animation:"apexFadeIn .15s ease",
            }}>
              <div style={{ padding:"10px 14px 8px", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ fontSize:11.9, fontWeight:700, color:T.t1 }}>APEX Business Systems</div>
                <div style={{ fontSize:10.3, color:T.t3, marginTop:2 }}>Edmonton, AB · {tx('dashboard.header.orgEnterprise')}</div>
              </div>
              {[
                { label: tx('dashboard.header.workspaceSettings'), icon:"⚙️", action: () => { setOrgOpen(false); invoke({ id:'org-settings', provider:'omnidash', type:'module', title:'Settings', contextData:{ moduleKey:'settings' }, onComplete: async () => { toast.success('Settings updated'); }, onCancel: () => {} }); } },
                { label: tx('dashboard.header.billingPlans'), icon:"💳", action: () => { setOrgOpen(false); invoke({ id:'org-billing', provider:'omnidash', type:'module', title:'Billing', contextData:{ moduleKey:'billing' }, onComplete: async () => { toast.success('Billing changes applied'); }, onCancel: () => {} }); } },
                { label: tx('dashboard.header.inviteMembers'), icon:"👥", action: () => { setOrgOpen(false); invoke({ id:'org-invite', provider:'omnidash', type:'form', title:'Invite Team Member', schema: { fields: [{ key:'email', label:'Email Address', type:'email', placeholder:'teammate@company.com', required:true }, { key:'role', label:'Role', type:'text', placeholder:'e.g. Admin, Viewer' }] }, onComplete: async (result) => { toast.success(tx('dashboard.header.inviteSent', { email: (result.data as Record<string, string>)?.email || 'team member' })); }, onCancel: () => {} }); } },
              ].map(item => (
                <button key={item.label} onClick={item.action} style={{
                  display:"flex", alignItems:"center", gap:10,
                  width:"100%", padding:"9px 14px", textAlign:"left",
                  background:"none", border:"none", cursor:"pointer",
                  color:T.t1, fontSize:13.5, transition:"background .12s",
                }}>
                  <span style={{ fontSize:15 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Zero Trust */}
        <div style={{
          display:"flex", alignItems:"center", gap:6,
          border:"1px solid rgba(34,197,94,0.27)",
          background:"rgba(34,197,94,0.07)",
          borderRadius:10, padding:"0 11px", height:34,
          color:T.green, fontSize:12.4, fontWeight:700,
          whiteSpace:"nowrap",
        }}>
          <div style={{
            width:6, height:6, borderRadius:"50%", background:T.green, flexShrink:0,
            animation:"apexPulse 2s ease-in-out infinite",
          }} />
          {tx('dashboard.header.zeroTrustActive')}{demoMode ? ` ${tx('dashboard.footer.simulated')}` : ''}
        </div>

        {/* Connect AI */}
        <button onClick={handleConnectAI} style={{
          background:`linear-gradient(135deg, ${T.orange} 0%, ${T.orangeDim} 100%)`,
          border:"none", borderRadius:10, padding:"0 13px", height:34,
          color:"#fff", fontSize:12.4, fontWeight:700,
          cursor:"pointer", boxShadow:"0 4px 16px rgba(249,115,22,0.27)",
          whiteSpace:"nowrap",
          transition:"opacity .15s",
        }}>
          {aiProvider || tx('dashboard.header.connectAi')}
        </button>
        <ConnectAiAuthModal
          isOpen={showConnectAi}
          onClose={() => setShowConnectAi(false)}
          onSuccess={handleConnectAiSuccess}
        />

        {/* Divider — separates action buttons from icon tray */}
        <div style={{ width:1, height:28, background:T.border, flexShrink:0, marginLeft:2, marginRight:2 }} />

        {/* Language Selector */}
        <LanguageSelector className="omni-header-lang" />

        {/* Theme Toggle — Sun/Moon */}
        <button className="ose-icon-button" aria-label={isDark ? tx('dashboard.mobile.switchLight') : tx('dashboard.mobile.switchDark')} onClick={() => setIsDark(d => !d)} style={{ color: isDark ? T.warn : T.blue }}>
          {isDark
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
          }
        </button>

        {/* Bell */}
        <button className="ose-icon-button" aria-label={`${tx('dashboard.header.notifications')}${unreadCount > 0 ? ` (${unreadCount})` : ''}`} onClick={handleBell}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {unreadCount > 0 && (
            <div className="ose-icon-button__badge">
              {unreadCount}
            </div>
          )}
        </button>

        {/* Avatar — initials from authenticated user */}
        <div className="ose-avatar-button" role="img" aria-label="User avatar">{userInitials}</div>
      </div>
    </div>
  );
};

// ─── Widget: APEX Agent ───────────────────────────────────────────────────────
const AgentWidget = (_props: AgentWidgetProps) => {
  const { tx } = useAppTranslation();
  const { autoPilot, setAutoPilot } = useDemoMode();
  const [seconds, setSeconds] = useState(0);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<string>(AVATAR_PATH_MAP.Default);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunning = autoPilot;

  // Timer driven by isRunning — Play/Pause actually controls it
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  const handlePlayPause = () => setAutoPilot(!autoPilot);
  const handleReset = () => { setAutoPilot(false); setSeconds(0); };

  // Long-press on avatar (500ms) → open avatar picker
  const handleAvatarPointerDown = () => {
    longPressTimerRef.current = setTimeout(() => setShowAvatarPicker(true), 500);
  };
  const handleAvatarPointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <GlassCard style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", position:"relative" }}>
      {/* Header — unified 44px */}
      <div style={{ height:44, padding:"0 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <SectionLabel>{tx('dashboard.agent.title')}</SectionLabel>
        <StatusDot color={isRunning ? T.green : T.warn} />
      </div>

      {/* Session Timer — compact */}
      <div style={{ textAlign:"center", padding:"8px 16px 4px" }}>
        <div style={{ fontSize:8.7, color:T.t3, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:2 }}>{tx('dashboard.agent.session')}</div>
        <div style={{
          fontSize:19.5, fontWeight:700, letterSpacing:"0.06em",
          fontVariantNumeric:"tabular-nums",
          background:`linear-gradient(135deg,${T.t1},${T.t2})`,
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
        }}>{mm}:{ss}</div>
      </div>

      {/* Avatar picker overlay — triggered by long press */}
      {showAvatarPicker && (
        <div style={{
          position:"absolute", inset:0, zIndex:50, borderRadius:14,
          background:"rgba(6,10,19,0.94)", backdropFilter:"blur(10px)",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          gap:16, padding:20,
        }}>
          <div style={{ fontSize:9.5, color:"rgba(224,231,255,0.45)", letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:700 }}>
            {tx('dashboard.agent.chooseAvatar')}
          </div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center" }}>
            {AGENT_AVATARS.map((filename) => {
              const src = avatarPath(filename);
              const isSelected = selectedAvatar === src;
              return (
                <button
                  key={filename}
                  type="button"
                  title={agentNameFromAvatarFile(filename)}
                  onClick={() => { setSelectedAvatar(src); setShowAvatarPicker(false); }}
                  style={{
                    padding:3, borderRadius:"50%", background:"transparent", cursor:"pointer",
                    border: isSelected ? `2px solid ${T.orange}` : "2px solid rgba(255,255,255,0.12)",
                    boxShadow: isSelected ? "0 0 12px rgba(249,115,22,0.40)" : "none",
                    transition:"all .18s",
                  }}
                >
                  <img src={src} alt={agentNameFromAvatarFile(filename)}
                    style={{ width:52, height:52, borderRadius:"50%", display:"block", objectFit:"cover" }}
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowAvatarPicker(false)}
            style={{
              marginTop:4, padding:"6px 20px", borderRadius:8, cursor:"pointer",
              border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.06)",
              color:"rgba(224,231,255,0.6)", fontSize:11, fontWeight:600,
              fontFamily:"'Space Grotesk',sans-serif",
            }}
          >
            {tx('dashboard.agent.cancel')}
          </button>
        </div>
      )}

      {/* Avatar + orbital ring visualizer */}
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ position:"relative", width:136, height:136, display:"flex", alignItems:"center", justifyContent:"center" }}>

          {/* Breathing ring — outermost, slowest */}
          <div style={{
            position:"absolute",
            width:130, height:130, borderRadius:"50%",
            border:`1px solid ${T.orange}`,
            animation:"ringBreath2 3.8s ease-in-out infinite",
            transformOrigin:"center",
          }} />

          {/* Breathing ring — mid */}
          <div style={{
            position:"absolute",
            width:116, height:116, borderRadius:"50%",
            border:`1.5px solid ${T.orange}`,
            animation:"ringBreath 2.6s ease-in-out infinite 0.4s",
            transformOrigin:"center",
          }} />

          {/* Rotating comet arc — CSS-native 60fps */}
          <div style={{
            position:"absolute",
            width:108, height:108,
            borderRadius:"50%",
            animation:"ringRotate 2.8s linear infinite",
            transformOrigin:"center",
          }}>
            <svg width="108" height="108" viewBox="0 0 108 108" style={{ display:"block" }}>
              <defs>
                <linearGradient id="cometGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#f97316" stopOpacity="0"/>
                  <stop offset="60%"  stopColor="#f97316" stopOpacity="0.6"/>
                  <stop offset="100%" stopColor="#f97316" stopOpacity="1"/>
                </linearGradient>
              </defs>
              {/* Arc using strokeDasharray — shows ~35% of circumference as the comet tail */}
              <circle
                cx="54" cy="54" r="50"
                fill="none"
                stroke="url(#cometGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="110 205"
                strokeDashoffset="0"
              />
            </svg>
          </div>

          {/* Counter-rotating inner comet — cyan, slower */}
          <div style={{
            position:"absolute",
            width:92, height:92,
            borderRadius:"50%",
            animation:"ringRotate 4.4s linear infinite reverse",
            transformOrigin:"center",
          }}>
            <svg width="92" height="92" viewBox="0 0 92 92" style={{ display:"block" }}>
              <defs>
                <linearGradient id="cometGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#06b6d4" stopOpacity="0"/>
                  <stop offset="70%"  stopColor="#06b6d4" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.7"/>
                </linearGradient>
              </defs>
              <circle
                cx="46" cy="46" r="42"
                fill="none"
                stroke="url(#cometGrad2)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="70 194"
                strokeDashoffset="0"
              />
            </svg>
          </div>

          {/* Avatar — long press to open avatar picker */}
          <div
            onPointerDown={handleAvatarPointerDown}
            onPointerUp={handleAvatarPointerUp}
            onPointerLeave={handleAvatarPointerUp}
            title={tx('dashboard.agent.longPressHint')}
            style={{
              width:80, height:80, borderRadius:"50%",
              overflow:"hidden", position:"relative", zIndex:1,
              border:"2px solid rgba(249,115,22,0.33)",
              boxShadow:"0 0 14px rgba(249,115,22,0.16), 0 0 28px rgba(249,115,22,0.07)",
              cursor:"pointer",
              userSelect:"none",
            }}
          >
            <img src={selectedAvatar} alt="APEX Agent" style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} loading="lazy" decoding="async" />
          </div>
        </div>
      </div>

      {/* Controls — Start/Pause + Reset, pinned to bottom */}
      <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:10, padding:"12px 16px 16px", flexShrink:0 }}>
        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          title={isRunning ? tx('dashboard.agent.pause') : tx('dashboard.agent.start')}
          style={{
            width:44, height:44, borderRadius:12,
            border:"1px solid rgba(249,115,22,0.53)",
            background: isRunning ? "rgba(249,115,22,0.16)" : "rgba(249,115,22,0.09)",
            display:"flex",alignItems:"center",justifyContent:"center",
            cursor:"pointer", color:T.orange,
            boxShadow: isRunning ? "0 0 10px rgba(249,115,22,0.27)" : "none",
            transition:"all .2s",
          }}
        >
          {isRunning
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          }
        </button>
        {/* Reset */}
        <button
          onClick={handleReset}
          title={tx('dashboard.agent.reset')}
          style={{
            height:44, borderRadius:12, padding:"0 14px",
            border:`1px solid ${T.border}`,
            background:T.surface,
            display:"flex",alignItems:"center",justifyContent:"center",gap:6,
            cursor:"pointer", color:T.t2,
            fontSize:11.4, fontWeight:600, letterSpacing:"0.04em",
            transition:"all .2s",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5"/>
          </svg>
          {tx('dashboard.agent.reset')}
        </button>
      </div>
    </GlassCard>
  );
};

const ContextDroplet = ({ app, onRemove }: { app: OmniContextApp, onRemove: () => void }) => {
  const [hov, setHov] = useState(false);
  const palette = getHealthPalette(app.health);
  const icon = app.iconIdx === undefined
    ? <span style={{fontSize:13}}>{app.label.charAt(0).toUpperCase()}</span>
    : <AppIcon idx={app.iconIdx} size={16} style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} />;

  return (
    <button
      onClick={onRemove}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={`Remove ${app.label}`}
      style={{
        width: 28, height: 28, borderRadius: 8,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: palette.color,
        fontSize: 14, fontWeight: 700,
        boxShadow: `inset 0 0 10px rgba(0,0,0,0.5)`,
        cursor: "pointer",
        position: "relative",
        transition: "all 0.15s ease",
        transform: hov ? "scale(1.05)" : "scale(1)",
      }}
    >
      <div style={{ opacity: hov ? 0.15 : 1, transition: "opacity 0.15s ease", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      {hov && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </div>
      )}
    </button>
  );
};



const OmniSlateWidget = () => {
  const { tx } = useAppTranslation();
  const { demoMode } = useDemoMode();
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<{role: string; text: string}[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [contextApps, setContextApps] = useState<OmniContextApp[]>([]);
  const [showContext, setShowContext] = useState<boolean>(false);
  const endRef = useRef<HTMLDivElement>(null);

  // PRCC-001 WP-2a: hydrate chat history from omnislate_messages on mount so the
  // conversation survives reloads. Previously messages lived only in useState, so
  // every reload wiped the thread (audit 2026-07-01 defect #2). RLS scopes reads
  // to auth.uid(); demo mode stays ephemeral (no hydrate/persist).
  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('omnislate_messages')
        .select('role, content, created_at')
        .order('created_at', { ascending: true })
        .limit(100);
      if (cancelled || error || !data || data.length === 0) return;
      setMessages(data.map((m: Record<string, unknown>) => ({ role: String(m.role), text: String(m.content) })));
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  const send = useCallback(async () => {
    if (!input.trim()) return;
    const q = input.trim(); setInput(""); setLoading(true);
    setMessages(m => [...m, {role:"user", text:q}]);

    try {
      const res = await invokeMcpIntent({
        prompt: q,
        context: { apps: contextApps.map(a => a.id) }
      });
      const reply = res.reply;
      setMessages(m => [...m, {role:"assistant", text: reply }]);
      // WP-2a: persist both turns (best-effort, non-blocking; RLS WITH CHECK ties
      // rows to auth.uid()). Never awaited into the UI path — a persist failure
      // must not affect the live conversation.
      if (!demoMode) {
        void supabase.auth.getUser().then(({ data: u }) => {
          const uid = u?.user?.id;
          if (!uid) return;
          void supabase.from('omnislate_messages').insert([
            { user_id: uid, role: 'user', content: q },
            { user_id: uid, role: 'assistant', content: reply },
          ]);
        });
      }
    } catch (err) {
      console.error('[OmniSlateWidget] mcp-client invocation failed:', err);
      // PRCC-TASK1: Honest error gate — classify failure mode before surfacing to
      // the user. No raw stack traces, no generic Guardian string. Each branch maps
      // to a specific, actionable recovery step per the Honest Gateway Law.
      setMessages(m => [...m, {role:"assistant", text: classifyMcpError(err)}]);
    } finally {
      setLoading(false);
    }
  }, [input, contextApps, demoMode]);

  const stop = useCallback(() => {
    setLoading(false);
    setMessages(m => m.length > 0 && m.at(-1)?.role === 'user'
      ? [...m, {role:"assistant", text:"— Response stopped by user."}]
      : m
    );
  }, []);

  const fillSuggestion = () => {
    setInput("Summarize all open workflows and flag anything stalled over 24 hours.");
  };

  const addContextApp = useCallback(
    (id: string, label: string, iconIdx: number | undefined, includeSecurity: boolean) => {
      setContextApps(prev => {
        if (prev.some(a => a.id === id)) return prev;
        const health = inferContextHealth(id, includeSecurity);
        return [...prev, { id, label, health, iconIdx }];
      });
    },
    [],
  );

  useEffect(() => {
    const handleWidgetDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ id: string; label: string; iconIdx?: number }>;
      const { id, label, iconIdx } = customEvent.detail;
      addContextApp(id, label, iconIdx, false);
    };
    globalThis.addEventListener("omnislate-drop", handleWidgetDrop);
    return () => globalThis.removeEventListener("omnislate-drop", handleWidgetDrop);
  }, [addContextApp]);

  // Only scroll to the latest message once a conversation exists. Firing this on
  // mount (empty messages) scrolls the shared canvas container and clips the
  // canonical top row (Agent/Slate/Ecosystem) under the viewport. block:"nearest"
  // also prevents scrolling when the anchor is already visible.
  useEffect(() => {
    if (messages.length === 0) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const handleRemoveContextApp = useCallback((appId: string) => {
    setContextApps(prev => prev.filter(a => a.id !== appId));
  }, []);

  let aggregateHealth: string | null = null;
  // Decimal RGB channels paired with aggregateHealth — CSS var()+hex-append
  // (e.g. `${aggregateHealth}66`) is invalid CSS, so rgba() needs literal channels.
  let aggregateHealthChannel: string | null = null;
  if (contextApps.length > 0) {
    if (contextApps.some(a => a.health === "red")) {
      aggregateHealth = T.red;
      aggregateHealthChannel = "239,68,68";
    } else if (contextApps.some(a => a.health === "yellow")) {
      aggregateHealth = T.warn;
      aggregateHealthChannel = "234,179,8";
    } else {
      aggregateHealth = T.green;
      aggregateHealthChannel = "34,197,94";
    }
  }
  const contextAccent = aggregateHealth ?? T.orange;
  const contextAccentChannel = aggregateHealthChannel ?? "249,115,22";
  const contextBackground = `rgba(${contextAccentChannel},0.13)`;
  const contextBorderColor = aggregateHealthChannel ? `rgba(${aggregateHealthChannel},0.67)` : "rgba(249,115,22,0.27)";
  const contextBorder = `1px solid ${contextBorderColor}`;
  const contextBoxShadow = aggregateHealthChannel ? `0 0 8px rgba(${aggregateHealthChannel},0.27)` : "none";

  return (
    <GlassCard glow style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"visible" }}>
      {/* Header — unified 44px */}
      <div style={{
        height:44, padding:"0 16px", flexShrink:0,
        borderBottom:`1px solid ${T.borderGlow}`,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        background:"linear-gradient(90deg,rgba(249,115,22,0.03),transparent)",
      }}>
        <SectionLabel>{tx('dashboard.slate.title')}</SectionLabel>
        <div style={{display:"flex",gap:8, position:"relative"}}>
          <button onClick={() => {
            setMessages([]);
            if (!demoMode) {
              void supabase.auth.getUser().then(({ data: u }) => {
                const uid = u?.user?.id;
                if (uid) void supabase.from('omnislate_messages').delete().eq('user_id', uid);
              });
            }
          }} style={{
            fontSize:11.9,fontWeight:600,color:T.orange,
            background:"rgba(249,115,22,0.08)",border:"1px solid rgba(249,115,22,0.27)",
            borderRadius:8,padding:"3px 10px",cursor:"pointer",
          }}>{tx('dashboard.slate.cleanSlate')}</button>

          <button
            type="button"
            onMouseEnter={() => setShowContext(true)}
            onMouseLeave={() => setShowContext(false)}
            onFocus={() => setShowContext(true)}
            onBlur={() => setShowContext(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fillSuggestion();
              }
            }}
            onClick={fillSuggestion}
            title={aggregateHealth ? tx('dashboard.slate.viewContext') : tx('dashboard.slate.fillSuggestion')}
            style={{ position: "relative", background: "none", border: "none", padding: 0 }}
          >
            <div
              style={{
                width:26,height:26,borderRadius:8,
                background: contextBackground,
                border: contextBorder,
                color: contextAccent,
                cursor:"pointer",fontSize:14.1,display:"flex",alignItems:"center",justifyContent:"center",
                transition: "all .2s ease",
                boxShadow: contextBoxShadow,
              }}
            >
              💡
            </div>

            {/* Non-intrusive Context Tooltip on Hover */}
            {showContext && contextApps.length > 0 && (
               <div style={{
                 position: "absolute", top: "100%", right: 0, marginTop: 8,
                 background: T.card, border: `1px solid rgba(${contextAccentChannel},0.40)`,
                 borderRadius: 12, padding: 10, width: 240, zIndex: 100,
                 boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 12px rgba(${contextAccentChannel},0.13)`,
                 display: "flex", flexDirection: "column", gap: 6,
               }}>
                 <div style={{ fontSize: 9.8, fontWeight: 700, color: T.t2, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                   {tx('dashboard.slate.contextSources')}
                 </div>
                 {contextApps.map(app => {
                   const palette = getHealthPalette(app.health);
                   return (
                     <div key={app.id} style={{
                       fontSize: 11.2, fontWeight: 600, padding: "5px 8px", borderRadius: 6,
                       background: palette.bg.replace("0.13", "0.10"),
                       color: palette.color,
                       border: `1px solid rgba(${palette.channel},0.27)`,
                       display: "flex", alignItems: "center", gap: 6
                     }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
                      <div style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{app.label}</div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRemoveContextApp(app.id); }} 
                       title={tx('dashboard.slate.removeContext')}
                       style={{
                         background: "none", border: "none", color: "currentColor", cursor: "pointer", 
                         opacity: 0.6, padding: 0, display: "flex", alignItems: "center"
                       }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                   );
                 })}
                </div>
             )}
          </button>
        </div>
      </div>
      {/* Canvas — shows demo seed or live conversation */}
      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", display:"flex", flexDirection:"column", gap:10, minHeight:0 }}>
        {messages.length === 0 && (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontSize:12, color:T.t4, fontStyle:"italic" }}>
              {demoMode ? tx('dashboard.slate.demoSession') : tx('dashboard.slate.startSession')}
            </span>
          </div>
        )}
        {messages.map((m) => (
          <div key={`${m.role}-${m.text.slice(0, 32)}`} style={{
            display:"flex", gap:10, justifyContent: m.role==="user"?"flex-end":"flex-start",
            animation:"apexFadeIn .3s ease",
          }}>
            {m.role==="assistant" && (
              <div style={{width:26,height:26,borderRadius:"50%",overflow:"hidden",flexShrink:0,border:"1px solid rgba(249,115,22,0.40)"}}>
                <img src={IMG_AVATAR} alt="AI Avatar" style={{width:"100%",height:"100%",objectFit:"cover"}} loading="lazy" decoding="async" />
              </div>
            )}
            <div style={{
              maxWidth:"78%",
              background: m.role==="user"
                ? "linear-gradient(135deg,rgba(249,115,22,0.13),rgba(59,130,246,0.09))"
                : T.surface,
              border:`1px solid ${m.role==="user"?"rgba(249,115,22,0.20)":T.border}`,
              borderRadius: m.role==="user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              padding:"9px 13px", fontSize:14.1, color:T.t1, lineHeight:1.5,
            }}>{m.text}</div>
          </div>
        ))}
        {loading && (
          <div style={{display:"flex",gap:5,alignItems:"center",padding:"4px 8px"}}>
            {[0,1,2].map(i => (
              <div key={`dot-${i}`} style={{
                width:6,height:6,borderRadius:"50%",background:T.orange,
                animation:`apexPulse 1.2s ease ${i*0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Uniform Context Icons Map */}
      {contextApps.length > 0 && (
        <div style={{ padding: "0 14px", display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, flexShrink: 0 }}>
          {contextApps.map(app => (
            <ContextDroplet
              key={app.id}
              app={app}
              onRemove={() => handleRemoveContextApp(app.id)}
            />
          ))}
        </div>
      )}

      {/* Input — flexShrink:0 so the prompt + submit are never compressed out of
          view, even when the message canvas grows. The message canvas (flex:1,
          overflowY:auto) absorbs all height pressure instead. */}
      <div style={{
        padding:"0 14px 14px",
        display:"flex", gap:10, alignItems:"center", flexShrink:0,
      }}>
        <input
          data-testid="omnislate-prompt-input"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key==="Enter" && send()}
          placeholder={tx('dashboard.slate.placeholder')}
          style={{
            flex:1, minWidth:0, background:T.surface,
            border:`1px solid ${T.border}`,
            borderRadius:12, padding:"11px 15px",
            color:T.t1, fontSize:14.6,
            outline:"none", transition:"border-color .15s",
          }}
        />
        {/* Play / Stop icon buttons only — no text labels */}
        <button data-testid="submit-prompt" onClick={send} title={tx('dashboard.slate.execute')} style={{
          width:44, height:44, borderRadius:12, flexShrink:0,
          background:`linear-gradient(135deg,${T.orange},${T.orangeDim})`,
          border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:"0 4px 14px rgba(249,115,22,0.27)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button
          onClick={stop}
          title={tx('dashboard.slate.stop')}
          disabled={!loading}
          style={{
            width:44, height:44, borderRadius:12, flexShrink:0,
            background: loading ? "rgba(249,115,22,0.07)" : T.surface,
            border:`1px solid ${loading ? "rgba(249,115,22,0.33)" : T.border}`,
            cursor: loading ? "pointer" : "not-allowed",
            display:"flex", alignItems:"center", justifyContent:"center",
            transition:"all .2s",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={loading ? T.orange : T.t3}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        </button>
      </div>
    </GlassCard>
  );
};

// ─── Shared tile dimensions (used by the APEX Ecosystem widget)
const APP_TILE_STYLE: React.CSSProperties = {
  borderRadius:14,
  padding:"18px 14px",
  display:"flex", flexDirection:"row", alignItems:"center", justifyContent:"center", gap:10,
  cursor:"pointer", transition:"all .2s",
  minHeight:72,
};

// ─── Widget: APEX Ecosystem ───────────────────────────────────────────────────
const EcosystemWidget = () => {
  const { tx } = useAppTranslation();
  const { invoke } = useOmniModal();

  const handleAddApp = () => {
    // Canon: APEX ecosystem apps open the APEX Apps MCP modal, NEVER OmniBoard.
    invoke({
      id: 'ecosystem-add-apex-app',
      provider: 'omnidash',
      type: 'module',
      title: 'Connect APEX App',
      contextData: { moduleKey: APEX_APPS_MODULE_KEY },
      onComplete: async () => {},
      onCancel: () => {},
    });
  };

  // Explicit rgba() — appending a literal hex-alpha pair directly after a CSS
  // var() token is invalid CSS and silently drops the orange fill/border/glow.
  const ORANGE = "249,115,22"; // --omni-orange (#f97316) channels

  return (
  <GlassCard glow style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
    <div style={{ height:44, padding:"0 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center" }}>
      <SectionLabel>{tx('dashboard.ecosystem.title')}</SectionLabel>
    </div>
    <div style={{ padding:"14px", flex:1 }}>
      {/* APEX app tile */}
      <button
        draggable
        onDragStart={(e) => e.dataTransfer.setData('application/apex-tile', JSON.stringify({ id: 'ecosystem', label: 'APEX Ecosystem' }))}
        onClick={handleAddApp} style={{
        ...APP_TILE_STYLE,
        width:"100%",
        background:`linear-gradient(135deg, rgba(${ORANGE},0.20) 0%, rgba(${ORANGE},0.05) 100%)`,
        border:`1px solid rgba(${ORANGE},0.55)`,
        boxShadow:`0 0 28px rgba(${ORANGE},0.22), 0 0 8px rgba(${ORANGE},0.12), inset 0 1px 0 rgba(255,255,255,0.06)`,
        backdropFilter:"blur(10px) saturate(140%)",
        WebkitBackdropFilter:"blur(10px) saturate(140%)",
        color:T.orange,
        fontWeight:700, fontSize:15, letterSpacing:"0.01em",
      }}>
        <span style={{
          width:34, height:34, borderRadius:10,
          background:`rgba(${ORANGE},0.18)`, border:`1.5px solid rgba(${ORANGE},0.55)`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:22, color:T.orange, flexShrink:0,
          boxShadow:`0 0 14px rgba(${ORANGE},0.35)`,
        }}>+</span>
        {' '}{tx('dashboard.ecosystem.addApp')}
      </button>
    </div>
  </GlassCard>
  );
};

// ─── Widget: Integrated Apps Gallery (display-only — no connection ownership) ──
// This is a GALLERY, not an integration owner. It shows integrated-app status
// tiles only and never opens a modal, invokes OmniBoard, or invokes the APEX
// Apps MCP. Third-party connections are owned exclusively by OmniBoard (sidebar
// nav); first-party APEX app connections are owned exclusively by the APEX
// Ecosystem widget's "Add APEX App" → APEX_APPS_MODULE_KEY. The PR #1510
// retired "Connections" split-panel duplicated both of those owners and must
// not return (no split sub-panels, no connect CTA in this gallery).
// PRCC-TASK3: Gallery now reads apex_app_installs (status=user_confirmed) via
// RLS-scoped Supabase query on mount. Demo mode stays ephemeral (no read).
// Confirmed apps render as real tiles; remaining slots show honest AWAITING.
interface AppInstallRow { app_id: string; app_label: string; status: string; }

const GALLERY_MIN_SLOTS = 4;

const IntegratedAppsGalleryWidget = () => {
  const { tx } = useAppTranslation();
  const { demoMode } = useDemoMode();
  const [installs, setInstalls] = useState<AppInstallRow[]>([]);

  // Load user-confirmed installs on mount. Best-effort — failure stays silent
  // and the gallery gracefully falls back to all-AWAITING placeholders.
  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('apex_app_installs')
        .select('app_id, app_label, status')
        .eq('status', 'user_confirmed')
        .order('updated_at', { ascending: false })
        .limit(GALLERY_MIN_SLOTS);
      if (cancelled || error || !data) return;
      setInstalls(data as AppInstallRow[]);
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  // Fill remaining slots with AWAITING placeholders (always show ≥4 slots)
  const placeholderCount = Math.max(0, GALLERY_MIN_SLOTS - installs.length);

  return (
  <GlassCard style={{ padding: '16px' }}>
    <div style={{ marginBottom: 12 }}>
      {/* Canonical Layout Law: gallery label is a locked literal (check-omnidash-integrity) */}
      <SectionLabel>App Gallery</SectionLabel>
    </div>
    <div
      data-testid="integrated-apps"
      className="omni-grid-apps"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}
    >
      {/* Real confirmed APEX app tiles */}
      {installs.map(app => (
        <div
          key={`apex-install-${app.app_id}`}
          className="ose-integrated-apps-slot"
          data-testid={`apex-app-tile-${app.app_id}`}
          aria-label={`${app.app_label} — connected`}
          style={{
            background: 'rgba(34,197,94,0.07)',
            border: '1px solid rgba(34,197,94,0.30)',
            borderRadius: 12,
            padding: '16px 14px',
            display: 'flex', flexDirection: 'column', gap: 10,
            alignItems: 'flex-start', minWidth: 0,
          }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(34,197,94,0.14)',
            border: '1px solid rgba(34,197,94,0.40)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, color: T.green, fontSize: 14,
          }}>✓</span>
          <span style={{ fontSize: 11, color: T.green, letterSpacing: '0.03em', fontWeight: 700,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
            {app.app_label}
          </span>
        </div>
      ))}
      {/* AWAITING placeholders fill remaining slots */}
      {Array.from({ length: placeholderCount }, (_, i) => (
        <div
          key={`integrated-app-ph-${i}`}
          className="ose-integrated-apps-slot"
          aria-label={tx('dashboard.appGallery.awaitingSlot', { n: installs.length + i + 1 })}
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: '16px 14px',
            display: 'flex', flexDirection: 'column', gap: 10,
            alignItems: 'flex-start', minWidth: 0,
          }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(255,255,255,0.20)' }} />
          </span>
          <span style={{ fontSize: 12, color: T.t3, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>{tx('dashboard.appGallery.awaiting')}</span>
        </div>
      ))}
    </div>
  </GlassCard>
  );
};

function OmniGridTop({ hiddenWidgets, isDesktop }: Readonly<{ hiddenWidgets: readonly string[], isDesktop: boolean }>) {
  // Side columns use minmax(0, …) so they shrink before the center widget on
  // narrow desktops (the old fixed `220px` columns squeezed the center canvas).
  const gridCols = isDesktop ? "minmax(0, 220px) minmax(0, 1fr) minmax(0, 220px)" : "1fr";
  const gridHeight = isDesktop ? 300 : undefined;
  return (
    <div className="omni-grid-top" style={{ display:"grid", gridTemplateColumns: gridCols, gap:14, height: gridHeight, minHeight:0, overflow: isDesktop ? "visible" : "hidden" }}>
      {!hiddenWidgets.includes('widget_agent') && <DraggableWidget id="widget_agent" style={{ height: isDesktop ? "100%" : 280, overflow:"hidden", position: isDesktop ? undefined : "relative", transform: isDesktop ? undefined : "none" }}><AgentWidget /></DraggableWidget>}
      {!hiddenWidgets.includes('widget_slate') && <DraggableWidget id="widget_slate" style={{ height: isDesktop ? "100%" : 320, overflow:"hidden", position: isDesktop ? undefined : "relative", transform: isDesktop ? undefined : "none", zIndex: 1 }}><OmniSlateWidget /></DraggableWidget>}
      {!hiddenWidgets.includes('widget_eco') && <DraggableWidget id="widget_eco" style={{ height: isDesktop ? "100%" : 200, overflow:"hidden", position: isDesktop ? undefined : "relative", transform: isDesktop ? undefined : "none" }}><EcosystemWidget /></DraggableWidget>}
    </div>
  );
}

// ─── Main OmniDash Shell ──────────────────────────────────────────────────────
export default function OmniDashShell() {
  const { tx } = useAppTranslation();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const { activeNav, setActiveNav, isDark, setIsDark, panelLayout, setPanelLayout, hiddenWidgets, toggleWidget, resetWidgetPositions } = useLayoutPersistence(userId);
  const { invoke } = useOmniModal();
  const { isDesktop } = useViewport();
  // Mobile/tablet surface state — drawerView is the open sheet (if any);
  // canvasFocus is which part of the always-mounted canvas is current when no
  // sheet is open. mobileTab is fully derived so exactly one tab is ever active.
  const [drawerView, setDrawerView] = useState<'apps' | 'insights' | 'more' | null>(null);
  const [canvasFocus, setCanvasFocus] = useState<'home' | 'slate'>('home');
  const mobileTab: MobileTab = drawerView ?? canvasFocus;
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleMobileTabSelect = useCallback((tab: MobileTab) => {
    if (tab === 'home' || tab === 'slate') {
      useOmniModal.getState().close();
      setDrawerView(null);
      setCanvasFocus(tab);
      const targetId = tab === 'slate' ? 'widget_slate' : undefined;
      const target = targetId ? document.getElementById(targetId) : canvasRef.current;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setDrawerView(tab);
  }, []);

  const handleMobileModuleSelect = useCallback((widget: OmniDashSidebarWidget) => {
    setDrawerView(null);
    invokeSidebarModule(widget, setActiveNav);
  }, [setActiveNav]);
  const { demoMode } = useDemoMode();
  const isDemoMode = demoMode;

  const userInitials = useMemo(() => {
    const user = session?.user;
    if (!user) return '??';
    const name = (user.user_metadata?.full_name as string | undefined)
      ?? (user.user_metadata?.name as string | undefined);
    if (name) {
      const parts = name.trim().split(/\s+/);
      return (parts[0]?.[0] ?? '').toUpperCase() + (parts.at(-1)?.[0] ?? '').toUpperCase();
    }
    const email = user.email;
    if (email) {
      const local = email.split('@')[0] ?? '';
      return local.slice(0, 2).toUpperCase();
    }
    return '??';
  }, [session]);

  // Real data bridge — fetches settings, KPIs, incidents from Supabase
  const liveDashData = useDashboardData({ enabled: !isDemoMode });

  // Use static demo data if in demo mode to prevent showing empty unauthenticated states
  const dashData = isDemoMode ? {
    settings: { user_id: 'demo', demo_mode: true, anonymize_kpis: false, freeze_mode: false, updated_at: new Date().toISOString() },
    kpiSummary: { flowbills_demos: 0, flowbills_paid_accounts: 0, cash_days_to_cash: 0, ops_sev1_incidents: 0 },
    kpiHistory: [],
    openIncidents: [
      { id: 'inc-1', severity: 'sev2' as const, status: 'open' as const, title: 'Invoice batch #1042 processing delay', occurred_at: new Date().toISOString() },
      { id: 'inc-2', severity: 'sev3' as const, status: 'open' as const, title: 'High memory usage in worker-pool-b', occurred_at: new Date().toISOString() }
    ],
    memoryHealth: null,
    systemHealth: 'degraded' as const,
    sliceStatuses: {},
    isLoading: false,
    error: null,
    refresh: () => {}
  } : liveDashData;

  // Sidebar active state is driven purely by handleNav / modal onCancel —
  // no longer derived from location.pathname (modules render as modals, not routes).


  // Close drawer when viewport expands to desktop
  useEffect(() => {
    if (isDesktop) setTimeout(() => setDrawerView(null), 0);
  }, [isDesktop]);

  // Responsive grid columns


  const layoutContextValue = useMemo(() => ({
    hiddenWidgets, panelLayout, toggleWidget, setPanelLayout, resetWidgetPositions, userId
  }), [hiddenWidgets, panelLayout, toggleWidget, setPanelLayout, resetWidgetPositions, userId]);

  return (
    <LayoutContext.Provider value={layoutContextValue}>
    <div style={{
      fontFamily:"'Space Grotesk',sans-serif",
      background: T.bg, color: T.t1,
      width:"100%", height:"100dvh",
      display:"flex", flexDirection:"column",
      overflow:"hidden",
    }}>
      <OmniDashHeader
        isDark={isDark}
        setIsDark={setIsDark}
        invoke={invoke}
        userInitials={userInitials}
        isDesktop={isDesktop}
      />

      <div className="omni-shell-main" style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Sidebar — standard layout: left; reversed layout: right */}
        {isDesktop && panelLayout === 'standard' && <OmniDashSidebar activeNav={activeNav} setActiveNav={setActiveNav} kpi={dashData.kpiSummary} systemHealth={dashData.systemHealth} demoMode={isDemoMode} />}
        {isDesktop && panelLayout === 'reversed' && (
          <div
            data-testid="rt_security"
            className="omni-right-panel"
            style={{
              flexShrink: 0,
              background: `linear-gradient(180deg,${T.surface} 0%,${T.bg} 100%)`,
              borderRight: `1px solid ${T.border}`,
              overflowY: 'auto', padding: '14px var(--omni-rail-pad-x, 12px)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >

            <div data-testid="rt_trace"><OmniTraceFeed /></div>
            <OmniSentryWidget />
            <SentinelPanel />
            <OmniMediaLaunchWidget />
            {/* System Health surface — real metric tiles. Full-rail width, so it
                matches the sibling rail widgets above it (owner KPI/status parity). */}
            <SystemHealthRow demoMode={isDemoMode} kpi={dashData.kpiSummary} systemHealth={dashData.systemHealth} />
          </div>
        )}

        {/* Main Canvas */}
        <div ref={canvasRef} className="omni-canvas-container" style={{
          flex:1, display:"flex", flexDirection:"column",
          overflow:"auto", padding:"16px", gap:14,
          position:"relative",
          background: isDark
            ? `radial-gradient(ellipse at 30% 20%,rgba(249,115,22,0.03) 0%,transparent 60%),${T.bg}`
            : "radial-gradient(ellipse at 30% 20%,rgba(249,115,22,0.02) 0%,transparent 60%),#e8edf5",
        }}>
          {/* Blueprint grid background — bottom layer, theme-aware */}
          <div style={{
            position:"fixed", inset:0, zIndex:0, pointerEvents:"none",
            backgroundImage: isDark
              ? `linear-gradient(rgba(30,80,140,0.18) 1px, transparent 1px),
                 linear-gradient(90deg, rgba(30,80,140,0.18) 1px, transparent 1px),
                 linear-gradient(135deg, rgba(249,115,22,0.04) 0%, transparent 55%, rgba(30,80,140,0.10) 100%)`
              : `linear-gradient(rgba(30,80,180,0.10) 1px, transparent 1px),
                 linear-gradient(90deg, rgba(30,80,180,0.10) 1px, transparent 1px),
                 linear-gradient(135deg, rgba(249,115,22,0.03) 0%, transparent 55%, rgba(30,80,180,0.06) 100%)`,
            backgroundSize:"40px 40px, 40px 40px, 100% 100%",
          }} />
          {/* Content — OmniBoard canvas is always persistent. Modules open as modals via OmniSpatialHost. */}
          <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", gap:14, flex:1 }}>
            {/* Primary 3-column grid — above the fold per canonical layout */}
            <OmniGridTop hiddenWidgets={hiddenWidgets} isDesktop={isDesktop} />

            {/* App Gallery row — display-only, four horizontal Awaiting slots */}
            {!hiddenWidgets.includes('widget_apps') && <DraggableWidget id="widget_apps"><IntegratedAppsGalleryWidget /></DraggableWidget>}

            {/* APEX-OmniHub brand mark — sits in the content flow directly BELOW
                the App Gallery (owner P1). In-flow + non-interactive, so it never
                obstructs the gallery, rails, OmniSlate, footer, or drawers
                (registry Canonical Layout Law). Decorative (header carries the
                labelled product logo), so it is aria-hidden. */}
            <div
              data-testid="omnidash-canvas-logo"
              aria-hidden="true"
              style={{ display:"flex", justifyContent:"center", padding:"4px 0 10px", flexShrink:0 }}
            >
              <img
                src={IMG_APEX_WM}
                alt=""
                draggable={false}
                style={{ height:92, width:"auto", maxWidth:"55%", objectFit:"contain", opacity:0.16, pointerEvents:"none", userSelect:"none" }}
              />
            </div>

            {/* Observability is no longer rendered in the main canvas (owner P1
                contract). It is footer-only — see FooterObservabilityRow in the
                static footer bar below. System Health remains a real surface in
                the right rail (SystemHealthRow). */}
          </div>
        </div>

        {/* Right Panel — standard layout: right; reversed layout: left (rendered above) */}
        {isDesktop && panelLayout === 'standard' && (
          <div
            data-testid="rt_security"
            className="omni-right-panel"
            style={{
              flexShrink: 0,
              background: `linear-gradient(180deg,${T.surface} 0%,${T.bg} 100%)`,
              borderLeft: `1px solid ${T.border}`,
              overflowY: 'auto', padding: '14px var(--omni-rail-pad-x, 12px)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >

            <div data-testid="rt_trace"><OmniTraceFeed /></div>
            <OmniSentryWidget />
            <SentinelPanel />
            <OmniMediaLaunchWidget />
            {/* System Health surface — real metric tiles. Full-rail width, so it
                matches the sibling rail widgets above it (owner KPI/status parity). */}
            <SystemHealthRow demoMode={isDemoMode} kpi={dashData.kpiSummary} systemHealth={dashData.systemHealth} />
          </div>
        )}

        {/* Sidebar — reversed layout: right side */}
        {isDesktop && panelLayout === 'reversed' && <OmniDashSidebar activeNav={activeNav} setActiveNav={setActiveNav} kpi={dashData.kpiSummary} systemHealth={dashData.systemHealth} demoMode={isDemoMode} />}

        {/* Mobile/Tablet — drawer trigger button in header area */}
        {!isDesktop && (
          <button
            type="button"
            className="omni-mobile-drawer-btn"
            onClick={() => setDrawerView('insights')}
            aria-label={tx('dashboard.mobile.openInsights')}
            style={{
              position: "fixed",
              top: 10,
              right: 56,
              zIndex: 8000,
              display: "flex",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>
        )}
      </div>

      {/* Footer bar — hidden on mobile via CSS. Fixed-height static row; the
          observability/status strip is clipped to these bounds and is NOT a
          DraggableWidget, so it is permanently immovable on the footer. */}
      <div className="omni-footer-bar" style={{
        height:28, flexShrink:0, background:T.surface,
        borderTop:`1px solid ${T.border}`,
        display:"flex", alignItems:"center",
        padding:"0 20px", gap:8,
        fontSize:10.3, color:T.t3,
        overflow:"hidden",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
          <StatusDot color={T.green} pulse={false} />
          {tx('dashboard.footer.copyright')}
        </div>
        {/* Footer-only observability/status — fed by real shell state. */}
        <FooterObservabilityRow
          demoMode={isDemoMode}
          kpi={dashData.kpiSummary}
          systemHealth={dashData.systemHealth}
          openIncidentsCount={dashData.openIncidents?.length ?? 0}
          isLoading={dashData.isLoading}
          error={dashData.error}
        />
        <div className="footer-right" style={{display:"flex", gap:14, alignItems:"center", flexShrink:0}}>
          <span style={{display:"flex",alignItems:"center",gap:5}}><StatusDot color={T.blue} pulse={false} />{tx('dashboard.footer.guardianActive')}{demoMode ? ` ${tx('dashboard.footer.simulated')}` : ''}</span>
        </div>
      </div>

      {/* Mobile/Tablet — surface drawer: Insights rail, Apps picker, or More */}
      {!isDesktop && (
        <OmniMobileDrawer
          isOpen={drawerView !== null}
          onClose={() => setDrawerView(null)}
          title={
            drawerView === 'apps' ? tx('dashboard.mobile.apps')
              : drawerView === 'more' ? tx('dashboard.mobile.more')
              : tx('dashboard.mobile.insightsControls')
          }
        >
          {drawerView === 'apps' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 12px' }}>
              {OMNIDASH_SIDEBAR_WIDGETS.map((widget) => (
                <NavItem
                  key={widget.id}
                  n={widget}
                  isActive={activeNav === widget.label}
                  onClick={() => handleMobileModuleSelect(widget)}
                />
              ))}
            </div>
          )}
          {drawerView === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 12px' }}>
  
              <div data-testid="rt_trace"><OmniTraceFeed /></div>
              <OmniSentryWidget />
              <SentinelPanel />
              <OmniMediaLaunchWidget />
              {/* System Health surface retained on mobile/tablet via the Insights drawer. */}
              <SystemHealthRow demoMode={isDemoMode} kpi={dashData.kpiSummary} systemHealth={dashData.systemHealth} />
            </div>
          )}
          {drawerView === 'more' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 12px' }}>
              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.t1, fontSize: 13, cursor: 'pointer' }}
              >
                {isDark ? tx('dashboard.mobile.switchLight') : tx('dashboard.mobile.switchDark')}
              </button>
              <button
                type="button"
                onClick={() => { void supabase.auth.signOut().then(() => { globalThis.location.href = '/login'; }); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.t1, fontSize: 13, cursor: 'pointer' }}
              >
                {tx('dashboard.mobile.signOut')}
              </button>
            </div>
          )}
        </OmniMobileDrawer>
      )}

      {/* Mobile/Tablet bottom navigation — shared surface controller */}
      {!isDesktop && (
        <OmniMobileBottomNav activeTab={mobileTab} onSelect={handleMobileTabSelect} />
      )}

      {/* OmniSpatialHost — universal modal engine, portal-mounted */}
      <OmniSpatialHost />
      {/* GlobalMediaDock — persistent PiP media layer, portal-mounted */}
      <GlobalMediaDock />
    </div>
    </LayoutContext.Provider>
  );
}

