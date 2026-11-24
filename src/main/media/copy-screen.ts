import { matchDisplays } from '../../shared/display-match';
import { drawnCanvas, type PixelSize } from '../../shared/picture-look';
import type { NodeDisplays, ScreenConfig, ScreenRole } from '../../shared/screens';

/** One of this computer's outputs: its screen, and its window's inside in pixels. */
export interface LocalOutput {
  screen: ScreenConfig;
  window: PixelSize;
}

/**
 * A screen's whole canvas as drawn in its window: as its scaling places it, or (x27) as its part of one wide picture
 * fills the window, the whole canvas then that much wider, and larger by a zoom over 1 (a picture made smaller needs
 * no smaller copy). With nothing set, exactly drawnCanvas's.
 */
function drawnScreen(screen: ScreenConfig, window: PixelSize): PixelSize {
  const g = screen.geometry ?? null;
  const part = g?.part ?? null;
  const shown = { width: part?.width ?? screen.canvasWidth, height: screen.canvasHeight };
  const drawn = drawnCanvas(shown, window, screen.scaling);
  if (g === null) return drawn;
  const across = part === null ? 1 : screen.canvasWidth / part.width;
  const zoom = Math.max(1, g.zoom);
  return { width: Math.round(drawn.width * across * zoom), height: Math.round(drawn.height * zoom) };
}

/**
 * The largest audience screen's picture as drawn, in pixels: the size sharpened copies are made at
 * (Session 26g). Null with none: copies at their own size. A node's screens count too (Session 26h), each
 * at the size of the node's display it is given to (its output covers that display), whether the node is
 * on the network now or not: its displays as it last reported them, so a node dropping off for a moment
 * does not have every copy made smaller and then bigger again.
 */
export function audienceScreenSizes(input: {
  /** This computer's outputs, each in its window. */
  local: readonly LocalOutput[];
  /** Every screen there is. */
  screens: readonly ScreenConfig[];
  roleOf: (groupId: string) => ScreenRole | null;
  /** The paired nodes, with the displays each last reported. */
  nodes: readonly NodeDisplays[];
}): PixelSize[] {
  const sizes: PixelSize[] = [];
  const consider = (drawn: PixelSize) => {
    sizes.push(drawn);
  };
  for (const { screen, window } of input.local) {
    if (input.roleOf(screen.groupId) !== 'audience') continue;
    consider(drawnScreen(screen, window));
  }
  for (const node of input.nodes) {
    const onIt = input.screens.filter(
      (s) => s.nodeId === node.id && s.enabled && s.displayKey && input.roleOf(s.groupId) === 'audience',
    );
    // Each screen's display on that node, as the node itself finds it (never one display for two screens).
    const found = matchDisplays(
      onIt.flatMap((s) => (s.displayKey ? [{ screenId: s.id, key: s.displayKey }] : [])),
      node.displays,
    );
    for (const s of onIt) {
      const d = node.displays.find((x) => x.id === found.get(s.id));
      if (d) consider(drawnScreen(s, { width: d.pixelWidth, height: d.pixelHeight }));
    }
  }
  return sizes;
}

/** The existing sharpening policy still chooses the largest audience canvas by area. */
export function largestAudienceScreen(input: Parameters<typeof audienceScreenSizes>[0]): PixelSize | null {
  let largest: PixelSize | null = null;
  for (const drawn of audienceScreenSizes(input)) {
    if (!largest || drawn.width * drawn.height > largest.width * largest.height) largest = drawn;
  }
  return largest;
}
