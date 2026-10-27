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
import { cx } from '../ui/cx';
import { LiveStatus } from './StatusLine';
import { ScreenSwitchButtons } from './ScreenSwitches';
import { COUNT_IF_NARROW, HIDDEN_IF_NARROWER, ICON_IF_NARROW, WORDS_IF_NARROW } from './top-bar';

/** Whether the Announcements button shows: while the network is on, or while any is waiting or on the screens. */
function useAnnouncementsShown(): boolean {
  const networkOn = useNetwork((s) => s.status?.on ?? false);
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  const showing = useAnnouncements((s) => s.view?.showing.length ?? 0);
  return networkOn || waiting > 0 || showing > 0;
}

/** A button's words: for screen readers only while a crowded top bar shows its icon alone (top-bar.ts). */
function Words({ crowded, children }: { crowded: boolean; children: string }) {
  return <span className={crowded ? WORDS_IF_NARROW : undefined}>{children}</span>;
}

/** A ? beside a button: gone below 1280 px while the top bar is crowded, as each panel has its own (top-bar.ts). */
function Help({ crowded, children }: { crowded: boolean; children: ReactNode }) {
  return <span className={cx('flex', crowded && HIDDEN_IF_NARROWER)}>{children}</span>;
}

/**
 * Announcements from phones: shown while the network is on, or while any is
 * waiting or on the screens, with how many are waiting.
 */
function AnnouncementsButton({ help, crowded }: { help: ReactNode; crowded: boolean }) {
  const shown = useAnnouncementsShown();
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  if (!shown) return null;
  return (
    <span className="flex items-center gap-0.5">
      <Tooltip content="Announcements sent from phones, waiting for you to approve them" side="bottom">
        <Button
          variant={waiting > 0 ? 'warning' : 'ghost'}
          icon={Inbox}
          onClick={openAnnouncements}
          data-testid="open-announcements"
          className={cx(crowded && (waiting > 0 ? COUNT_IF_NARROW : ICON_IF_NARROW))}
        >
          {waiting > 0 ? (
            // How many wait stays in sight beside the icon, one line of words with it ("Announcements (2)").
            <span>
              <span className={crowded ? WORDS_IF_NARROW : undefined}>Announcements </span>
              {`(${String(waiting)})`}
            </span>
          ) : (
            <Words crowded={crowded}>Announcements</Words>
          )}
        </Button>
      </Tooltip>
      <Help crowded={crowded}>{help}</Help>
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
  // Phones on (Session 51, S2-3): below 1680 px wide, some buttons show their icon alone (top-bar.ts).
  const crowded = useAnnouncementsShown();
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
          {/* How many announcements wait is on the Announcements button beside it. Crowded and below 1280 px,
              how many devices alone (top-bar.ts). */}
          <NetworkBadge waiting={false} compact={crowded} />
          {/* Its end is cut, if it must be, rather than drawn over the buttons beside it. */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <LiveStatus />
          </div>
        </HeaderStates>
        <div className="flex shrink-0 items-center gap-2" data-crowded={crowded ? 'true' : undefined}>
          {/* Its icon alone says nothing: its tooltip names it (always there, so it stays put as that changes). */}
          <Tooltip content="Themes" side="bottom" describes={false}>
            <Button
              variant="ghost"
              icon={Palette}
              onClick={() => openThemes()}
              className={cx(crowded && ICON_IF_NARROW)}
            >
              <Words crowded={crowded}>Themes</Words>
            </Button>
          </Tooltip>
          <span className="flex items-center gap-0.5">
            <Tooltip content="The stream to YouTube, and recording" side="bottom">
              <Button
                variant="ghost"
                icon={Radio}
                onClick={openStreamPanel}
                data-testid="open-stream"
                className={cx(crowded && ICON_IF_NARROW)}
              >
                <Words crowded={crowded}>Stream</Words>
              </Button>
            </Tooltip>
            <Help crowded={crowded}>{stream.button}</Help>
          </span>
          <span className="flex items-center gap-0.5">
            <Tooltip
              content="Phones and tablets on this Wi-Fi: a remote, a stage screen, announcements"
              side="bottom"
            >
              <Button
                variant="ghost"
                icon={Smartphone}
                onClick={openNetwork}
                data-testid="open-network"
                className={cx(crowded && ICON_IF_NARROW)}
              >
                <Words crowded={crowded}>Phones</Words>
              </Button>
            </Tooltip>
            <Help crowded={crowded}>{phones.button}</Help>
          </span>
          <AnnouncementsButton help={announcements.button} crowded={crowded} />
          <Tooltip content="Screens and sound" kbd={shortcutText('openScreens', platform)} side="bottom">
            <Button variant="secondary" icon={Monitor} onClick={onOpenScreens}>
              Screens
            </Button>
          </Tooltip>
          {/* Audience and Stage (Session 50): this computer's screens of each kind, off and on. */}
          <ScreenSwitchButtons platform={platform} />
          <Tooltip
            content={
              crowded
                ? 'Simple Mode: one screen with big buttons, for volunteers. Nothing can be changed there.'
                : 'One screen with big buttons, for volunteers. Nothing can be changed there.'
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              icon={LayoutGrid}
              onClick={() => void enterSimpleMode()}
              className={cx(crowded && ICON_IF_NARROW)}
            >
              <Words crowded={crowded}>Simple Mode</Words>
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
