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
});
