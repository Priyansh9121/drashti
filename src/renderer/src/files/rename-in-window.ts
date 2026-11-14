import type { RenameAnswer } from '../../../shared/rename-name';
import { pushRemoval } from '../library/undo';
import { useNotice } from '../operator/actions';
import { askRename } from './FileMenu';
import { renameWithUndo } from './rename-undo';

/**
 * Rename… in the operator window (a presentation; a picture, video or sound; a wallpaper): asked, kept by `keep`, with
 * Undo in the Undo bar, and why Drashti refused an Undo said in the window's notice (Session 58, X3: it went unsaid).
 * `what` names the thing in the question ("the presentation").
 */
export function askRenameWithUndo(
  what: string,
  name: string,
  keep: (name: string) => Promise<RenameAnswer>,
): void {
  askRename(what, name, (to) =>
    renameWithUndo(name, to, {
      keep,
      offerUndo: (text, restore) => {
        pushRemoval({ text, restore });
      },
      say: (text) => {
        useNotice.setState({ text });
      },
    }),
  );
}
