import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { LucideIcon } from 'lucide-react';

interface OmniDashNavIconButtonProps {
  onClick: () => void;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  isActive?: boolean;
}

/**
 * OmniDashNavIconButton
 *
 * SPA-native: fires `onClick` to open a Sheet panel.
 * No routing. No URL changes. Accessible + keyboard-shortcut-aware.
 */
export const OmniDashNavIconButton = memo(({
  onClick,
  label,
  icon: Icon,
  shortcut,
  isActive = false,
}: OmniDashNavIconButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          data-testid={`omnidash-nav-${label.toLowerCase().replaceAll(/\s/g, '-')}`}
          aria-label={shortcut ? `${label} (Shortcut: ${shortcut})` : label}
          aria-pressed={isActive}
          className={`
            flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg
            text-sm font-medium transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
            ${isActive
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }
          `.trim().replaceAll(/\s+/g, ' ')}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
          <span className="text-xs font-medium hidden md:block">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{label}</p>
          {shortcut && (
            <p className="text-muted-foreground">
              Press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded">{shortcut}</kbd>
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});