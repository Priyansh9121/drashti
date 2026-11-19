import { createContext } from 'react';

/**
 * Whether a screen's picture keeps its clips at its canvas's edges (x27): true on every page but an output whose
 * picture is warped out of square (a corner pinned). Under such a warp each of those clips would make Chromium draw what
 * it holds again, into a surface of its own, every frame (cc's "clip axis alignment" render surface: the warp's cost on
 * two-core Windows and on CI's Mac, the owner's Q60-20), so that output draws none and covers the window outside its
 * picture with black instead (output/PictureFrame.tsx).
 */
export const CanvasClip = createContext(true);

/**
 * Whether the pictures that fade or move on this screen (a slide's two, a background's two) are drawn as layers of
 * their own (x27, the owner's Q60-20): on a screen warped out of square that draws with a graphics chip. Chromium
 * rasters anything under a perspective at a whole pixel a canvas pixel at least (3.5 times the plain picture's pixels on
 * a 1024 x 768 display), and a picture painted afresh at each frame of its dissolve was rastered again at each: as a
 * layer of its own it is rastered once and faded by the graphics chip. Without a chip (Chromium drawing in software) such
 * layers cost more than the painting, so none are made there.
 */
export const OwnLayers = createContext(false);
