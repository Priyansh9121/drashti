import type { ReactNode } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { openThemes } from '../themes/themes-store';
import { Button } from '../ui/Button';
import { Inbox, LayoutGrid, Monitor, Palette, Radio, Smartphone } from '../ui/icons';
import { NetworkBadge } from '../network/NetworkBadge';
import { openNetwork, useNetwork } from '../network/network-store';
import { openAnnouncements, useAnnouncements } from '../network/announcements-store';
import { OnAirBadges } from '../stream/OnAirBadges';
import { openStreamPanel } from '../stream/stream-store';
import { enterSimpleMode } from './mode-store';
import { Tooltip } from '../ui/Tooltip';
import { LiveStatus } from './StatusLine';

/**
 * Announcements from phones: shown while the network is on, or while any is
 * waiting or on the screens, with how many are waiting.
 */
function AnnouncementsButton() {
  const networkOn = useNetwork((s) => s.status?.on ?? false);
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  const showing = useAnnouncements((s) => s.view?.showing.length ?? 0);
  if (!networkOn && waiting === 0 && showing === 0) return null;
  return (
    <Tooltip content="Announcements sent from phones, waiting for you to approve them" side="bottom">
      <Button
        variant={waiting > 0 ? 'warning' : 'ghost'}
        icon={Inbox}
        onClick={openAnnouncements}
        data-testid="open-announcements"
      >
        {waiting > 0 ? `Announcements (${waiting})` : 'Announcements'}
      </Button>
    </Tooltip>
  );
}

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
      <OnAirBadges />
      <NetworkBadge />
      <div className="min-w-0 flex-1">
        <LiveStatus />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" icon={Palette} onClick={() => openThemes()}>
          Themes
        </Button>
        <Tooltip content="The stream to YouTube, and recording" side="bottom">
          <Button variant="ghost" icon={Radio} onClick={openStreamPanel} data-testid="open-stream">
            Stream
          </Button>
        </Tooltip>
        <Tooltip
          content="Phones and tablets on this Wi-Fi: a remote, a stage screen, announcements"
          side="bottom"
        >
          <Button variant="ghost" icon={Smartphone} onClick={openNetwork} data-testid="open-network">
            Phones
          </Button>
        </Tooltip>
        <AnnouncementsButton />
        <Tooltip content="Screens and sound" kbd={shortcutText('openScreens', platform)} side="bottom">
          <Button variant="secondary" icon={Monitor} onClick={onOpenScreens}>
            Screens
          </Button>
        </Tooltip>
        <Tooltip
          content="One screen with big buttons, for volunteers. Nothing can be changed there."
          side="bottom"
        >
          <Button variant="ghost" icon={LayoutGrid} onClick={() => void enterSimpleMode()}>
            Simple Mode
          </Button>
        </Tooltip>
        {extra}
      </div>
    </header>
  );
}
