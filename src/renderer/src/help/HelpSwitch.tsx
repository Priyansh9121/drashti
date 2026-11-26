import './help.css';
import { useLayoutEffect } from 'react';
import { useMode } from '../operator/mode-store';
import { Tooltip } from '../ui/Tooltip';
import { connectKeyHints, toggleHelp, useHelp } from './help-store';

/*
 * The status bar's Help switch (alpha.24, the owner's "non-congusted UI"; help-store.ts): where the bar's ? was, in Pro
 * and Simple Mode. On, every ? shows (Pro Mode's: Simple Mode has none) and the keys beside the buttons' words; off,
 * neither, so the window is calm. A toggle button (aria-pressed), named Help; its ? a picture of the word. It changes at
 * once, as everything that shows or hides help does: nothing moves.
 */

/** Its tooltip's words: what it shows, and Alt (Option on a Mac) for a look at the keys. */
export function helpTip(platform: string, simple: boolean): string {
  const alt = platform === 'darwin' ? 'Option' : 'Alt';
  return simple
    ? `Shows the keys on the buttons. Hold ${alt} to see them for a moment.`
    : `Shows the ? beside each part and the keys on the buttons. Hold ${alt} to see the keys for a moment.`;
}

export function HelpSwitch({ platform }: { platform: string }) {
  const on = useHelp((s) => s.on);
  const simple = useMode((s) => s.mode === 'simple');
  // Before the window's first drawing: a key never shows and then goes as it opens.
  useLayoutEffect(() => connectKeyHints(window), []);
  return (
    <Tooltip content={helpTip(platform, simple)}>
      <button
        type="button"
        aria-pressed={on}
        data-testid="help-toggle"
        onClick={toggleHelp}
        // 24 px tall (WCAG 2.5.8); on, it stands out as a pressed secondary does, in the bar's own colours.
        className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-1.5 font-medium text-muted hover:text-fg aria-pressed:border-field aria-pressed:bg-panel-2 aria-pressed:text-fg"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] leading-none font-bold"
        >
          ?
        </span>
        Help
      </button>
    </Tooltip>
  );
}
