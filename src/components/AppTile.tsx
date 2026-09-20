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

export const AppTile = ({
    app,
    isInstallable,
    onInstall,
    onNavigate,
    onOpenUrl,
    variant = 'small'
}: AppTileProps) => {
    const isSmall = variant === 'small';

    const baseClasses = 'aspect-square rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 cursor-pointer w-full';
    const paddingClass = isSmall ? 'p-4' : 'p-6';

    let borderShadowClass = 'bg-white border-2 border-dashed border-muted-foreground/30';
    if (app.icon) {
        borderShadowClass = `bg-white border-2 border-[hsl(var(--navy))] shadow-lg ${isSmall ? '' : 'hover:shadow-xl'}`;
    }

    // ⚡ Bolt: Replaced array creation and `.join(' ')` with template literals to avoid unnecessary allocations on every render.
    const containerClasses = `${baseClasses} ${paddingClass} ${borderShadowClass}`;

    const iconClasses = `mb-2 object-cover rounded-lg ${isSmall ? 'w-icon-sm h-icon-sm md:w-icon-md md:h-icon-md' : 'w-icon-lg h-icon-lg md:w-icon-xl md:h-icon-xl mb-3'}`;

    const textClasses = `font-medium text-[hsl(var(--navy))] ${isSmall ? 'text-xs md:text-sm' : 'text-sm md:text-base font-semibold'}`;

    const placeholderClasses = `text-muted-foreground ${isSmall ? 'text-xs md:text-sm' : 'text-sm md:text-base font-medium'}`;

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
        <button
            type="button"
            aria-label={`${app.name} tile`}
            className={containerClasses}
            onClick={handleClick}
        >
            {app.icon ? (
                <>
                    <div className="relative">
                        <img
                            src={app.icon}
                            alt={app.alt}
                            className={iconClasses}
                        />
                        {app.name === 'APEX' && isInstallable && (
                            <div className={`absolute bg-[hsl(var(--navy))] text-white rounded-full shadow-lg animate-pulse ${isSmall ? '-top-1 -right-1 p-1' : '-top-2 -right-2 p-2'}`}>
                                <Download className={isSmall ? "w-3 h-3" : "w-4 h-4 md:w-5 md:h-5"} />
                            </div>
                        )}
                    </div>
                    <span className={textClasses}>
                        {app.name}
                    </span>
                </>
            ) : (
                <span className={placeholderClasses}>
                    {app.name}
                </span>
            )}
        </button>
    );
};
