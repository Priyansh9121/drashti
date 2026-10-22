/*
 * Show a Window… (Session 48): another app's window (a Zoom meeting's, say) shown live as the hall's
 * background. What the operator window and the main process say to each other about it.
 */

/** A window the picker offers: another app's, by name, with a small picture of it. */
export interface OfferedWindow {
  /** The window's capture id on this computer, from the main process's own list. */
  id: string;
  name: string;
  /** A small picture of the window as it is now (a data: URL), or null when there is none. */
  picture: string | null;
}

/** The picker's list, or why there is none. */
export type WindowList =
  | { ok: true; windows: OfferedWindow[] }
  /** macOS has not let Drashti see other apps' windows (Screen Recording). */
  | { ok: false; reason: 'permission'; message: string }
  | { ok: false; reason: 'unlisted'; message: string };

/** How the window on the screens stands, for the operator's notice. */
export interface LiveWindowStatus {
  /**
   * off: no window is the background. showing: it is, and it is open. gone: it was closed or hidden, and
   * the screens keep its last picture.
   */
  state: 'off' | 'showing' | 'gone';
  /** Its name (null while off). */
  name: string | null;
}

export type LiveWindowResult = { ok: true } | { ok: false; message: string };

/** Why Drashti asks macOS for Screen Recording, said before System Settings opens. */
export const SCREEN_RECORDING_WHY =
  'To show another app’s window (a Zoom meeting, say) on the hall’s screens, macOS has to let Drashti see the screen: Screen Recording. Drashti only ever shows the one window you choose, and nothing goes up until you press Show on the screens.';

/** What to do in System Settings, and after. */
export const SCREEN_RECORDING_STEPS =
  'Press Open System Settings, turn Drashti on under Screen Recording, then quit Drashti and open it again.';

/** The picker's words when it cannot list the windows for another reason. */
export const WINDOWS_FAILED = 'Drashti could not list the open windows. Try again in a moment.';
