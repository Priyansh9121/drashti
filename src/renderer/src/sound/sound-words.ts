import { markerTime } from '../../../shared/markers';
import { EVEN_LOUDNESS_LUFS, type FileSoundView } from '../../../shared/sound';
import type { FileTarget } from '../files/file-menu';
import type { MenuEntry } from '../ui/Menu';
import { Scissors } from '../ui/icons';

/*
 * The words and the menu items of Drashti's own sound (Session 55, Part 7), apart from the store that acts on them
 * (sound-store.ts), so they are tested on their own.
 */

/** A loudness said plainly: "−23.4 LUFS". */
const lufsWords = (lufs: number) => `${lufs < 0 ? '−' : ''}${Math.abs(lufs).toFixed(1)} LUFS`;

/** What a file's Even loudness does now, in a sentence (the notice after its tick is changed). */
export function evenWords(name: string, r: FileSoundView): string {
  if (!r.even) return `“${name}” plays as it is in its file, at its own loudness.`;
  if (!r.measured) return `“${name}” plays at the even loudness once Drashti has measured it, in a moment.`;
  if (r.lufs === null) return `“${name}” has no sound to even out.`;
  const by = Math.abs(r.gainDb);
  const change =
    by < 0.1
      ? 'already at the even level'
      : `played ${by.toFixed(1)} dB ${r.gainDb > 0 ? 'louder' : 'quieter'}`;
  return `“${name}” plays at the even loudness (${lufsWords(EVEN_LOUDNESS_LUFS)}): it measured ${lufsWords(r.lufs)}, so it is ${change}.`;
}

/** A point said as the Trim dialog says it ("1:05.5"), or the file's own start or end. */
const pointWords = (ms: number | null, end: boolean) =>
  ms === null || (!end && ms === 0) ? (end ? 'its end' : 'its start') : markerTime(ms);

/** Where a video plays now, past its black and silence (Trim black and silence's notice). */
export const trimmedWords = (name: string, points: { startMs: number; endMs: number | null }): string =>
  `“${name}” now plays from ${pointWords(points.startMs, false)} to ${pointWords(points.endMs, true)}, past the black and silence. Choose Undo to restore the old playback points.`;

/**
 * The one menu's items for a video or a sound (files/file-menu.ts: added after Trim): Trim black and silence for a
 * video, and Even loudness, ticked while it plays at the even level. Only where Trim is offered (a file there to play).
 */
export function soundMenuEntries(
  target: FileTarget,
  evenOff: readonly string[],
  act: {
    trim: (mediaId: string, name: string) => void;
    even: (mediaId: string, name: string, on: boolean) => void;
  },
): MenuEntry[] {
  const { mediaId } = target;
  if (!mediaId || !target.trim || (target.kind !== 'video' && target.kind !== 'sound')) return [];
  const off = evenOff.includes(mediaId);
  return [
    ...(target.kind === 'video'
      ? [
          {
            label: 'Trim black and silence',
            icon: Scissors,
            onSelect: () => {
              act.trim(mediaId, target.name);
            },
          },
        ]
      : []),
    {
      label: 'Even loudness',
      checked: !off,
      onSelect: () => {
        act.even(mediaId, target.name, off);
      },
    },
  ];
}
