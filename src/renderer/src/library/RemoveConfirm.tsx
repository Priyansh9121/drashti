import { Button } from '../ui/Button';
import { cancelRemoval, confirmRemoval, useImports } from './import-store';

/** "Remove these presentations?" Undo can bring them back. */
export function RemoveConfirm({ undoKey }: { undoKey: string }) {
  const pending = useImports((s) => s.confirmRemove);
  if (!pending) return null;
  const count = pending.ids.length;
  const what = count === 1 ? `“${pending.names[0] ?? 'this presentation'}”` : `${count} presentations`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="remove-title"
      aria-describedby="remove-text"
      data-testid="remove-confirm"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancelRemoval();
      }}
    >
      <div className="max-w-md space-y-4 rounded-lg border border-line bg-panel p-5 shadow-2xl">
        <h3 id="remove-title" className="text-lg font-semibold">
          Remove {what}?
        </h3>
        <div id="remove-text" className="space-y-2 text-sm text-muted">
          {count > 1 && pending.names.length > 0 && (
            <p className="line-clamp-3">
              {pending.names.slice(0, 8).join(', ')}
              {pending.names.length > 8 ? ', …' : ''}
            </p>
          )}
          {pending.live && (
            <p className="text-amber-200">
              {count === 1 ? 'It is' : 'One of them is'} on the screens now. The slide stays up until you
              change it.
            </p>
          )}
          <p>
            You can bring {count === 1 ? 'it' : 'them'} back with Undo ({undoKey}).
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button autoFocus onClick={cancelRemoval}>
            Cancel
          </Button>
          <Button tone="danger" onClick={() => void confirmRemoval()}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
