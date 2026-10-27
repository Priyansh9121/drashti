import type { UpNext } from './engine/state';

/*
 * What Next will put up, in words: the operator window's caption under its picture of what comes next
 * (operator/NextPreview.tsx), and since Session 54 (D5 review) a phone's beside its own, from these same words: the
 * next slide by its playlist item's or presentation's name with its number (and "(next item)" when it starts the
 * next one), a deck's next click (C2), a video input, a missing file or a missing sound behind it (Sessions 51 to
 * 54); the next picture, video or sound item, or video input; or nothing after this.
 */

const KIND_WORD = { image: 'Picture', video: 'Video', audio: 'Audio' } as const;

export function nextCaption(
  next: UpNext | null,
  /**
   * `label`: the next slide's playlist item's name, else its presentation's (left out: "Presentation").
   * `inputHere`: whether this computer has the video input it names (left out: it is taken to have it).
   */
  names: { label?: string | null; inputHere?: boolean } = {},
): string {
  if (!next) return 'Nothing after this';
  if (next.kind === 'media') return `${KIND_WORD[next.media]}: ${next.label}`;
  if (next.kind === 'input') return `Video input: ${next.name}`;
  let caption = `${names.label ?? 'Presentation'}, slide ${String(next.slideIndex + 1)}${next.itemId ? ' (next item)' : ''}`;
  // A deck's next click on the slide up (Session 54, C2).
  if ((next.step ?? 0) > 0) caption += `, click ${String(next.step)}`;
  if (next.input !== undefined)
    caption +=
      names.inputHere === false
        ? `, over the video input “${next.input}”, which is not on this computer: the background stays as it is`
        : `, over the video input “${next.input}”`;
  // Its background file missing (Session 52), said as a missing input is.
  if (next.fileMissing !== undefined)
    caption += `, over the file “${next.fileMissing}”, which is missing: the background stays as it is`;
  // Its sound file missing (Session 54), said as its background file is.
  if (next.soundMissing !== undefined)
    caption += `, with the sound “${next.soundMissing}”, which is missing: the sound stays as it is`;
  return caption;
}
