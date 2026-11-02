import type { NativePath, ShapeElement } from '../../../shared/model';
import type { Point } from './geometry';

export type PdfCanvasTool = 'highlight' | 'underline' | 'strike' | 'draw' | 'cover';

const rectanglePath = (): NativePath => ({
  commands: [{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 1, y: 0 }, { op: 'L', x: 1, y: 1 }, { op: 'L', x: 0, y: 1 }, { op: 'Z' }],
  fillRule: 'nonzero', lineCap: 'butt', lineJoin: 'miter',
});

/** A generated native mark; no document/history change occurs here. */
export function pdfMark(tool: PdfCanvasTool, points: readonly Point[], id: string): ShapeElement | null {
  const first = points[0], last = points.at(-1);
  if (!first || !last || points.length < 2 || points.length > 4096 ||
      points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const samples = tool === 'draw' ? points : [first, last];
  const xs = samples.map((point) => point.x), ys = samples.map((point) => point.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spreadX = Math.max(...xs) - minX, spreadY = Math.max(...ys) - minY;
  if (spreadX === 0 && spreadY === 0) return null;
  if ((tool === 'highlight' || tool === 'cover') && (spreadX === 0 || spreadY === 0)) return null;
  if ((tool === 'underline' || tool === 'strike') && spreadX === 0) return null;
  // A horizontal/vertical stroke still has a real resizable native frame.
  const frame = {
    x: minX - (spreadX === 0 ? 0.5 : 0), y: minY - (spreadY === 0 ? 0.5 : 0),
    width: Math.max(1, spreadX), height: Math.max(1, spreadY),
  };
  const base = { id, kind: 'shape' as const, frame, cornerRadius: 0 };
  if (tool === 'cover') return { ...base, shape: 'rectangle', fill: '#000000', opacity: 1 };
  if (tool === 'highlight') return { ...base, shape: 'path', path: rectanglePath(), fill: '#f4c542', opacity: 0.32 };
  if (tool === 'underline' || tool === 'strike') {
    const y = tool === 'underline' ? 1 : 0.5;
    return {
      ...base, shape: 'path', fill: null, opacity: 1, outline: { color: '#c63030', width: 2 },
      path: { commands: [{ op: 'M', x: 0, y }, { op: 'L', x: 1, y }], fillRule: 'nonzero', lineCap: 'round', lineJoin: 'round' },
    };
  }
  const normalized = (value: number, start: number, length: number) => Math.max(0, Math.min(1, (value - start) / length));
  return {
    ...base, shape: 'path', fill: null, opacity: 1, outline: { color: '#1763c0', width: 3 },
    path: {
      commands: samples.map((point, i) => ({ op: i === 0 ? 'M' : 'L', x: normalized(point.x, frame.x, frame.width), y: normalized(point.y, frame.y, frame.height) })),
      fillRule: 'nonzero', lineCap: 'round', lineJoin: 'round',
    },
  };
}
