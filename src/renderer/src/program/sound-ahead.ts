/**
 * How much decoded sound the stream's own sound players keep ahead of where they play (S5, a21-s5b).
 *
 * The stream's page decodes its pictures too, and Chromium runs every player of a page on that page's one media
 * thread, a VP8 picture's decoding included (it moves only VP9 above 720p off it). On a two-core PC with no graphics
 * chip, two 1080p pictures in a crossfade held that thread for 250 to 500 ms at a time (x69's traces), longer than the
 * 0.2 s of sound a player keeps decoded at first: the sound player ran dry there, a hole in the stream's sound.
 */
export const STREAM_SOUND_AHEAD_S = 1;

/**
 * Give a player its decoded sound ahead (Chromium's latencyHint, main/index.ts turns it on): it plays from where it
 * plays as before, it only decodes further on. False where the browser cannot be asked (it keeps its own amount).
 */
export function keepSoundAhead(el: HTMLMediaElement): boolean {
  if (!('latencyHint' in el)) return false;
  (el as HTMLMediaElement & { latencyHint: number }).latencyHint = STREAM_SOUND_AHEAD_S;
  return true;
}
