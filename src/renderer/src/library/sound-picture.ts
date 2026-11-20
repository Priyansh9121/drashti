import { create } from 'zustand';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { SlidersHorizontal } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';
import type { PlaybackSettings } from '../../../shared/playback-settings';

/*
 * Sound and picture… (alpha.20: the owner's Q60-34, his "Yes, all A" to Q60-39 P2 A and P6 (a) A): one item in the one
 * right-click menu (files/file-menu.ts) for every video and sound wherever it shows (Media, a playlist's row, an audio
 * playlist's track), in Pro Mode only (P6 (j) A keeps Simple Mode to Resume and Media information). Its window is
 * SoundPictureDialog.tsx: the file's own Bass, Treble, Voice boost, sound delay and caption delay.
 */

export interface SoundPictureFile {
  id: string;
  name: string;
  kind: 'video' | 'sound';
}

/** The file whose settings are open, or none. */
export const useSoundPicture = create<{ file: SoundPictureFile | null }>(() => ({ file: null }));

export function openSoundPicture(file: SoundPictureFile): void {
  useSoundPicture.setState({ file });
}

export function closeSoundPicture(): void {
  useSoundPicture.setState({ file: null });
}

/** The menu's Sound and picture…: on a video or a sound; none for anything else. */
export function soundPictureItems(
  target: FileTarget,
  open: (file: SoundPictureFile) => void = openSoundPicture,
): MenuEntry[] {
  const mediaId = target.mediaId;
  const kind = target.kind;
  if (!mediaId || (kind !== 'video' && kind !== 'sound')) return [];
  return [
    {
      label: 'Sound and picture…',
      icon: SlidersHorizontal,
      onSelect: () => {
        open({ id: mediaId, name: target.name, kind });
      },
    },
  ];
}

let added = false;

/** Put Sound and picture… in the one menu once for the window (Pro Mode's menu only). */
export function addSoundPictureToMenu(): void {
  if (added) return;
  added = true;
  addFileMenuItems((target) => soundPictureItems(target));
}

/** How long after the last change a file's settings are kept (a slider dragged sends one keep, not a hundred). */
export const KEEP_AFTER_MS = 150;

/**
 * Keeps a file's settings a moment after the last change (`send`: Main's media:set-playback); what Main says goes to
 * `said` (null: kept). Closed with the window.
 */
export function playbackKeeper(
  id: string,
  send: (mediaId: string, next: PlaybackSettings) => Promise<{ ok: true } | { ok: false; message: string }>,
  said: (problem: string | null) => void,
) {
  let waiting: { timer: ReturnType<typeof setTimeout>; next: PlaybackSettings } | null = null;
  const sendNow = (next: PlaybackSettings) => {
    void send(id, next).then(
      (r) => {
        said(r.ok ? null : r.message);
      },
      () => undefined,
    );
  };
  return {
    keep(next: PlaybackSettings): void {
      if (waiting) clearTimeout(waiting.timer);
      waiting = {
        next,
        timer: setTimeout(() => {
          waiting = null;
          sendNow(next);
        }, KEEP_AFTER_MS),
      };
    },
    /** The window closing. Red (x47, slice 6a, x55's find): a change still waiting is dropped. */
    close(): void {
      if (waiting) clearTimeout(waiting.timer);
      waiting = null;
    },
  };
}
