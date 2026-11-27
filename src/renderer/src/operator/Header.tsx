import { useWhatIsThis } from '../help/WhatIsThis';
import type { ReactNode } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { LookMotion } from '../appearance/LookMotion';
import { Band, HeaderStates } from '../ui/Decoration';
import { Button } from '../ui/Button';
import { WordMark } from '../ui/Mark';
import { Inbox, LayoutGrid, ListChecks, Monitor, Radio, Smartphone } from '../ui/icons';
import { NetworkBadge } from '../network/NetworkBadge';
import { OscBadge } from '../osc/OscControl';
import { openNetwork, useNetwork } from '../network/network-store';
import { openAnnouncements, useAnnouncements } from '../network/announcements-store';
import { OnAirBadges } from '../stream/OnAirBadges';
import { openStreamPanel } from '../stream/stream-store';
import { enterSimpleMode } from './mode-store';
import { useDoubleClickSwitch } from './mode-switch';
import { openReady } from './ready-store';
import { Tooltip } from '../ui/Tooltip';
import { cx } from '../ui/cx';
import { LiveStatus } from './StatusLine';
import { ScreenSwitchButtons } from './ScreenSwitches';
import { COUNT_IF_NARROW, HIDDEN_IF_NARROWER, iconClass, type IconAloneButton, wordsClass } from './top-bar';

/** Whether the Announcements button shows: while the network is on, or while any is waiting or on the screens. */
function useAnnouncementsShown(): boolean {
  const networkOn = useNetwork((s) => s.status?.on ?? false);
  const waiting = useAnnouncements((s) => s.view?.waiting.length ?? 0);
  const showing = useAnnouncements((s) => s.view?.showing.length ?? 0);
  return networkOn || waiting > 0 || showing > 0;
}

/** A button's words: for screen readers only below the width where the top bar has room for them (top-bar.ts). */
function Words({
  button,
  crowded,
  children,
}: {
  button: IconAloneButton;
  crowded: boolean;
  children: string;
}) {
  return <span className={wordsClass(button, crowded)}>{children}</span>;
}

/** A hairline between the top bar group's parts (alpha.24, uitop): decoration only. */
function Divider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-header-field/40" />;
}

/**
 * A ? beside a button, in a room of its own, 20 px square, kept while Help is off (alpha.24, qtargets): Help turned on
 * draws the ? in it (a 24 px target, WhatIsThis.tsx) and moves nothing in the top bar, as the show controls' keys keep
 * theirs (help.css); the bar's widths count it either way (top-bar.ts). Gone below 1280 px while the top bar is
 * crowded, as each panel has its own (top-bar.ts).
 */
function Help({ crowded, children }: { crowded: boolean; children: ReactNode }) {
  return (
    <span
      data-help-room=""
      className={cx('flex h-5 w-5 shrink-0 items-center justify-center', crowded && HIDDEN_IF_NARROWER)}
    >
      {children}
    </span>
  );
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
          className={waiting > 0 ? COUNT_IF_NARROW : iconClass('announcements', crowded)}
        >
          {waiting > 0 ? (
            // How many wait stays in sight beside the icon, one line of words with it ("Announcements (2)").
            <span>
              <span className={wordsClass('announcements', crowded)}>Announcements </span>
              {`(${String(waiting)})`}
            </span>
          ) : (
            <Words button="announcements" crowded={crowded}>
              Announcements
            </Words>
          )}
        </Button>
      </Tooltip>
      <Help crowded={crowded}>{help}</Help>
    </span>
  );
}

