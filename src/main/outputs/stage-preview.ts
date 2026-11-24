/*
 * The Stage preview's window (alpha.22): a normal window on this computer, movable and sized as any window, over the
 * controls' display (never full screen, never on top), showing a stage screen's page. It never takes the keyboard
 * from the operator window (a22-review-stage S1): it is shown, and brought forward, without the focus, as the
 * outputs are, so the show's keys stay with the operator; it can still be clicked, moved and sized. On Windows it has
 * no menu bar of its own (S4), as every other Drashti window.
 */

/** Its size and place, before the icon and the web preferences (electron-outputs.ts adds those). */
export function stagePreviewOptions(near: { x: number; y: number; width: number; height: number } | null) {
  const width = 960;
  const height = 540;
  return {
    ...(near
      ? {
          x: Math.round(near.x + Math.max(0, (near.width - width) / 2)),
          y: Math.round(near.y + Math.max(0, (near.height - height) / 3)),
        }
      : {}),
    width,
    height,
    minWidth: 320,
    minHeight: 180,
    show: false,
    autoHideMenuBar: true,
    title: 'Drashti – Stage preview',
    backgroundColor: '#000000',
  };
}

/** Shown, or brought forward again: in sight, above the other windows, the keyboard left where it is. */
export function revealPreview(win: {
  isMinimized(): boolean;
  restore(): void;
  showInactive(): void;
  moveTop(): void;
}): void {
  if (win.isMinimized()) win.restore();
  win.showInactive();
  win.moveTop();
}

/**
 * What the Stage preview's page may have of this computer's live pictures (alpha.23; lead 2's QA23-STAGE8-1, option
 * A): a camera, video only, as an output's (windows/security.ts cameraAllowed still checks its output.html address,
 * and on a Mac the Camera access), and the video inputs' list it finds the input in, so a layout's **The video
 * input, live** box and a video input behind the audience picture draw there live: Chromium opens a camera once for
 * all of Drashti's pages in the same format (render/video-input.ts), so it adds no second capture of the device.
 * Never a say in how the input stands (videoInputs.report: the operator's notice and restart recovery hear only the
 * screens), and never a capture of another app's window: it names the window instead, as a tablet does.
 */
export const PREVIEW_LIVE = { camera: 'output', list: true, report: false, window: false } as const;

/** What a page asks of this computer's live pictures: a camera, the video inputs' list, to say how an input stands, a window's capture. */
export type LiveAsk = keyof typeof PREVIEW_LIVE;

/**
 * How Main answers a page's ask (a22-review-stage8 S4; index.ts's cameraPage, videoInputs.list, videoInputs.report,
 * liveWindow.ask and .ended): 'yes' to a screen's page (an output, the stream's, the operator window), 'no' to any
 * other page, and to the Stage preview as PREVIEW_LIVE says, 'refused' for what it never may (said in the log). The
 * preview is judged first, so it never passes as a screen's page.
 */
export function liveAnswer(
  ask: LiveAsk,
  page: { preview: boolean; screen: boolean },
): 'yes' | 'no' | 'refused' {
  if (page.preview) return PREVIEW_LIVE[ask] === false ? 'refused' : 'yes';
  return page.screen ? 'yes' : 'no';
}
