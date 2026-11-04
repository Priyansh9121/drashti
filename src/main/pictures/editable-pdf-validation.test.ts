import { describe, expect, it } from 'vitest';
import { validateEditablePdfPage } from './editable-pdf-validation';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const page = () => ({
  mode: 'editable-source' as const,
  jobId: 'Placeholder job',
  sourceIndex: 2,
  width: 960,
  height: 540,
  elements: [
    {
      id: 'Placeholder image',
      kind: 'image' as const,
      mediaId: 'pdf-paint-1',
      fit: 'stretch' as const,
      frame: { x: 10, y: 20, width: 80, height: 60 },
    },
  ],
  assets: [{ token: 'pdf-paint-1', png }],
  issues: [],
});

describe('editable PDF private page validation', () => {
  it('accepts only the selected source page and exact native-asset token mapping', () => {
    expect(validateEditablePdfPage(page(), 'Placeholder job', new Set([2]))?.assetBytes).toBe(png.length);
    expect(validateEditablePdfPage(page(), 'Different job', new Set([2]))).toBeNull();
    expect(validateEditablePdfPage(page(), 'Placeholder job', new Set([0]))).toBeNull();
    expect(validateEditablePdfPage({ ...page(), assets: [] }, 'Placeholder job', new Set([2]))).toBeNull();
    expect(
      validateEditablePdfPage(
        { ...page(), assets: [...page().assets, ...page().assets] },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
  });

  it('refuses invalid bytes, source paths, excessive coordinates and unexpected element kinds', () => {
    expect(
      validateEditablePdfPage(
        { ...page(), assets: [{ token: 'pdf-paint-1', png: new Uint8Array([1, 2]) }] },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
    expect(
      validateEditablePdfPage(
        { ...page(), file: '/Placeholder/escape.png' },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
    const element = page().elements[0];
    expect(element).toBeDefined();
    expect(
      validateEditablePdfPage(
        { ...page(), elements: [{ ...element, frame: { x: Infinity, y: 0, width: 1, height: 1 } }] },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
    expect(
      validateEditablePdfPage(
        { ...page(), elements: [{ ...element, kind: 'video' }] },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
  });

  it('retains schema-valid native curves beside exact image assets without adding tokens for shapes', () => {
    const shape = {
      id: 'Placeholder native curve',
      kind: 'shape',
      shape: 'path',
      frame: { x: 20, y: 70, width: 80, height: 60 },
      fill: '#993366',
      cornerRadius: 0,
      opacity: 1,
      path: {
        commands: [{ op: 'M', x: 0, y: 1 }, { op: 'C', x1: 0, y1: 0, x2: 1, y2: 0, x: 1, y: 1 }, { op: 'Z' }],
        fillRule: 'nonzero',
        lineCap: 'butt',
        lineJoin: 'miter',
      },
    };
    const reply = { ...page(), elements: [...page().elements, shape] };
    const accepted = validateEditablePdfPage(reply, 'Placeholder job', new Set([2]));
    expect(accepted?.page.elements).toEqual(reply.elements);
    expect(accepted?.assetBytes).toBe(png.length);
    expect(validateEditablePdfPage({ ...reply, assets: [] }, 'Placeholder job', new Set([2]))).toBeNull();
  });

  it('keeps native shape paths, frames, ids and image tokens inside the private bounds', () => {
    const shape = {
      id: 'Placeholder bounded shape',
      kind: 'shape',
      shape: 'path',
      frame: { x: 20, y: 70, width: 80, height: 60 },
      fill: '#993366',
      cornerRadius: 0,
      opacity: 1,
      path: {
        commands: [
          { op: 'M', x: 0, y: 1 },
          { op: 'L', x: 1, y: 0 },
        ],
        fillRule: 'nonzero',
        lineCap: 'butt',
        lineJoin: 'miter',
      },
    };
    for (const bad of [
      { ...shape, path: undefined },
      {
        ...shape,
        path: {
          ...shape.path,
          commands: [
            { op: 'M', x: 0, y: 1 },
            { op: 'script', x: 1, y: 0 },
          ],
        },
      },
      {
        ...shape,
        path: {
          ...shape.path,
          commands: [
            { op: 'M', x: 0, y: 1 },
            { op: 'L', x: 1.01, y: 0 },
          ],
        },
      },
      { ...shape, id: 'x'.repeat(513) },
      { ...shape, frame: { ...shape.frame, width: 0 } },
      { ...shape, frame: { ...shape.frame, height: -1 } },
      { ...shape, frame: { ...shape.frame, x: 1_000_001 } },
    ])
      expect(
        validateEditablePdfPage({ ...page(), elements: [bad], assets: [] }, 'Placeholder job', new Set([2])),
      ).toBeNull();
    expect(
      validateEditablePdfPage(
        { ...page(), elements: [shape], assets: page().assets },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
    expect(
      validateEditablePdfPage(
        { ...page(), elements: [shape, shape], assets: [] },
        'Placeholder job',
        new Set([2]),
      ),
    ).toBeNull();
  });
});
