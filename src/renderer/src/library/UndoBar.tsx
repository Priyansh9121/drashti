import { shortcutText } from '../../../shared/keymap';
import { Button } from '../ui/Button';
import { Undo2 } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { undoRemoval, useUndo } from './undo';

/**
 * After a removal or a change (presentations, playlists, words, a theme): what it was, and Undo.
 * A screen reader hears each step once from a line that is always there (a live region that
 * appears with its words is often not read), so the bar itself is not one.
 */
export function UndoBar({ platform }: { platform: string }) {
  const last = useUndo((s) => s.stack.at(-1));
  const said = useUndo((s) => s.said);
  return (
    <>
      <div role="status" className="sr-only" data-testid="undo-said">
        {/* A step said again ("Moved … up" twice) differs by a space, so it is read again. */}
        {said.text}
        {said.count % 2 === 1 ? ' ' : ''}
      </div>
      {last && (
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
