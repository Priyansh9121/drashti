/*
 * The Stage preview's window (alpha.22): a stub until the review's fixes land (as built at 42f604878).
 */

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
    title: 'Drashti – Stage preview',
    backgroundColor: '#000000',
  };
}

export function revealPreview(win: {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
