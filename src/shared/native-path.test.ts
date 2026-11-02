import { describe, expect, it } from 'vitest';
import { slideElementSchema } from './model-schema';
import { ENGINE_STATE_VERSION, readsEngineVersion } from './engine/state';

// Generated vector only. Coordinates are normalized to its native frame, so
// the same path survives the existing frame resize, rotation and flips.
const drawing = {
  id: 'placeholder-drawing',
  kind: 'shape',
  shape: 'path',
  frame: { x: 20, y: 30, width: 220, height: 100 },
  rotation: 25,
  flipX: true,
  fill: '#f0c020',
  cornerRadius: 0,
  opacity: 0.5,
  outline: { color: '#203080', width: 3 },
  path: {
    commands: [
      { op: 'M', x: 0, y: 0.2 },
      { op: 'L', x: 0.25, y: 1 },
      { op: 'C', x1: 0.4, y1: 0.9, x2: 0.5, y2: 0.1, x: 0.65, y: 0.2 },
      { op: 'Q', x1: 0.85, y1: 0, x: 1, y: 0.5 },
      { op: 'Z' },
    ],
    fillRule: 'evenodd',
    lineCap: 'round',
    lineJoin: 'bevel',
  },
} as const;

describe('native drawing paths through the existing element boundary', () => {
  it('accepts and retains the actual bent and curved drawing and its paint settings', () => {
    const parsed = slideElementSchema.safeParse(drawing);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(drawing);
  });

  it('never accepts a path shape without its drawing, or silently drops malformed commands', () => {
    const { path: _path, ...withoutDrawing } = drawing;
    expect(slideElementSchema.safeParse(withoutDrawing).success).toBe(false);
    for (const commands of [
      [],
      [
        { op: 'L', x: 0, y: 0 },
        { op: 'L', x: 1, y: 1 },
      ],
      [
        { op: 'M', x: 0, y: 0 },
        { op: 'script', x: 1, y: 1 },
      ],
      [
        { op: 'M', x: 0, y: 0 },
        { op: 'C', x1: 0, y1: 0, x: 1, y: 1 },
      ],
      [
        { op: 'M', x: 0, y: 0 },
        { op: 'L', x: Number.NaN, y: 1 },
      ],
      [
        { op: 'M', x: 0, y: 0 },
        { op: 'L', x: Number.POSITIVE_INFINITY, y: 1 },
      ],
      [
        { op: 'M', x: 0, y: 0 },
        { op: 'L', x: -0.1, y: 1 },
      ],
      [
        { op: 'M', x: 0, y: 0 },
        { op: 'L', x: 1.1, y: 1 },
      ],
      Array.from({ length: 4097 }, (_, i) => ({ op: i === 0 ? 'M' : 'L', x: 0, y: 0 })),
    ]) {
      expect(slideElementSchema.safeParse({ ...drawing, path: { ...drawing.path, commands } }).success).toBe(
        false,
      );
    }
  });
});

describe('the native drawing engine contract', () => {
  it('advertises engine 25 to players which must draw the new path content', () => {
    expect(ENGINE_STATE_VERSION).toBe(25);
  });

  it('reads the preceding 23 and 24 saved states without discarding their layers', () => {
    expect(readsEngineVersion(23)).toBe(true);
    expect(readsEngineVersion(24)).toBe(true);
  });
});
