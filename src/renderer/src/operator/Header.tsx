import type { ReactNode } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { openThemes } from '../themes/themes-store';
import { Button } from '../ui/Button';
import { Monitor, Palette } from '../ui/icons';
import { Tooltip } from '../ui/Tooltip';
import { LiveStatus } from './StatusLine';

/** Across the top: the name, what is on the screens, and the settings the operator opens. */
export function Header({
  platform,
  onOpenScreens,
  extra,
}: {
  platform: string;
  onOpenScreens: () => void;
  /** More on the right (the Simple Mode switch). */
  extra?: ReactNode;
}) {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4"
      data-testid="app-header"
    >
      <h1 className="shrink-0 text-base font-bold tracking-wide">Drashti</h1>
      <div className="min-w-0 flex-1">
        <LiveStatus />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" icon={Palette} onClick={() => openThemes()}>
          Themes
        </Button>
        <Tooltip content="Screens and sound" kbd={shortcutText('openScreens', platform)} side="bottom">
          <Button variant="secondary" icon={Monitor} onClick={onOpenScreens}>
            Screens
          </Button>
        </Tooltip>
        {extra}
      </div>
    </header>
  );
}
