import { cancelRemoveNode, confirmRemoveNode, usePlaylists } from '../playlists/playlist-store';
import { ConfirmDialog } from '../ui/Dialog';
import { cancelRemoval, confirmRemoval, useImports } from './import-store';

/** "Remove these presentations?" Cancel has the focus; Undo can bring them back. */
export function RemoveConfirm({ undoKey }: { undoKey: string }) {
  const pending = useImports((s) => s.confirmRemove);
  if (!pending) return null;
  const count = pending.ids.length;
  const what = count === 1 ? `“${pending.names[0] ?? 'this presentation'}”` : `${count} presentations`;
  return (
    <ConfirmDialog
      title={`Remove ${what}?`}
      confirmLabel="Remove"
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

/** "Remove this playlist?" or "Remove this folder and the playlists in it?" */
export function RemovePlaylistConfirm({ undoKey }: { undoKey: string }) {
  const pending = usePlaylists((s) => s.confirmRemove);
  if (!pending) return null;
  return (
    <ConfirmDialog
      title={`Remove ${pending.folder ? 'folder' : 'playlist'} “${pending.name}”?`}
      confirmLabel="Remove"
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
        You can bring {pending.folder ? 'it all' : 'it'} back with Undo ({undoKey}).
      </p>
    </ConfirmDialog>
  );
}
