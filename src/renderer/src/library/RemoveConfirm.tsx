import { cancelRemoveNode, confirmRemoveNode, removingWhat, usePlaylists } from '../playlists/playlist-store';
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
