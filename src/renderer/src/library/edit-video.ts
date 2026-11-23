import { create } from 'zustand';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { Film } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';

export interface EditVideoFile {
  id: string;
  name: string;
}
export const useEditVideo = create<{ file: EditVideoFile | null }>(() => ({ file: null }));
export const closeEditVideo = () => useEditVideo.setState({ file: null });

/** Menu availability follows the existing target's readiness; Main rechecks the file before opening or saving. */
export function editVideoItems(
  target: FileTarget,
  ready: (id: string) => boolean,
  open = (file: EditVideoFile) => useEditVideo.setState({ file }),
): MenuEntry[] {
  const id = target.mediaId;
  if (target.kind !== 'video' || !id || !ready(id)) return [];
  return [{ label: 'Edit Video…', icon: Film, onSelect: () => open({ id, name: target.name }) }];
}

export function addEditVideoToMenu(): () => void {
  // The existing target factories offer Trim only for a ready local video/sound.
  // Reuse that decision instead of loading or polling the entire Media list.
  return addFileMenuItems((target) => editVideoItems(target, () => target.trim !== undefined));
}
