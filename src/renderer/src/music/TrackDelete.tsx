import { IconButton } from '../ui/Button';
import { Trash2 } from '../ui/icons';

/**
 * A track's trash in an audio playlist, always shown at the end of its row: it takes the track out of this audio
 * playlist only, with Undo (the chosen ones with it when it is one of them), as Delete does.
 */
export function TrackDelete({ name, onTakeOut }: { name: string; onTakeOut: () => void }) {
  return (
    <IconButton
      icon={Trash2}
      label={`Remove “${name}” from the music`}
      size="sm"
      data-testid="music-track-delete"
      onClick={(e) => {
        // A double click's second click (or a third) does nothing (QA23-ROWDEL-1): its first took the track out, and
        // the track under it, moved up under the pointer, would go too. Enter and Space have no count (0).
        if (e.detail > 1) return;
        onTakeOut();
      }}
    />
  );
}
