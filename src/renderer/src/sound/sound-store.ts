import { create } from 'zustand';
import type { SoundView } from '../../../shared/sound';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { pushRemoval } from '../library/undo';
import { useNotice } from '../operator/actions';
import type { MenuEntry } from '../ui/Menu';
import { evenWords, soundMenuEntries, trimmedWords } from './sound-words';

/*
 * Drashti's own sound with everything else, in the operator window (Session 55, Part 7; shared/sound.ts):
 *
 * - Audio's switch, Music steps aside (K): the music fades down under a video with sound, and back after it.
 * - A video's or sound's Even loudness (L), a tick in its right-click menu (the one menu: files/file-menu.ts): ticked,
 *   it plays at the even level, unticked as it is in its file. What was measured, and what that does, is said.
 * - Trim black and silence (M), in a video's menu: its start and end points set past the black and silence at its
 *   start and end, with Undo; the file is never cut, and Trim (start, end and markers)… changes the points.
 */

export const useSound = create<{ view: SoundView | null }>(() => ({ view: null }));

let connected = false;

/** Load Audio's switch and the files played as they are, follow their changes, and add the menus' items (once). */
export function connectSound(): void {
  if (connected) return;
  connected = true;
  void window.drashti.sound.view().then((view) => {
    useSound.setState({ view });
  });
  window.drashti.sound.onChanged((view) => {
    useSound.setState({ view });
  });
  // Simple Mode's menu has them too (Session 56: the owner's Trim, as in Pro Mode).
  addFileMenuItems(soundMenuItems, { simple: true });
}

/** Audio's Music steps aside switch (K). */
export async function setStepsAside(on: boolean): Promise<void> {
  const result = await window.drashti.sound.setStepsAside(on);
  if (result.ok) useSound.setState({ view: result.view });
  else useNotice.setState({ text: result.message });
}

/** Turn a file's Even loudness on or off, saying what it plays at now. */
export async function setEven(mediaId: string, name: string, on: boolean): Promise<void> {
  const result = await window.drashti.sound.setEven(mediaId, on);
  if (!result.ok) {
    useNotice.setState({ text: result.message });
    return;
  }
  const view = useSound.getState().view;
  if (view)
    useSound.setState({
      view: {
        ...view,
        evenOff: on ? view.evenOff.filter((id) => id !== mediaId) : [...new Set([...view.evenOff, mediaId])],
      },
    });
  useNotice.setState({ text: evenWords(name, result) });
}

/** Trim black and silence (M): a video's points past them, with Undo, saying where it now starts and ends. */
export async function trimEdges(mediaId: string, name: string): Promise<void> {
  useNotice.setState({ text: `Looking for black and silence at the start and end of “${name}”…` });
  const result = await window.drashti.sound.trimEdges(mediaId);
  if (!result.ok) {
    useNotice.setState({ text: result.message });
    return;
  }
  const { points, before } = result;
  if (!points) {
    useNotice.setState({ text: `“${name}” has no black and silence at its start or end to trim.` });
    return;
  }
  pushRemoval({
    text: `Trimmed “${name}” past its black and silence`,
    restore: async () => {
      const markers = await window.drashti.media.markers(mediaId);
      await window.drashti.media.setMarkers(mediaId, {
        ...markers,
        startMs: before.startMs,
        endMs: before.endMs,
      });
    },
  });
  useNotice.setState({ text: trimmedWords(name, points) });
}

/** The one menu's items for a video or a sound (sound-words.ts), with this window's ticks. */
export function soundMenuItems(target: FileTarget): MenuEntry[] {
  return soundMenuEntries(target, useSound.getState().view?.evenOff ?? [], {
    trim: (mediaId, name) => void trimEdges(mediaId, name),
    even: (mediaId, name, on) => void setEven(mediaId, name, on),
  });
}
