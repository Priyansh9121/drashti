import { useCallback, useState, useSyncExternalStore } from 'react';
import { shortcutText } from '../../../shared/keymap';
import { useEngine } from '../engine/engine-store';
import { useMode } from '../operator/mode-store';
import { useDragging } from '../playlists/drag';
import { Button } from '../ui/Button';
import { Undo2 } from '../ui/icons';
import { lastRemoval, lineRemoval, undoRemoval, useUndo } from './undo';
import { footKept, watchPointer } from './undo-room';

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
      <UndoLine text={last && !puttingBack ? last.text : null} timed={timed} platform={platform} />
    </>
  );
}

/** The left column the line is the foot of (operator/Layout.tsx, LeftColumn: Pro Mode's and Simple Mode's). */
const leftColumn = (): Element | null => document.querySelector('[data-left-column]');

/** The pointer coming into or leaving the left column, while the line shows (undo-room.ts). */
const watchLine = (changed: () => void) => watchPointer(leftColumn(), document, false, changed);
/** The same while its room is kept (undo-room.ts: the room's own watch). */
const watchRoom = (changed: () => void) => watchPointer(leftColumn(), document, true, changed);

/** Whether the pointer is over the left column, as the window's own :hover has it. */
const overLeftColumn = (): boolean => leftColumn()?.matches(':hover') ?? false;

/**
 * The line (`text`, the last change this mode can undo), while its minute is on (`timed`). With the
 * keyboard on its Undo when the minute is up, it stays until the keyboard leaves it (QA23-UNDOLINE-1):
 * taken away under it, the keyboard, and a screen reader with it, would drop back to the window's
 * start, and nothing here moves the focus. Only the keyboard's focus (:focus-visible, as ui/Tooltip.tsx)
 * holds it: a mouse click on Undo focuses the button too, and the line still goes on time then (the
 * review's F1).
 *
 * Its room (QA24-UNDOLINE-2): when the line goes (its minute up, or its own Undo taking back the last
 * change there is) with the pointer over the left column, or during one of Drashti's drags, its room
 * stays, empty, until the pointer is somewhere else. Everything in the column above it (the
 * wallpapers, the playlists) moved by the line's height when it went, unasked, so a click aimed at a
 * wallpaper or a playlist could land on another; now nothing there moves under the pointer. Its words
 * still go on time. With the pointer elsewhere it goes at once, as before, and the column moves away
 * from the pointer.
 */
function UndoLine({ text, timed, platform }: { text: string | null; timed: boolean; platform: string }) {
  const [focused, setFocused] = useState(false);
  // The line's height (its room), and whether the line is there or its room is kept.
  const [height, setHeight] = useState(0);
  const [kept, setKept] = useState(false);
  const dragging = useDragging((s) => s.on);
  const measure = useCallback((line: HTMLDivElement | null) => {
    if (!line) return;
    const sizes = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0]?.blockSize;
      if (box !== undefined) setHeight(box);
    });
    sizes.observe(line);
    return () => {
      sizes.disconnect();
    };
  }, []);
  // Gone with its change (the last one undone, or Simple Mode putting the show back): a keyboard's hold goes too.
  if (text === null && focused) setFocused(false);
  const shown = text !== null && (timed || focused);
  const over = useSyncExternalStore(kept && !shown ? watchRoom : watchLine, overLeftColumn);
  const keep = footKept({ shown, kept, overColumn: over, dragging });
  if (keep !== kept) setKept(keep);
  if (!shown)
    return keep ? (
      <div key="room" data-testid="undo-room" aria-hidden="true" className="shrink-0" style={{ height }} />
    ) : null;
  return (
    <div
      key="line"
      ref={measure}
      data-testid="undo-removal"
      // Its words whole, Undo under them in a narrow column (alpha.21: the owner's column at its least cut "Deleted
      // folder" short).
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-panel-2 px-3 py-2 text-xs"
      onFocus={(e) => {
        setFocused(e.target.matches(':focus-visible'));
      }}
      // Left for somewhere else in the window (Tab, a click), not the window put behind another app's: its
      // button keeps the keyboard then, so a keyboard's hold stays.
      onBlur={(e) => {
        const box = e.currentTarget;
        setTimeout(() => {
          setFocused((held) => held && box.contains(document.activeElement));
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
