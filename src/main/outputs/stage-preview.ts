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
