import type { FileTarget } from '../files/file-menu';
import type { MenuEntry } from '../ui/Menu';
import { ImageDown } from '../ui/icons';

/*
 * Save picture… (Session 55, Part 5), in the one right-click menu (Part 14's addFileMenuItems): any picture, or a
 * slide with a picture on it (a deck's slide, "<deck>_3"), saved full size where the operator chooses, as it shows
 * (turned, flipped and cropped). The main process asks where and writes it (PictureEditor.tsx adds the item).
 */

/** The menu's Save picture…: on a picture, and on a slide that has one (its first); `save` saves it. */
export function savePictureItems(
  target: FileTarget,
  save: (mediaId: string, name: string) => void,
): MenuEntry[] {
  const mediaId = target.mediaId;
  if (!mediaId || (target.kind !== 'picture' && target.kind !== 'slide')) return [];
  return [
    {
      label: 'Save picture…',
      icon: ImageDown,
      onSelect: () => {
        save(mediaId, target.name);
      },
    },
  ];
}
