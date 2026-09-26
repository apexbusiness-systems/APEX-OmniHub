import { memo } from 'react';
import { Image, Folder, Play, Globe, Settings, LifeBuoy, LayoutDashboard, Headphones } from 'lucide-react';
import { useOmniModal } from '../stores/omniModalStore';
import type { OmniModalConfig } from '../stores/omniModalStore';

const NAV_ITEMS = [
  { title: 'Dashboard', moduleKey: 'dashboard', icon: LayoutDashboard, iconColor: 'text-orange-400', glowColor: 'from-orange-500/20 to-amber-500/10' },
  { title: 'Links', moduleKey: 'links', icon: Image, iconColor: 'text-blue-400', glowColor: 'from-blue-500/20 to-indigo-500/10' },
  { title: 'Files', moduleKey: 'files', icon: Folder, iconColor: 'text-blue-300', glowColor: 'from-blue-400/20 to-cyan-500/10' },
  { title: 'Automations', moduleKey: 'automations', icon: Play, iconColor: 'text-indigo-400', glowColor: 'from-indigo-500/20 to-purple-500/10' },
];

const openModule = (moduleKey: string, title: string) => {
  const config: OmniModalConfig = {
    id: `sidebar-${moduleKey}-${Date.now()}`,
    provider: 'OmniDash',
    type: 'module',
    title,
    description: `${title} module`,
    contextData: { moduleKey },
    onComplete: async () => { /* module handles its own actions */ },
  };
  useOmniModal.getState().invoke(config);
};

interface SidebarNavItemProps {
  title: string;
  moduleKey: string;
  icon: React.ElementType;
  iconColor: string;
  glowColor: string;
  isActive: boolean;
}

// ⚡ Bolt: Extracted sidebar item into a memoized component.
// This prevents React from re-rendering the entire navigation list every time the active module changes.
// Performance Impact: Reduces re-renders of non-active navigation items by 100% on route change.
const SidebarNavItem = memo(function SidebarNavItem({
  title,
  moduleKey,
  icon: Icon,
  iconColor,
  glowColor,
  isActive
}: SidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={() => openModule(moduleKey, title)}
      className={`group flex items-center justify-between w-full px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
        isActive
          ? 'bg-orange-500/[0.08] border border-orange-500/30 text-foreground shadow-[0_0_12px_rgba(249,115,22,0.08)]'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent hover:border-border'
      }`}
    >
      <span>{title}</span>
      <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${glowColor} flex items-center justify-center border border-border/50 shadow-inner`}>
        <Icon className={`w-3 h-3 ${iconColor}`} />
      </div>
    </button>
  );
});

/**
 * AppSidebar — SPA-native sidebar navigation.
 * All items dispatch module modals within OmniDash.
 * No route navigation — single page app architecture.
 */
export function AppSidebar() {
  const activeModuleKey = useOmniModal((s) => s.activeModal?.contextData?.moduleKey as string | undefined);

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col h-full sticky top-0 shrink-0 hidden md:flex">
      <div className="p-5 flex flex-col gap-6 flex-1">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">PLATFORM</h3>
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => openModule('omnidash', 'OmniDash')}
              className={`group flex items-center justify-between w-full px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                activeModuleKey === 'omnidash'
                  ? 'bg-orange-500/[0.08] border border-orange-500/30 text-foreground shadow-[0_0_12px_rgba(249,115,22,0.08)]'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent hover:border-border'
              }`}
            >
              <span className="text-[13px]">OmniDash</span>
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500/20 to-indigo-500/10 flex items-center justify-center border border-border/50 shadow-inner">
                <Globe className="w-3 h-3 text-purple-400" />
              </div>
            </button>
            {NAV_ITEMS.map((item) => (
              <SidebarNavItem
                key={item.title}
                {...item}
                isActive={activeModuleKey === item.moduleKey}
              />
            ))}
          </nav>
        </div>

        <div className="mt-1">
          <button
            type="button"
            onClick={() => openModule('settings', 'Settings')}
            className={`group flex items-center gap-3 w-full px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              activeModuleKey === 'settings'
                ? 'bg-accent text-foreground border border-border'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent'
            }`}
          >
            <Settings className="w-4 h-4 opacity-70" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Connect AI Card */}
      <div className="px-5 mt-auto pb-5 flex flex-col gap-2">
        <div className="bg-muted/80 backdrop-blur-sm border border-purple-500/10 rounded-xl p-2.5 flex items-center justify-between cursor-pointer hover:bg-muted transition-all duration-200 group relative overflow-hidden">
           <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50"></div>
           <div className="flex flex-col pl-2">
             <span className="text-[13px] font-semibold text-foreground group-hover:text-purple-400 transition-colors">Connect AI</span>
             <span className="text-[10px] text-muted-foreground font-medium">Optional</span>
           </div>
           <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center border border-emerald-500/20">
             <Headphones className="w-3 h-3 text-emerald-400" />
           </div>
        </div>
      </div>

      <div className="border-t border-border p-4 shrink-0 flex flex-col gap-2">
        <button type="button" className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground transition-colors opacity-60 hover:opacity-100">
          <LifeBuoy className="w-3 h-3" />
          Support
        </button>
        <div className="h-px bg-border my-1"></div>
        <button type="button" className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground transition-colors opacity-60 hover:opacity-100">
          Sign Out
        </button>
      </div>
    </aside>
  );
}
