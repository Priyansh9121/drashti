import { useState } from 'react';
import type { OperatorAction } from '../../../shared/keymap';
import { keyText, quickKey } from '../../../shared/keymap';
import type { QuickPin } from '../../../shared/quick-bar';
import { pinKey } from '../../../shared/quick-bar';
import { Kbd } from '../ui/Kbd';
import { isMenuKey, Menu, menuBelow, menuPlace, type MenuPlace } from '../ui/Menu';
import {
  ArrowLeft,
  ArrowRight,
  Film,
  Image,
  MessageSquare,
  Music,
  PinOff,
  Presentation,
  Video,
} from '../ui/icons';
import type { Icon } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { movePin, unpin, useQuickBar } from './quick-bar-store';

/*
 * The quick bar (Session 55, Part 8, F): up to 8 pinned items, one press each, just above the bar of clears, each with
 * its key (Alt+1 to Alt+8; ⌥1 to ⌥8 on a Mac). Hidden when empty. A pin's right-click (Shift+F10, the Menu key) takes it
 * off or moves it a place. Pro Mode's only. A press goes through the window's own `run`, so the practice show keeps it.
 */

function iconOf(pin: QuickPin): Icon {
  switch (pin.kind) {
    case 'slide':
      return Presentation;
    case 'message':
      return MessageSquare;
    case 'media':
      return pin.media === 'image' ? Image : pin.media === 'video' ? Film : Music;
    case 'item':
      return pin.what === 'picture'
        ? Image
        : pin.what === 'video'
          ? Film
          : pin.what === 'sound'
            ? Music
            : pin.what === 'input'
              ? Video
              : Presentation;
  }
}

export function QuickBar({
  platform,
  run,
}: {
  platform: string;
  run: (action: OperatorAction, slot?: number) => void;
}) {
  const pins = useQuickBar((s) => s.pins);
  const [menu, setMenu] = useState<{ at: MenuPlace; key: string } | null>(null);
  if (pins.length === 0) return null;
  // The pin its menu is for, found by what it is (the bar may change while the menu is open).
  const menuIndex = menu ? pins.findIndex((p) => pinKey(p) === menu.key) : -1;
  const menuPin = pins[menuIndex];
  return (
    <nav
      aria-label="Quick bar"
      data-testid="quick-bar"
      className="flex shrink-0 items-center gap-1 border-t border-line bg-panel px-3 py-1"
    >
      {pins.map((pin, i) => {
        const IconShape = iconOf(pin);
        const key = keyText(quickKey(i), platform);
        return (
          <button
            key={pinKey(pin)}
            type="button"
            data-show-control
            data-testid="quick-pin"
            data-quick-kind={pin.kind}
            title={`${pin.label} (${key})`}
            aria-label={`${pin.label}, ${key}`}
            aria-keyshortcuts={`Alt+${String(i + 1)}`}
            onClick={() => {
              run('quickBar', i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ at: menuPlace(e), key: pinKey(pin) });
            }}
            onKeyDown={(e) => {
              if (!isMenuKey(e)) return;
              e.preventDefault();
              setMenu({ at: menuBelow(e.currentTarget), key: pinKey(pin) });
            }}
            className="inline-flex h-7 min-w-0 shrink basis-44 items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2 text-sm font-medium text-fg hover:bg-panel-3"
          >
            <Kbd className="shrink-0">
              <span data-testid="quick-key">{key}</span>
            </Kbd>
            <IconShape size={14} aria-hidden="true" className="shrink-0" />
            <Truncate text={pin.label} />
          </button>
        );
      })}
      {menu && menuPin && (
        <Menu
          at={menu.at}
          label={`“${menuPin.label}” on the quick bar`}
          onClose={() => {
            setMenu(null);
          }}
          entries={[
            {
              label: 'Move left',
              icon: ArrowLeft,
              disabled: menuIndex === 0,
              onSelect: () => void movePin(menu.key, -1),
            },
            {
              label: 'Move right',
              icon: ArrowRight,
              disabled: menuIndex === pins.length - 1,
              onSelect: () => void movePin(menu.key, 1),
            },
            {
              label: 'Unpin from the quick bar',
              icon: PinOff,
              separatorBefore: true,
              onSelect: () => void unpin(menu.key),
            },
          ]}
        />
      )}
    </nav>
  );
}
