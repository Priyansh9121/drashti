import './help.css';
import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { useMode } from '../operator/mode-store';
import { cx } from '../ui/cx';
import { Tooltip } from '../ui/Tooltip';
import { connectKeyHints, toggleHelp, useHelp } from './help-store';

/*
 * The status bar's Help switch (alpha.24, the owner's "non-congusted UI"; help-store.ts): where the bar's ? was, in Pro
 * and Simple Mode. On, every ? shows (Pro Mode's: Simple Mode has none) and the keys beside the buttons' words; off,
 * neither, so the window is calm. A toggle button (aria-pressed), named Help; its ? a picture of the word. It changes at
 * once, as everything that shows or hides help does: nothing moves.
 */

/**
 * The key held for a look at the keys, named as the computer names it (the owner's "shortcuts should be adaptable to
 * mac, mac intel, and windows"): Option ⌥ on a Mac, Apple silicon or Intel alike (both are darwin, as the app's
 * platform says everywhere), Alt on Windows; ⌥ as the keys sheet and the quick bar write Option (shared/keymap.ts).
 */
export function holdKey(platform: string): string {
  return platform === 'darwin' ? 'Option ⌥' : 'Alt';
}

/**
 * Its tooltip's words: its name (a narrow window shows its ? alone), what it shows, and the hold key; then to let go of
 * it before pressing a key, as a key pressed with it still held is another key (Alt+F2 does nothing).
 */
export function helpTip(platform: string, simple: boolean): string {
  const alt = holdKey(platform);
  return simple
    ? `Help: the keys on the buttons. Hold ${alt} to see them; let go of ${alt}, then press one.`
    : `Help: the ? beside each part and the keys on the buttons. Hold ${alt} to see the keys; let go of ${alt}, then press one.`;
}

/**
 * Below 1280 px wide (as the header's ? go, top-bar.ts) it is its round ? alone, 24 px square, the room the bar's ?
 * had: CI's 1024 × 645 status bar, with the captions' warning in it, had no room for the word (the page scrolled
 * sideways). Its word stays for screen readers, and its tooltip says it.
 */
const NARROW = 'max-[1280px]:w-6 max-[1280px]:justify-center max-[1280px]:px-0';

export function HelpSwitch({
  platform,
  ask = null,
}: {
  platform: string;
  /**
   * The status bar's own ? (useWhatIsThis's, null while Help is off), after the switch: gone below 1280 px, as the
   * header's are, so a narrow bar holds no more than it did with its ? alone.
   */
  ask?: ReactNode;
}) {
  const on = useHelp((s) => s.on);
  const simple = useMode((s) => s.mode === 'simple');
  // Before the window's first drawing: a key never shows and then goes as it opens.
  useLayoutEffect(() => connectKeyHints(window), []);
  return (
    <>
      <Tooltip content={helpTip(platform, simple)}>
        <button
          type="button"
          aria-pressed={on}
          data-testid="help-toggle"
          onClick={toggleHelp}
          // 24 px tall (WCAG 2.5.8); on, it stands out as a pressed secondary does, in the bar's own colours.
          className={cx(
            'inline-flex min-h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-1.5 font-medium text-muted hover:text-fg aria-pressed:border-field aria-pressed:bg-panel-2 aria-pressed:text-fg',
            NARROW,
          )}
        >
          <span
            aria-hidden="true"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] leading-none font-bold"
          >
            ?
          </span>
          <span className="max-[1280px]:sr-only">Help</span>
        </button>
      </Tooltip>
      {ask !== null && <span className="flex max-[1280px]:hidden">{ask}</span>}
    </>
  );
}
