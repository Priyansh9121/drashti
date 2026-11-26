import { IconButton } from './Button';
import { Trash2 } from './icons';

/**
 * A trash at the end of a row that is always shown (an audio playlist's Delete, a lower third's, a caption word's
 * Remove): it does what the row's Delete does, on a click or on Enter or Space.
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
      onClick={() => {
        onPress();
      }}
    />
  );
}
