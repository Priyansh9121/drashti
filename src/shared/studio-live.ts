/*
 * Live behind the Lower Thirds studio's preview (alpha.22, the owner: "the background while selecting the animation
 * should be the one thats live"): a still of what the hall's screens show now, taken by the main process about once a
 * second while the studio shows Live, and never otherwise. It is taken from a picture already drawn (a hall screen's
 * window on this computer, or else LIVE in the operator window), so nothing plays a video a second time for it, and it
 * changes nothing on the screens.
 */

/** Where the still was taken: a hall screen's window on this computer, or LIVE in the operator window. */
export type StudioLiveSource = 'screen' | 'live';

/** main -> the studio: the still of what is live now. */
export interface StudioLivePicture {
  /** A JPEG, as a data: address. */
  url: string;
  source: StudioLiveSource;
  /** When it was taken (this computer's clock, ms). */
  at: number;
}
