/*
 * Full quality on a phone or tablet (Session 54, D1). A picture (a slide's, a background's, a deck's or a PDF's
 * page) is fetched at the width the device draws it, in a few steps, up to the original and never wider: the
 * network server makes each step once and keeps it (src/main/network/renditions.ts), and the device keeps the
 * sharpest it has (src/renderer/src/web/previews.ts). Both use these steps, so they ask for and keep the same
 * few sizes. 320 is the small preview's own width, as before.
 */

/** The widths a picture is made at for a device, smallest first. */
export const PICTURE_WIDTHS = [320, 640, 1280, 1920, 2560, 3840, 7680] as const;

const LARGEST = PICTURE_WIDTHS[PICTURE_WIDTHS.length - 1] ?? 7680;

/** The step to ask for to draw a picture `drawn` device pixels wide: the smallest at least that wide. */
export function pictureStep(drawn: number): number {
  if (!Number.isFinite(drawn) || drawn <= 0) return PICTURE_WIDTHS[0];
  return PICTURE_WIDTHS.find((w) => w >= drawn) ?? LARGEST;
}

/**
 * How long a link to a media file's original works (Session 54, D1): a video on a phone plays from it to its end,
 * so long enough for any sabha's video; never past Drashti's next start, nor once the device is removed.
 */
export const MEDIA_LINK_MS = 6 * 60 * 60 * 1000;
