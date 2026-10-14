import { IconButton } from './Button';
import { cx } from './cx';
import { Trash2 } from './icons';

/*
 * The trash button on a row (Session 26a: "nothing has a visible delete"). It
 * runs exactly what the Delete key does on that row: the same command, the
 * same question, the same Undo. It shows on the chosen row (where it is a Tab
 * stop, so the keyboard reaches it) and on the row under the mouse, and it
 * always keeps its room, so a row never changes size as it is chosen or
 * hovered (a row that changes under the pointer cancels a drag: drag.ts).
 *
 * The row needs Tailwind's `group` class for the hover.
 */
export function RowDelete({
  label,
  chosen,
  onDelete,
  className,
}: {
  /** "Delete “Sunday Sabha”", or "Remove “…” from the playlist". */
  label: string;
  /** The row is the chosen one: shown, and in the Tab order. */
  chosen: boolean;
  onDelete: () => void;
  className?: string;
}) {
  return (
    // The place goes on a span of its own: IconButton's tooltip wraps the button in one that is in the flow.
    <span className={cx('flex shrink-0', className)}>
      <IconButton
        icon={Trash2}
        label={label}
        size="sm"
        data-testid="row-delete"
        className={cx(
          'text-muted hover:text-danger-fg focus-visible:visible',
          chosen ? 'visible' : 'invisible group-hover:visible',
        )}
        onClick={(e) => {
          // The row's own click (choose, open) must not run too.
          e.stopPropagation();
          onDelete();
        }}
      />
    </span>
  );
}
