import { memo } from 'react';
import { Download } from 'lucide-react';

export interface AppData {
  readonly name: string;
  readonly icon?: string;
  readonly alt?: string;
  readonly url?: string;
  readonly path?: string;
}

interface AppTileProps {
  readonly app: AppData;
  readonly isInstallable: boolean;
  readonly onInstall: () => void;
  readonly onNavigate: (path: string) => void;
  readonly onOpenUrl: (url: string) => void;
  readonly variant?: 'small' | 'large';
}

export const AppTile = memo(({
  app,
  isInstallable,
  onInstall,
  onNavigate,
  onOpenUrl,
  variant = 'small',
}: AppTileProps) => {
  const isSmall = variant === 'small';

  const baseClasses =
    'aspect-square rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 cursor-pointer w-full';
  const paddingClass = isSmall ? 'p-4' : 'p-6';

  let borderShadowClass = 'bg-white border-2 border-dashed border-muted-foreground/30';
  if (app.icon) {
    borderShadowClass = `bg-white border-2 border-[hsl(var(--navy))] shadow-lg ${
      isSmall ? '' : 'hover:shadow-xl'
    }`;
  }

  const containerClasses = [baseClasses, paddingClass, borderShadowClass].join(' ');

  const iconClasses = [
    'mb-2 object-cover rounded-lg',
    isSmall
      ? 'w-icon-sm h-icon-sm md:w-icon-md md:h-icon-md'
      : 'w-icon-lg h-icon-lg md:w-icon-xl md:h-icon-xl mb-3',
  ].join(' ');

  const textClasses = [
    'font-medium text-[hsl(var(--navy))]',
    isSmall ? 'text-xs md:text-sm' : 'text-sm md:text-base font-semibold',
  ].join(' ');

  const placeholderClasses = [
    'text-muted-foreground',
    isSmall ? 'text-xs md:text-sm' : 'text-sm md:text-base font-medium',
  ].join(' ');

  const handleClick = () => {
    if (app.name === 'APEX' && isInstallable) {
      onInstall();
    } else if (app.url) {
      onOpenUrl(app.url);
    } else if (app.path) {
      onNavigate(app.path);
    }
  };

  return (
    // Use a native <button> so the interactive role is semantically correct
    // (resolves SonarQube S1181: prefer <button> over role="button" on a div).
    <button
      type="button"
      className={`${containerClasses} appearance-none border-0 bg-transparent p-0 text-inherit`}
      onClick={handleClick}
    >
      {app.icon ? (
        <>
          <img
            src={`/assets/apps/${app.icon}.png`}
            alt={app.alt ?? app.name}
            className={iconClasses}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          {app.name === 'APEX' && isInstallable && (
            <Download className="w-4 h-4 text-muted-foreground mb-1" />
          )}
          <span className={textClasses}>{app.name}</span>
        </>
      ) : (
        <span className={placeholderClasses}>{app.name}</span>
      )}
    </button>
  );
});
