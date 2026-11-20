import { create } from 'zustand';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { Info } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';

/*
 * Media information… (alpha.20: the owner's Q60-34 item 1, his "Yes, all A" to Q60-39): one item in the one right-click
 * menu (files/file-menu.ts) for every video and sound wherever it shows (Media, a playlist's row, an audio playlist's
 * track), in Simple Mode's menu too. Its window is MediaInfoDialog.tsx.
 */

/** The file whose information is open, or none. */
export const useMediaInfo = create<{ media: { id: string; name: string } | null }>(() => ({ media: null }));

export function openMediaInfo(media: { id: string; name: string }): void {
  useMediaInfo.setState({ media });
}

export function closeMediaInfo(): void {
  useMediaInfo.setState({ media: null });
}

/** The menu's Media information…: on a video or a sound; none for anything else. */
export function mediaInfoItems(
  target: FileTarget,
  open: (media: { id: string; name: string }) => void = openMediaInfo,
): MenuEntry[] {
  const mediaId = target.mediaId;
  if (!mediaId || (target.kind !== 'video' && target.kind !== 'sound')) return [];
  return [
    {
      label: 'Media information…',
      icon: Info,
      onSelect: () => {
        open({ id: mediaId, name: target.name });
      },
    },
  ];
}

let added = false;

/**
 * Put Media information… in the one menu, once for the window, so it keeps one place in Pro Mode's and Simple Mode's
 * menus alike, whichever mode comes first.
 */
export function addMediaInfoToMenu(): void {
  if (added) return;
  added = true;
  addFileMenuItems((target) => mediaInfoItems(target), { simple: true });
}
