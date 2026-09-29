import type { ReactNode } from 'react';
import { cancelRemoveNode, confirmRemoveNode, usePlaylists } from '../playlists/playlist-store';
import { Button } from '../ui/Button';
import { cancelRemoval, confirmRemoval, useImports } from './import-store';

/** "Remove this?" with Cancel first. Undo can bring it back. */
function ConfirmRemove({
  title,
  children,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="remove-title"
      aria-describedby="remove-text"
      data-testid="remove-confirm"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="max-w-md space-y-4 rounded-lg border border-line bg-panel p-5 shadow-2xl">
        <h3 id="remove-title" className="text-lg font-semibold">
          {title}
        </h3>
        <div id="remove-text" className="space-y-2 text-sm text-muted">
          {children}
        </div>
        <div className="flex justify-end gap-2">
          <Button autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="danger" onClick={onConfirm}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "Remove these presentations?" */
export function RemoveConfirm({ undoKey }: { undoKey: string }) {
  const pending = useImports((s) => s.confirmRemove);
  if (!pending) return null;
  const count = pending.ids.length;
  const what = count === 1 ? `“${pending.names[0] ?? 'this presentation'}”` : `${count} presentations`;
  return (
    <ConfirmRemove title={`Remove ${what}?`} onCancel={cancelRemoval} onConfirm={() => void confirmRemoval()}>
      {count > 1 && pending.names.length > 0 && (
        <p className="line-clamp-3">
          {pending.names.slice(0, 8).join(', ')}
          {pending.names.length > 8 ? ', …' : ''}
        </p>
      )}
      {pending.live && (
        <p className="text-amber-200">
          {count === 1 ? 'It is' : 'One of them is'} on the screens now. The slide stays up until you change
          it.
        </p>
      )}
      <p>
        You can bring {count === 1 ? 'it' : 'them'} back with Undo ({undoKey}).
      </p>
    </ConfirmRemove>
  );
}

/** "Remove this playlist?" or "Remove this folder and the playlists in it?" */
export function RemovePlaylistConfirm({ undoKey }: { undoKey: string }) {
  const pending = usePlaylists((s) => s.confirmRemove);
  if (!pending) return null;
  return (
    <ConfirmRemove
      title={`Remove ${pending.folder ? 'folder' : 'playlist'} “${pending.name}”?`}
      onCancel={cancelRemoveNode}
      onConfirm={() => void confirmRemoveNode()}
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
    </ConfirmRemove>
  );
}
