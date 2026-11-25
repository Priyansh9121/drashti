import { useState } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { useEngine } from '../engine/engine-store';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { Undo2 } from '../ui/icons';
import { lastRemoval, lineRemoval, undoRemoval, useUndo } from './undo';

/**
 * After a removal or a change (presentations, playlists, words, a theme): what it was, and Undo.
 * A screen reader hears each step once from a line that is always there (a live region that
 * appears with its words is often not read), so the bar itself is not one. The bar goes by itself
 * a minute after the last change (QA23-UNDOLINE-1); Edit > Undo and its key still undo after that.
 */
export function UndoBar({ platform }: { platform: string }) {
  const mode = useMode((s) => s.mode);
  const puttingBack = useEngine((s) => mode === 'simple' && s.state?.canPutBack === true);
  const last = useUndo((s) => lastRemoval(s.stack, mode));
  const timed = useUndo((s) => lineRemoval(s, mode) !== undefined);
  const said = useUndo((s) => s.said);
  const spoken = mode === 'simple' && (said.mode !== 'simple' || puttingBack) ? '' : said.text;
  return (
    <>
      {/* Two lines in turn: each step is written into the one left empty, so a screen reader reads
          it even when it says the same as the last ("Moved … up" twice). */}
      <div className="sr-only" data-testid="undo-said">
        <div role="status">{said.count % 2 === 0 ? spoken : ''}</div>
        <div role="status">{said.count % 2 === 1 ? spoken : ''}</div>
      </div>
      {last && !puttingBack && <UndoLine text={last.text} timed={timed} platform={platform} />}
    </>
  );
}

/**
 * The line, while its minute is on (`timed`). With the keyboard on its Undo when the minute is up,
 * it stays until the keyboard leaves it (QA23-UNDOLINE-1): taken away under it, the keyboard, and a
 * screen reader with it, would drop back to the window's start, and nothing here moves the focus.
 */
function UndoLine({ text, timed, platform }: { text: string; timed: boolean; platform: string }) {
  const [focused, setFocused] = useState(false);
  if (!timed && !focused) return null;
  return (
    <div
      data-testid="undo-removal"
      // Its words whole, Undo under them in a narrow column (alpha.21: the owner's column at its least cut "Deleted
      // folder" short).
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-panel-2 px-3 py-2 text-xs"
      onFocus={() => {
        setFocused(true);
      }}
      // Left for somewhere else in the window (Tab, a click), not the window put behind another app's: its
      // button keeps the keyboard then, so the line stays.
      onBlur={(e) => {
        const box = e.currentTarget;
        setTimeout(() => {
          setFocused(box.contains(document.activeElement));
        }, 0);
      }}
    >
      <span className="min-w-0 flex-1 break-words text-muted">{text}</span>
      <Button
        className="ml-auto"
        size="sm"
        icon={Undo2}
        kbd={shortcutText('undo', platform)}
        onClick={() => void undoRemoval()}
      >
        Undo
      </Button>
    </div>
  );
}
