import { shortcutText } from '../../../shared/keymap';
import { Button } from '../ui/Button';
import { undoRemoval, useUndo } from './undo';

/** After a removal (presentations, playlists or items): what went, and Undo. */
export function UndoBar({ platform }: { platform: string }) {
  const last = useUndo((s) => s.stack.at(-1));
  if (!last) return null;
  return (
    <div
      role="status"
      data-testid="undo-removal"
      className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs"
    >
      <span className="min-w-0 flex-1 truncate" title={last.text}>
        {last.text}
      </span>
      <Button className="px-2 py-0.5 text-xs" onClick={() => void undoRemoval()}>
        Undo <kbd className="ml-1 text-muted">{shortcutText('undo', platform)}</kbd>
      </Button>
    </div>
  );
}
