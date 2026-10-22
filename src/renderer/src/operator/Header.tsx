import { useWhatIsThis } from '../help/WhatIsThis';
import type { ReactNode } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { openThemes } from '../themes/themes-store';
import { Band, HeaderStates } from '../ui/Decoration';
import { Button } from '../ui/Button';
import { WordMark } from '../ui/Mark';
import { Inbox, LayoutGrid, Monitor, Palette, Radio, Smartphone } from '../ui/icons';
import { NetworkBadge } from '../network/NetworkBadge';
import { openNetwork, useNetwork } from '../network/network-store';
import { openAnnouncements, useAnnouncements } from '../network/announcements-store';
import { OnAirBadges } from '../stream/OnAirBadges';
import { openStreamPanel } from '../stream/stream-store';
import { enterSimpleMode } from './mode-store';
import { Tooltip } from '../ui/Tooltip';
import { LiveStatus } from './StatusLine';
import { RoleChip } from '../roles/RolesDialogs';
import { ScreenSwitchButtons } from './ScreenSwitches';

/**
 * Announcements from phones: shown while the network is on, or while any is
 * waiting or on the screens, with how many are waiting.
 */
function AnnouncementsButton({ help }: { help: ReactNode }) {
  const networkOn = useNetwork((s) => s.status?.on ?? false);
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  const showing = useAnnouncements((s) => s.view?.showing.length ?? 0);
  if (!networkOn && waiting === 0 && showing === 0) return null;
  return (
    <span className="flex items-center gap-0.5">
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
      {help}
    </span>
  );
}

/**
 * Across the top: the name, what is on the screens, and the settings the operator opens; in the appearance's
 * header colour (Session 42), with its band under it.
 */
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
  // What is this? (Sessions 31–36) for Stream, Phones and Announcements: each ? beside its button, its words
  // under the header, in the window's flow.
  const stream = useWhatIsThis('stream', { compact: true });
  const phones = useWhatIsThis('phones', { compact: true });
  const announcements = useWhatIsThis('announcements', { compact: true });
  const cards = [stream.card, phones.card, announcements.card].filter(Boolean);
  return (
    <>
      <header
        className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-header px-4 text-on-header"
        data-header=""
        data-testid="app-header"
      >
        <h1 className="shrink-0 text-base font-bold tracking-wide">
          <WordMark />
        </h1>
        <HeaderStates>
          <OnAirBadges />
          {/* How many announcements wait is on the Announcements button beside it. */}
          <NetworkBadge waiting={false} />
          <div className="min-w-0 flex-1">
            <LiveStatus />
          </div>
        </HeaderStates>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" icon={Palette} onClick={() => openThemes()}>
            Themes
          </Button>
          <span className="flex items-center gap-0.5">
            <Tooltip content="The stream to YouTube, and recording" side="bottom">
              <Button variant="ghost" icon={Radio} onClick={openStreamPanel} data-testid="open-stream">
                Stream
              </Button>
            </Tooltip>
            {stream.button}
          </span>
          <span className="flex items-center gap-0.5">
            <Tooltip
              content="Phones and tablets on this Wi-Fi: a remote, a stage screen, announcements"
              side="bottom"
            >
              <Button variant="ghost" icon={Smartphone} onClick={openNetwork} data-testid="open-network">
                Phones
              </Button>
            </Tooltip>
            {phones.button}
          </span>
          <AnnouncementsButton help={announcements.button} />
          <Tooltip content="Screens and sound" kbd={shortcutText('openScreens', platform)} side="bottom">
            <Button variant="secondary" icon={Monitor} onClick={onOpenScreens}>
              Screens
            </Button>
          </Tooltip>
          {/* Audience and Stage (Session 50): this computer's screens of each kind, off and on. */}
          <ScreenSwitchButtons platform={platform} />
          <RoleChip />
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
      <Band />
      {cards.length > 0 && <div className="shrink-0 pt-2">{cards}</div>}
    </>
  );
}
