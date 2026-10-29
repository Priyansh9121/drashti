import {
  cancelRemoveItems,
  cancelRemoveNode,
  confirmRemoveItems,
  confirmRemoveNode,
  folderName,
  removingWhat,
  usePlaylists,
} from '../playlists/playlist-store';
import { ConfirmDialog } from '../ui/Dialog';
import { cancelRemoval, confirmRemoval, playlistCardsLine, useImports } from './import-store';

/**
 * "Delete these presentations?", saying what becomes of their playlists' cards (Session 51). Cancel has the focus;
 * Undo can bring them back. The library's trash, its Delete key and the middle's menu all ask this one question.
 */
export function RemoveConfirm({ undoKey }: { undoKey: string }) {
  const pending = useImports((s) => s.confirmRemove);
  if (!pending) return null;
  const count = pending.ids.length;
  const what = count === 1 ? `“${pending.names[0] ?? 'this presentation'}”` : `${count} presentations`;
  return (
    <ConfirmDialog
      title={`Delete ${what}?`}
      confirmLabel="Delete"
      onCancel={cancelRemoval}
      onConfirm={() => void confirmRemoval()}
      testId="remove-confirm"
    >
      {count > 1 && pending.names.length > 0 && (
        <p className="line-clamp-3">
          {pending.names.slice(0, 8).join(', ')}
          {pending.names.length > 8 ? ', …' : ''}
        </p>
      )}
      {/* Which playlists (Session 55, Part 14): Delete asks first only when it is in one, or up. */}
      {pending.playlists && pending.playlists.count > 0 && (
        <p data-testid="remove-in-playlists">
          {count === 1 ? 'It is in' : 'They are in'} {pending.playlists.names.map((n) => `“${n}”`).join(', ')}
          {pending.playlists.count > pending.playlists.names.length
            ? ` and ${String(pending.playlists.count - pending.playlists.names.length)} more`
            : ''}
          .
        </p>
      )}
      <p>{playlistCardsLine(count)}</p>
      {pending.live && (
        <p className="text-warning-fg">
          {count === 1 ? 'It is' : 'One of them is'} on the screens now. The slide stays up until you change
          it.
        </p>
      )}
      <p>
        You can bring {count === 1 ? 'it' : 'them'} back with Undo ({undoKey}).
      </p>
    </ConfirmDialog>
  );
}

/** "Delete this playlist?" or "Delete this folder and the playlists in it?" */
export function RemovePlaylistConfirm({ undoKey }: { undoKey: string }) {
  const pending = usePlaylists((s) => s.confirmRemove);
  if (!pending) return null;
  return (
    <ConfirmDialog
      title={`Delete ${removingWhat(pending)}?`}
      confirmLabel="Delete"
      onCancel={cancelRemoveNode}
      onConfirm={() => void confirmRemoveNode()}
      testId="remove-confirm"
    >
      {pending.folder && pending.inside > 0 && (
        <p>
          {pending.inside === 1
            ? 'The playlist in it goes too.'
            : `The ${pending.inside} playlists in it go too.`}
        </p>
      )}
      <p>The presentations and media stay in the library.</p>
      <p>
        You can bring {pending.folder || pending.ids.length > 1 ? 'it all' : 'it'} back with Undo ({undoKey}).
      </p>
    </ConfirmDialog>
  );
}

/**
 * Taking rows out of a playlist (Session 55, Part 14), asked first only when one is on the screens, or for a folder
 * playlist's folder (everything in it goes, with one Undo). The library keeps them.
 */
export function RemoveItemsConfirm({ undoKey }: { undoKey: string }) {
  const pending = usePlaylists((s) => s.confirmRemoveItems);
  if (!pending) return null;
  const count = pending.names.length;
  const what =
    pending.folder !== null
      ? `the folder “${folderName(pending.folder)}”`
      : count === 1
        ? `“${pending.names[0] ?? 'this item'}”`
        : `${String(count)} items`;
  return (
    <ConfirmDialog
      title={`Take ${what} out of “${pending.playlist}”?`}
      confirmLabel="Take out"
      onCancel={cancelRemoveItems}
      onConfirm={() => void confirmRemoveItems()}
      testId="remove-items-confirm"
    >
      {pending.folder !== null && (
        <p>
          {count === 1 ? 'The one item in it goes too' : `The ${String(count)} items in it go too`}, with its
          folders.
        </p>
      )}
      {pending.live !== null && (
        <p className="text-warning-fg" data-testid="remove-items-live">
          “{pending.live}” is on the screens now. It stays up until you change it.
        </p>
      )}
      <p>
        The library keeps {count === 1 ? 'it' : 'them'}. You can bring {count === 1 ? 'it' : 'them'} back with
        Undo ({undoKey}).
      </p>
    </ConfirmDialog>
  );
}
