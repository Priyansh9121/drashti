/*
 * A video whose picture this computer cannot draw (Session 60, x36; the owner, 19 Nov 2026: "when playing a video, the
 * wallpaper shows up, when toggled the wallpaper off, the screen in audience shows black, but the video is playing";
 * his answer "Yes, A"). Chromium plays such a file (a codec it has no decoder for here, HEVC on a computer that cannot
 * decode it, ProRes, FFV1) as sound only, with no error: the screens' video has data at 0 × 0 and no frame. A window
 * finds it as the file loads (render/no-picture.ts); the show takes the video off with its sound (a video on the slide
 * or in the picture-in-picture box waits paused), the operator window says so in these words, and Drashti converts the
 * file by itself once the show is idle (main/convert/convert-service.ts convertUndrawable).
 */

/** What the operator window says: the file by its name, and whether Drashti is converting it. */
export function noPictureNotice(name: string, converting: boolean): string {
  return converting
    ? `“${name}”: this computer can’t show its picture, so it came off the screens. Drashti is converting it to a copy that plays; it can go live once that is done.`
    : `“${name}”: this computer can’t show its picture, so it came off the screens. Convert it in Media to play it.`;
}

/**
 * What the operator window says when a video could not play on one of this computer's pictures (Q60-31): its element
 * failed there (that computer's decoder, a cut or damaged file). `where`: "the screen “…”", "LIVE" or "the stream".
 */
export function cannotPlayNotice(name: string, where: string): string {
  return `“${name}” could not play on ${where}, so it came off the screens with its sound. If it happens again, the file may be damaged: tell whoever looks after Drashti.`;
}

/**
 * How long a page that draws the show waits for a video's first frame (Q60-44, the owner's answer A of 20 Nov 2026,
 * through the lead): with none by then, it says the video cannot play, as an element that failed does, and the show
 * takes it off with its sound, the Wallpaper or the cover over the picture staying up until then (render/Scene.tsx),
 * never black. Main heeds it from its own screens; LIVE's or the stream's page alone only logs it (a page out of sight
 * may wait longer, and the hall is what the audience sees); a paired computer's tells Main, as its errors do
 * (main/media/cannot-play.ts, NodeCannotPlay). Its one place: change it here.
 */
export const FIRST_FRAME_MS = 10_000;

/** The code a page sends for a video with no first frame within FIRST_FRAME_MS (MediaError's own codes are 1 to 4). */
export const NO_FIRST_FRAME = -1;

/**
 * The code a node sends Main for a video whose picture it cannot draw (x36's sound only, as on Main; ledger G-A14): on a
 * node it keeps what it showed, and Main is told, as for any other showing a node's screen could not play.
 */
export const NO_PICTURE = -2;

/**
 * What the operator window says when a paired computer's screen could not play a video (Q60-44, the owner's answer A
 * of 20 Nov 2026): that computer keeps what it showed, never black, and the video plays on everywhere else.
 */
export function cannotPlayOnNodeNotice(name: string, node: string): string {
  return `“${name}” could not play on the paired computer “${node}”: its screen keeps what it showed, and the video plays on everywhere else. If it happens again, that computer may not play this kind of video: tell whoever looks after Drashti.`;
}
