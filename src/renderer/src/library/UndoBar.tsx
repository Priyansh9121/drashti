import { shortcutText } from '../../../shared/keymap';
import { useEngine } from '../engine/engine-store';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { Undo2 } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { lastRemoval, undoRemoval, useUndo } from './undo';

/**
 * After a removal or a change (presentations, playlists, words, a theme): what it was, and Undo.
 * A screen reader hears each step once from a line that is always there (a live region that
 * appears with its words is often not read), so the bar itself is not one.
 */
export function UndoBar({ platform }: { platform: string }) {
  const mode = useMode((s) => s.mode);
  const puttingBack = useEngine((s) => mode === 'simple' && s.state?.canPutBack === true);
  const last = useUndo((s) => lastRemoval(s.stack, mode));
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
      {last && !puttingBack && (
        <div
          data-testid="undo-removal"
          className="flex shrink-0 items-center gap-2 border-t border-line bg-panel-2 px-3 py-2 text-xs"
        >
          <Truncate text={last.text} className="flex-1 text-muted" />
          <Button
            size="sm"
            icon={Undo2}
            kbd={shortcutText('undo', platform)}
            onClick={() => void undoRemoval()}
          >
            Undo
          </Button>
        </div>
      )}
    </>
  );
}
