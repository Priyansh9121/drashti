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
