/*
 * The window for Zoom (Session 48): the stream's picture (the Program) in a window of its own, for Zoom's
 * Share Screen. What its page is told about the Program it shows.
 */

/** The Program as the window for Zoom captures it: its size, and when its page last became ready. */
export interface ZoomProgram {
  width: number;
  height: number;
  /** Changes each time the Program's page is (re)loaded or resized: the window captures it afresh. */
  at: number;
}

/** The window's title: what Zoom's Share Screen lists it as. */
export const ZOOM_WINDOW_TITLE = 'Drashti for Zoom';
