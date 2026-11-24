/*
 * Live behind the Lower Thirds studio's preview (alpha.22, the owner: "the background while selecting the animation
 * should be the one thats live"): a still of what the hall's screens show now, taken by the main process about once a
 * second while the studio shows Live, and never otherwise. It is taken from a picture already drawn (a hall screen's
 * window on this computer), so nothing plays a video a second time for it, and it changes nothing on the screens.
 * With no hall screen on this computer (alpha.23), it is taken from Live's copy instead: the screens' own page drawn
 * off screen, small and once a second, only while it is needed (main/lower-thirds/live-copy.ts).
 */

/** Where the still was taken: a hall screen's window on this computer, or Live's copy (no hall screen here). */
export type StudioLiveSource = 'screen' | 'copy';

/** What is live that Live's copy cannot draw (it is no screen): a video input, or another app's window. */
export type LiveUnseen = 'input' | 'window' | 'link';

/** main -> the studio while Live's copy opens (its page loading): "Getting the live picture…". */
export interface StudioLiveWaiting {
  waiting: true;
}

/** main -> the studio, each round: a still, the copy still opening, or none (this computer has nothing to take it from). */
export type StudioLiveMessage = StudioLivePicture | StudioLiveWaiting | null;

/** main -> the studio: the still of what is live now. */
export interface StudioLivePicture {
  /** A JPEG, as a data: address. */
  url: string;
  source: StudioLiveSource;
  /** When it was taken (this computer's clock, ms). */
  at: number;
  /** From Live's copy: what is live that it does not draw (left out when nothing). */
  unseen?: LiveUnseen[];
}
