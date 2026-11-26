import { IconButton } from './Button';
import { Trash2 } from './icons';

/**
 * A trash at the end of a row that is always shown (an audio playlist's Delete, a lower third's, a caption word's
 * Remove): it does what the row's Delete does, on a click or on Enter or Space, once for a double click (as a row's
 * trash, RowDelete.tsx, and a track's, music/TrackDelete.tsx).
 */
export function TrashButton({
  label,
  testId,
  onPress,
}: {
  /** "Delete “Placeholder name”", or "Remove Placeholder": read out and shown as its tooltip. */
  label: string;
  testId?: string;
  onPress: () => void;
}) {
  return (
    <IconButton
      icon={Trash2}
      label={label}
      size="sm"
      data-testid={testId}
      onClick={(e) => {
        // A double click's second click (or a third) does nothing (QA24-ROWDEL-2): its first took the row out, and
        // the row under it, moved up under the pointer, would go too. Enter and Space have no count (0).
        if (e.detail > 1) return;
        onPress();
      }}
    />
  );
}
