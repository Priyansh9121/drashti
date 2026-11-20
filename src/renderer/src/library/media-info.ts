import type { FileTarget } from '../files/file-menu';
import type { MenuEntry } from '../ui/Menu';

/* Media information… in the one right-click menu (alpha.20, Q60-34 item 1). Red (x47): still to be written. */

export const mediaInfoItems = (
  _target: FileTarget,
  _open?: (media: { id: string; name: string }) => void,
): MenuEntry[] => [];
