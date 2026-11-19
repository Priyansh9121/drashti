import type { Placement, Size } from './scaling';
import { placeContent } from './scaling';
import type { ScalingMode } from './screens';

/*
 * A screen's geometry (x27, 19 Nov 2026): output scaling, corner-pin and edge blend. Not built yet: the tests first.
 */

export interface Point {
  x: number;
  y: number;
}

/** Top left, top right, bottom right, bottom left. */
export type Corners = readonly [Point, Point, Point, Point];

export interface ScreenPart {
  x: number;
  width: number;
}

export interface ScreenBlend {
  left: number;
  right: number;
  gamma: number;
  curve: number;
}

export interface ScreenGeometry {
  zoom: number;
  offsetX: number;
  offsetY: number;
  corners: Corners;
  part: ScreenPart | null;
  blend: ScreenBlend | null;
}

export const DEFAULT_GAMMA = 2.2;
export const DEFAULT_CURVE = 2;

const ZERO: Point = { x: 0, y: 0 };

export const NO_GEOMETRY: ScreenGeometry = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  corners: [ZERO, ZERO, ZERO, ZERO],
  part: null,
  blend: null,
};

/** A 3 × 3 matrix, row by row. */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export function nothingSet(_g: ScreenGeometry | null | undefined): boolean {
  return false;
}

export function applyMatrix(_m: Matrix3, p: Point): Point {
  return p;
}

export function squareToQuad(_q: Corners): Matrix3 | null {
  return null;
}

export function pinnedCorners(_g: Pick<ScreenGeometry, 'corners'>, _box: Size): Corners {
  return [ZERO, ZERO, ZERO, ZERO];
}

export function warpMatrix(_g: ScreenGeometry, _box: Size): Matrix3 | null {
  return null;
}

export function warpTransform(_g: ScreenGeometry | null | undefined, _box: Size): string | null {
  return '';
}

export function cornersProblem(_corners: Corners): string | null {
  return null;
}

export function blendLight(_t: number, _curve: number): number {
  return 0;
}

export function blendFactor(_t: number, _curve: number, _gamma: number): number {
  return 0;
}

export function rampAlphas(_columns: number, _curve: number, _gamma: number): Uint8ClampedArray {
  return new Uint8ClampedArray(0);
}

export function placePart(canvas: Size, _part: ScreenPart | null, box: Size, mode: ScalingMode): Placement {
  return placeContent(canvas, box, mode);
}

export function partClip(_canvas: Size, _part: ScreenPart | null): string | undefined {
  return undefined;
}

export function widePicture(
  _count: number,
  screen: Size,
  _overlap: number,
): { canvas: Size; screens: { part: ScreenPart; blend: ScreenBlend }[] } {
  return { canvas: screen, screens: [] };
}