/**
 * Across the top: the name, what is on the screens, and the settings the operator opens; in the appearance's
 * header colour (Session 42), with its band under it. Since alpha.24 (uitop, the owner's "too congested") the
 * settings are one quiet group: a hairline round them and between their parts, every button without a box of its own
 * (Audience and Stage a dot and their word), each showing its icon alone only where the bar has no room for its words
 * (top-bar.ts). Same buttons, same order, same names.
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
  // Phones on (Session 51, S2-3): the network's badge and Announcements too, so the others give up their words at
  // wider windows than with Phones off (top-bar.ts).
  const crowded = useAnnouncementsShown();
  // To Simple Mode: a double-click (or Enter twice), nothing else (the owner, 11 Nov 2026); one click says so.
  const toSimple = useDoubleClickSwitch('Simple Mode', () => void enterSimpleMode());
  return (
    <>
      <header
        className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-header px-4 text-on-header"
        data-header=""
        data-testid="app-header"
      >
        <LookMotion where="header" />
        <h1 className="shrink-0 text-base font-bold tracking-wide">
          <WordMark />
        </h1>
        <HeaderStates>
          <OnAirBadges />
          {/* How many announcements wait is on the Announcements button beside it. Crowded and below 1280 px,
              how many devices alone (top-bar.ts). */}
          <NetworkBadge waiting={false} compact={crowded} />
          <OscBadge />
          {/* Its end is cut, if it must be, rather than drawn over the buttons beside it. */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <LiveStatus />
          </div>
        </HeaderStates>
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-lg border border-header-field/40 p-0.5"
          data-top-group=""
          data-crowded={crowded ? 'true' : undefined}
        >
          <span className="flex items-center gap-0.5">
            {/* Its tooltip names it, as it may show its icon alone (top-bar.ts). */}
            <Tooltip content="Stream: to YouTube, and recording" side="bottom">
              <Button
                variant="ghost"
                icon={Radio}
                onClick={openStreamPanel}
                data-testid="open-stream"
                className={iconClass('stream', crowded)}
              >
                <Words button="stream" crowded={crowded}>
                  Stream
                </Words>
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
                className={iconClass('phones', crowded)}
              >
                <Words button="phones" crowded={crowded}>
                  Phones
                </Words>
              </Button>
            </Tooltip>
            <Help crowded={crowded}>{phones.button}</Help>
          </span>
          <AnnouncementsButton help={announcements.button} crowded={crowded} />
          <Divider />
          {/* Ready? (Session 55, Part 8): one press before the sabha checks the screens, sound, files and power. */}
          <Tooltip
            content="Ready?: before the sabha, check the screens, sound, files, access and power"
            side="bottom"
          >
            <Button
              variant="ghost"
              icon={ListChecks}
              onClick={openReady}
              data-testid="open-ready"
              className={iconClass('ready', crowded)}
            >
              <Words button="ready" crowded={crowded}>
                Ready?
              </Words>
            </Button>
          </Tooltip>
          <Divider />
          {/* Screens and the switches always keep their words (top-bar.ts); since alpha.24 a ghost too, no box. */}
          <Tooltip content="Screens and sound" kbd={shortcutText('openScreens', platform)} side="bottom">
            <Button variant="ghost" icon={Monitor} onClick={onOpenScreens}>
              Screens
            </Button>
          </Tooltip>
          {/* Audience and Stage (Session 50): this computer's screens of each kind, off and on. */}
          <ScreenSwitchButtons platform={platform} />
          <Divider />
          {/* Its tooltip names it, as it may show its icon alone (top-bar.ts). */}
          <Tooltip
            content="Simple Mode: double-click (or press Enter twice) for this window with only what a sabha with one projector needs, for volunteers."
            side="bottom"
          >
            <Button
              variant="ghost"
              icon={LayoutGrid}
              onClick={toSimple.onClick}
              onDoubleClick={toSimple.onDoubleClick}
              className={iconClass('simple', crowded)}
            >
              <Words button="simple" crowded={crowded}>
                Simple Mode
              </Words>
            </Button>
          </Tooltip>
          {extra}
        </div>
      </header>
      <Band />
      <LookMotion where="band" />
      {cards.length > 0 && <div className="shrink-0 pt-2">{cards}</div>}
    </>
  );
}
