import { createContext } from 'react';

/**
 * Whether a screen's picture keeps its clips at its canvas's edges (x27): true on every page but an output whose
 * picture is warped out of square (a corner pinned). Under such a warp each of those clips would make Chromium draw what
 * it holds again, into a surface of its own, every frame (cc's "clip axis alignment" render surface: the warp's cost on
 * two-core Windows and on CI's Mac, the owner's Q60-20), so that output draws none and covers the window outside its
 * picture with black instead (output/PictureFrame.tsx).
 */
export const CanvasClip = createContext(true);
