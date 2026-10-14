import { IconButton } from './Button';
import { cx } from './cx';
import type { Icon } from './icons';
import { Pencil, Trash2 } from './icons';

/*
 * Buttons at the end of a row (Session 26a: "nothing has a visible delete").
 * They show on the chosen row (where they are Tab stops, so the keyboard
 * reaches them) and on the row under the mouse, and always keep their room,
 * so a row never changes size as it is chosen or hovered (a row that changes
 * under the pointer cancels a drag: drag.ts).
 *
 * The row needs Tailwind's `group` class for the hover.
 */
export function RowAction({
  icon,
  label,
  chosen,
  onPress,
  className,
  testId,
  danger = false,
}: {
  icon: Icon;
  label: string;
  /** The row is the chosen one: shown, and in the Tab order. */
  chosen: boolean;
  onPress: () => void;
  className?: string;
  testId: string;
  /** It deletes: red under the mouse. */
  danger?: boolean;
}) {
  return (
    // The place goes on a span of its own: IconButton's tooltip wraps the button in one that is in the flow.
    <span className={cx('flex shrink-0', className)}>
      <IconButton
        icon={icon}
        label={label}
        size="sm"
        data-testid={testId}
        className={cx(
          'text-muted focus-visible:visible',
          danger ? 'hover:text-danger-fg' : 'hover:text-fg',
          chosen ? 'visible' : 'invisible group-hover:visible',
        )}
        onClick={(e) => {
          // The row's own click (choose, open) must not run too.
          e.stopPropagation();
          onPress();
        }}
      />
    </span>
  );
}

/** The trash button: runs exactly what the Delete key does on that row (the same question, the same Undo). */
export function RowDelete({
  label,
  chosen,
  onDelete,
  className,
}: {
  /** "Delete “Sunday Sabha”", or "Remove “…” from the playlist". */
  label: string;
  chosen: boolean;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <RowAction
      icon={Trash2}
      label={label}
      chosen={chosen}
      onPress={onDelete}
      className={className}
      testId="row-delete"
      danger
    />
  );
}

/** Rename, beside Delete. */
export function RowRename({
  label,
  chosen,
  onRename,
  className,
}: {
  label: string;
  chosen: boolean;
  onRename: () => void;
  className?: string;
}) {
  return (
    <RowAction
      icon={Pencil}
      label={label}
      chosen={chosen}
      onPress={onRename}
      className={className}
      testId="row-rename"
    />
  );
}
