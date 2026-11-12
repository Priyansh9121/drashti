import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { NativePathCommand, ShapeElement, SlideElement } from './model';

export interface EditablePdfControl {
  checkpoint?(): Promise<void>;
  maxAssetBytes?: number;
}

export interface EditablePdfPage {
  width: number;
  height: number;
  elements: SlideElement[];
  assets: { id: string; png: Uint8Array }[];
  issues: string[];
}

/** A drawing surface supplied by PDF.js in a hidden page or its Node factory. */
interface DrawingCanvas {
  width: number;
  height: number;
  toBuffer?: (mime: string) => Uint8Array;
  toBlob?: (callback: (blob: { arrayBuffer(): Promise<ArrayBuffer> } | null) => void, mime: string) => void;
}
interface DrawingContext {
  font: string;
  fillStyle: unknown;
  globalAlpha: number;
  globalCompositeOperation: string;
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number };
  measureText(text: string): { width: number };
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  fillText: (...args: unknown[]) => unknown;
  strokeText: (...args: unknown[]) => unknown;
  fill: (...args: unknown[]) => unknown;
  stroke: (...args: unknown[]) => unknown;
  drawImage: (...args: unknown[]) => unknown;
  fillRect: (...args: unknown[]) => unknown;
  strokeRect: (...args: unknown[]) => unknown;
  clip: (...args: unknown[]) => unknown;
  save: (...args: unknown[]) => unknown;
  restore: (...args: unknown[]) => unknown;
}
interface CanvasFactory {
  create(width: number, height: number): { canvas: DrawingCanvas; context: DrawingContext };
  destroy(target: { canvas: DrawingCanvas; context: DrawingContext }): void;
}
interface PaintCall {
  method: string;
  at: [number, number];
  matrix: Matrix;
  font: string;
  fill: string;
  alpha: number;
  width: number;
  composite: string;
  clip?: ClipBounds | null;
}
const PAINT = ['fillText', 'strokeText', 'fill', 'stroke', 'drawImage', 'fillRect', 'strokeRect'] as const;
type ContextMethod = (typeof PAINT)[number] | 'save' | 'restore' | 'clip';
type Matrix = [number, number, number, number, number, number];
type ClipBounds = [left: number, top: number, right: number, bottom: number];
// Each isolated effect render also scans the full canvas for its painted pixels.
const MAX_EFFECT_RASTER_PIXELS = 64 * 1024 * 1024;
function matrixOf(values: readonly number[]): Matrix {
  const [a, b, c, d, e, f] = values;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined ||
    ![a, b, c, d, e, f].every(Number.isFinite)
  )
    throw new Error('The PDF has an invalid transform.');
  return [a, b, c, d, e, f];
}

function colorOf(value: string): string | null {
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value)) return value;
  if (/^#[0-9a-f]{3}$/iu.test(value)) return value.replace(/[0-9a-f]/giu, (c) => c + c);
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/u.exec(value);
  if (!rgb) return null;
  return (
    '#' +
    rgb
      .slice(1, 4)
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
      .join('')
  );
}

// Simple native fills use the same normalized drawing path on every player.
function nativePdfCommands(value: unknown): NativePathCommand[] | null {
  // PDF.js6.4 mutates this Float32Array into a Path2D during first render.
  if (!(value instanceof Float32Array)) return null;
  const result: NativePathCommand[] = [];
  let index = 0;
  const number = (): number | null => {
    const item = value[index++];
    return item !== undefined && Number.isFinite(item) ? item : null;
  };
  while (index < value.length) {
    if (result.length >= 4096) return null;
    const op = number();
    if (op === 4) {
      if (!result.length) return null;
      result.push({ op: 'Z' });
      continue;
    }
    const x1 = number(),
      y1 = number();
    if (x1 === null || y1 === null) return null;
    if (op === 0 || op === 1) result.push({ op: op === 0 ? 'M' : 'L', x: x1, y: y1 });
    else if (op === 2) {
      const x2 = number(),
        y2 = number(),
        x = number(),
        y = number();
      if (x2 === null || y2 === null || x === null || y === null) return null;
      result.push({ op: 'C', x1, y1, x2, y2, x, y });
    } else if (op === 3) {
      const x = number(),
        y = number();
      if (x === null || y === null) return null;
      result.push({ op: 'Q', x1, y1, x, y });
    } else return null;
  }
  return result.length >= 2 && result[0]?.op === 'M' ? result : null;
}
function pointInPdfPaint(x: number, y: number, matrix: Matrix, scale: number): { x: number; y: number } {
  return {
    x: (matrix[0] * x + matrix[2] * y + matrix[4]) / scale,
    y: (matrix[1] * x + matrix[3] * y + matrix[5]) / scale,
  };
}
function rectangleBounds(commands: readonly NativePathCommand[]): ClipBounds | undefined {
  const [a, b, c, d, end] = commands;
  if (
    commands.length !== 5 ||
    a?.op !== 'M' ||
    b?.op !== 'L' ||
    c?.op !== 'L' ||
    d?.op !== 'L' ||
    end?.op !== 'Z'
  )
    return undefined;
  const verticalFirst = a.x === b.x && b.y === c.y && c.x === d.x && d.y === a.y;
  const horizontalFirst = a.y === b.y && b.x === c.x && c.y === d.y && d.x === a.x;
  if (!verticalFirst && !horizontalFirst) return undefined;
  return [Math.min(a.x, c.x), Math.min(a.y, c.y), Math.max(a.x, c.x), Math.max(a.y, c.y)];
}

function formBounds(value: unknown): ClipBounds | undefined {
  if (!Array.isArray(value) && !(value instanceof Float32Array)) return undefined;
  const bounds: readonly unknown[] = value instanceof Float32Array ? Array.from(value) : value;
  if (bounds.length !== 4) return undefined;
  const [x1, y1, x2, y2] = bounds;
  if (
    typeof x1 !== 'number' ||
    typeof y1 !== 'number' ||
    typeof x2 !== 'number' ||
    typeof y2 !== 'number' ||
    ![x1, y1, x2, y2].every(Number.isFinite)
  )
    return undefined;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

function intersectClip(
  current: ClipBounds | null | undefined,
  bounds: ClipBounds | undefined,
  ctx: DrawingContext,
  scale: number,
): ClipBounds | null {
  if (current === null || !bounds) return null;
  const { a, b, c, d, e, f } = ctx.getTransform();
  if ((b !== 0 || c !== 0) && (a !== 0 || d !== 0)) return null;
  const matrix: Matrix = [a, b, c, d, e, f];
  const p = pointInPdfPaint(bounds[0], bounds[1], matrix, scale);
  const q = pointInPdfPaint(bounds[2], bounds[3], matrix, scale);
  return [
    Math.max(Math.min(p.x, q.x), current?.[0] ?? -Infinity),
    Math.max(Math.min(p.y, q.y), current?.[1] ?? -Infinity),
    Math.min(Math.max(p.x, q.x), current?.[2] ?? Infinity),
    Math.min(Math.max(p.y, q.y), current?.[3] ?? Infinity),
  ];
}

function mappedPdfCommands(
  commands: readonly NativePathCommand[],
  matrix: Matrix,
  scale: number,
): NativePathCommand[] {
  return commands.map((command): NativePathCommand => {
    if (command.op === 'Z') return command;
    const end = pointInPdfPaint(command.x, command.y, matrix, scale);
    if (command.op === 'C') {
      const first = pointInPdfPaint(command.x1, command.y1, matrix, scale);
      const second = pointInPdfPaint(command.x2, command.y2, matrix, scale);
      return { op: 'C', x1: first.x, y1: first.y, x2: second.x, y2: second.y, ...end };
    }
    if (command.op === 'Q') {
      const first = pointInPdfPaint(command.x1, command.y1, matrix, scale);
      return { op: 'Q', x1: first.x, y1: first.y, ...end };
    }
    return { op: command.op, ...end };
  });
}
function pdfCommandPoints(commands: readonly NativePathCommand[]): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const command of commands) {
    if (command.op === 'Z') continue;
    points.push({ x: command.x, y: command.y });
    if (command.op === 'C' || command.op === 'Q') points.push({ x: command.x1, y: command.y1 });
    if (command.op === 'C') points.push({ x: command.x2, y: command.y2 });
  }
  return points;
}
function nativePdfPath(
  index: number,
  commands: NativePathCommand[],
  call: PaintCall,
  scale: number,
  fillRule: 'nonzero' | 'evenodd',
): ShapeElement | null {
  const fill = colorOf(call.fill);
  if (
    !fill ||
    call.composite !== 'source-over' ||
    !Number.isFinite(call.alpha) ||
    call.alpha < 0 ||
    call.alpha > 1
  )
    return null;
  const absolute = mappedPdfCommands(commands, call.matrix, scale);
  const points = pdfCommandPoints(absolute);
  if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const width = right - left,
    height = bottom - top;
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) return null;
  // Subtract before dividing: exact extrema map to0/1 without a matrix's
  // cancellation producing1+epsilon outside the normalized path schema.
  const normalized = absolute.map((command): NativePathCommand => {
    if (command.op === 'Z') return command;
    const end = { x: (command.x - left) / width, y: (command.y - top) / height };
    if (command.op === 'C') {
      return {
        op: 'C',
        x1: (command.x1 - left) / width,
        y1: (command.y1 - top) / height,
        x2: (command.x2 - left) / width,
        y2: (command.y2 - top) / height,
        ...end,
      };
    }
    if (command.op === 'Q') {
      return { op: 'Q', x1: (command.x1 - left) / width, y1: (command.y1 - top) / height, ...end };
    }
    return { op: command.op, ...end };
  });
  return {
    id: 'pdf-path-' + String(index),
    kind: 'shape',
    shape: 'path',
    frame: { x: left, y: top, width, height },
    fill,
    cornerRadius: 0,
    opacity: call.alpha,
    path: { commands: normalized, fillRule, lineCap: 'butt', lineJoin: 'miter' },
  };
}

async function pngOf(canvas: DrawingCanvas): Promise<Uint8Array> {
  if (canvas.toBuffer) return new Uint8Array(canvas.toBuffer('image/png'));
  const encode = canvas.toBlob;
  if (!encode) throw new Error('No PNG encoder is available for the editable page.');
  return new Promise((resolve, reject) =>
    encode.call(
      canvas,
      (blob) => {
        if (!blob) reject(new Error('An editable PDF object could not be drawn.'));
        else void blob.arrayBuffer().then((bytes) => resolve(new Uint8Array(bytes)), reject);
      },
      'image/png',
    ),
  );
}

/**
 * Run every PDF operator so text advances and graphics state remain correct.
 * Separate paint on the page canvas, leaving clips and masks active in PDF.js.
 * Backdrop-dependent compositing needs the original page and stays in saved playback.
 */
export async function editablePdfPage(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  ops: Readonly<Record<string, number>>,
  control: EditablePdfControl = {},
): Promise<EditablePdfPage> {
  await control.checkpoint?.();
  let assetBytes = 0;
  const base = page.getViewport({ scale: 1 });
  if (base.width < 16 || base.height < 16 || base.width > 16384 || base.height > 16384)
    throw new Error('This PDF page is outside the editable size limit.');
  const scale = Math.min(2, 2048 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width),
    height = Math.ceil(viewport.height);
  const list = await page.getOperatorList({ annotationMode: 0 });
  const argsAt = (index: number): unknown[] => {
    const value: unknown = list.argsArray[index];
    return Array.isArray(value) ? (value as unknown[]) : [];
  };
  if (list.fnArray.length > 20_000) throw new Error('This page has too many objects to edit safely.');
  const content = await page.getTextContent({ disableNormalization: true });
  const factory = doc.canvasFactory as CanvasFactory;
  const show = new Set([
    ops['showText'],
    ops['showSpacedText'],
    ops['nextLineShowText'],
    ops['nextLineSetSpacingShowText'],
  ]);
  const pathClips = new Set([ops['clip'], ops['eoClip']]);
  const scopes = new Set([ops['beginGroup'], ops['beginSMaskGroup'], ops['paintFormXObjectBegin']]);
  const ends = new Set([ops['restore'], ops['endGroup'], ops['endSMaskGroup'], ops['paintFormXObjectEnd']]);
  const imageMasks = new Set([
    ops['paintImageMaskXObject'],
    ops['paintImageMaskXObjectGroup'],
    ops['paintImageMaskXObjectRepeat'],
    ops['paintSolidColorImageMask'],
  ]);
  // Source v6 packed snapshots must precede the first reference render.
  const pathSnapshots = new Map<number, { commands: NativePathCommand[]; fillRule: 'nonzero' | 'evenodd' }>();
  const clipBounds = new Map<number, ClipBounds>();
  const textMasks = new Set<number>();
  const groupedWords = new Set<number>();
  const textModes: number[] = [];
  let groupDepth = 0;
  let textMode = 0;
  let clipsNextPath = false;
  let hasEffects = false;
  for (const [index, fn] of list.fnArray.entries()) {
    if (index % 128 === 0) await control.checkpoint?.();
    const args = argsAt(index);
    if (scopes.has(fn) || fn === ops['save']) textModes.push(textMode);
    if (ends.has(fn)) {
      textMode = textModes.pop() ?? 0;
      clipsNextPath = false;
    }
    if (scopes.has(fn) || pathClips.has(fn) || imageMasks.has(fn)) hasEffects = true;
    if (pathClips.has(fn)) clipsNextPath = true;
    if (fn === ops['paintFormXObjectBegin']) {
      const bounds = formBounds(args[1]);
      if (bounds) clipBounds.set(index, bounds);
    }
    if (fn === ops['setTextRenderingMode']) {
      textMode = Number(args[0]);
      if (textMode >= 4) hasEffects = true;
    }
    if (fn === ops['beginGroup']) groupDepth++;
    if (fn === ops['endGroup']) groupDepth = Math.max(0, groupDepth - 1);
    if (show.has(fn)) {
      if (textMode >= 4) textMasks.add(index);
      if (groupDepth && textMode !== 3 && textMode !== 7) groupedWords.add(index);
    }
    if (fn === ops['setGState']) {
      const states: unknown = args[0];
      if (!Array.isArray(states)) throw new Error('This page has an unsupported graphics state.');
      const entries: readonly unknown[] = states;
      for (const state of entries) {
        if (!Array.isArray(state)) throw new Error('This page has an unsupported graphics state.');
        const key: unknown = state[0],
          value: unknown = state[1];
        if (key === 'BM' && value !== 'source-over')
          throw new Error(
            'This page uses backdrop-dependent compositing that cannot be separated safely. Its saved playback is unchanged.',
          );
        if (key === 'TR' && value !== null)
          throw new Error(
            'This page uses transfer effects that cannot be separated safely. Its saved playback is unchanged.',
          );
        if (key === 'SMask' && value !== false) hasEffects = true;
      }
    }
    if (fn !== ops['constructPath']) continue;
    const clipping = clipsNextPath;
    clipsNextPath = false;
    const paint: unknown = args[0],
      wrapped: unknown = args[1];
    const filling = paint === ops['fill'] || paint === ops['eoFill'];
    if ((!filling && !clipping) || !Array.isArray(wrapped)) continue;
    const source: unknown = wrapped[0];
    const commands = nativePdfCommands(source);
    if (!commands) continue;
    if (clipping) {
      const bounds = rectangleBounds(commands);
      if (bounds) clipBounds.set(index, bounds);
    }
    if (filling)
      pathSnapshots.set(index, { commands, fillRule: paint === ops['eoFill'] ? 'evenodd' : 'nonzero' });
  }
  const pathCalls = new Map<number, PaintCall[]>();
  const outlinedText = new Set<number>();

  const calls = new Map<number, PaintCall[]>();
  const painted = new Set<number>();
  async function render(allowed?: ReadonlySet<number>): Promise<ReturnType<CanvasFactory['create']>> {
    const target = factory.create(width, height);
    const ctx = target.context;
    const originals = new Map<ContextMethod, DrawingContext[ContextMethod]>();
    let current: number | null = null;
    let clip: ClipBounds | null | undefined;
    const observe = (method: ContextMethod, allow: (args: unknown[]) => boolean) => {
      const old = ctx[method];
      originals.set(method, old);
      Object.defineProperty(ctx, method, {
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => {
          if (allow(args)) return Reflect.apply(old, ctx, args);
          return undefined;
        },
      });
    };
    try {
      if (hasEffects && !allowed) {
        // PDF.js mirrors clips and save/restore back to this canvas while it paints masks.
        const stack: (ClipBounds | null | undefined)[] = [];
        observe('save', () => {
          stack.push(clip);
          return true;
        });
        observe('restore', () => {
          clip = stack.pop();
          return true;
        });
        observe('clip', () => {
          clip = intersectClip(clip, current === null ? undefined : clipBounds.get(current), ctx, scale);
          return true;
        });
      }
      for (const method of PAINT) {
        observe(method, (args) => {
          if (current === null) return true;
          if (ctx.globalCompositeOperation !== 'source-over')
            throw new Error(
              'This page uses backdrop-dependent compositing that cannot be separated safely. Its saved playback is unchanged.',
            );
          if (allowed) return allowed.has(current);
          painted.add(current);
          const isText = show.has(list.fnArray[current]);
          if (isText && (method === 'strokeText' || method === 'stroke')) outlinedText.add(current);
          if (!hasEffects && pathSnapshots.has(current) && method === 'fill') {
            const m = ctx.getTransform();
            const values = pathCalls.get(current) ?? [];
            values.push({
              method,
              at: [m.e, m.f],
              matrix: [m.a, m.b, m.c, m.d, m.e, m.f],
              font: ctx.font,
              fill: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '',
              alpha: ctx.globalAlpha,
              width: 0,
              composite: ctx.globalCompositeOperation,
            });
            pathCalls.set(current, values);
          }
          if (
            isText &&
            !textMasks.has(current) &&
            !groupedWords.has(current) &&
            (method === 'fillText' || method === 'fill')
          ) {
            const m = ctx.getTransform();
            const x = method === 'fillText' ? Number(args[1]) : 0,
              y = method === 'fillText' ? Number(args[2]) : 0;
            const values = calls.get(current) ?? [];
            values.push({
              method,
              at: [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f],
              matrix: [m.a, m.b, m.c, m.d, m.e, m.f],
              font: ctx.font,
              fill: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '',
              alpha: ctx.globalAlpha,
              width:
                method === 'fillText' ? ctx.measureText(String(args[0])).width * Math.hypot(m.a, m.b) : 0,
              composite: ctx.globalCompositeOperation,
              clip,
            });
            calls.set(current, values);
          }
          return true;
        });
      }
      await page.render({
        // A non-null canvas makes PDF.js ignore canvasContext and request alpha:false.
        // Force the factory's existing transparent context for separable paint.
        canvas: null,
        canvasContext: target.context as never,
        viewport,
        annotationMode: 0,
        background: 'rgba(0,0,0,0)',
        operationsFilter(index, actual) {
          current = index;
          if (actual.fnArray[index] !== list.fnArray[index])
            throw new Error('This page cannot be separated reliably.');
          return true;
        },
      }).promise;
      return target;
    } catch (error) {
      factory.destroy(target);
      throw error;
    } finally {
      for (const [method, old] of originals)
        Object.defineProperty(ctx, method, { configurable: true, writable: true, value: old });
    }
  }

  const reference = await render();
  factory.destroy(reference);
  const native = new Map<number, SlideElement>();
  for (const [index, path] of pathSnapshots) {
    const values = pathCalls.get(index);
    if (values?.length !== 1) continue;
    await control.checkpoint?.();
    const call = values[0];
    if (!call) continue;
    const shape = nativePdfPath(index, path.commands, call, scale, path.fillRule);
    if (shape) native.set(index, shape);
  }
  const usedItems = new Set<number>();
  const issues = [
    'Edited PDF text uses Drashti’s available fonts; line breaks and spacing may differ from the source.',
  ];
  for (const [index, values] of calls) {
    if (outlinedText.has(index)) continue;
    const first = values[0],
      last = values.at(-1);
    const glyphs: unknown = argsAt(index)[0];
    if (!first || !last || !Array.isArray(glyphs)) continue;
    const words = glyphs
      .filter(
        (g: unknown): g is { unicode: string } =>
          typeof g === 'object' && g !== null && 'unicode' in g && typeof g.unicode === 'string',
      )
      .map((g) => g.unicode)
      .join('');
    const px = /([\d.]+)px/u.exec(first.font);
    const fill = colorOf(first.fill);
    const m = first.matrix;
    if (
      !words ||
      !fill ||
      values.some((v) => v.composite !== 'source-over' || v.font !== first.font || v.fill !== first.fill)
    )
      continue;
    const itemIndex = content.items.findIndex(
      (item, i) => !usedItems.has(i) && 'str' in item && item.str === words,
    );
    const item = content.items[itemIndex];
    let size: number, textWidth: number, x: number, y: number;
    if (item && 'str' in item) {
      const a = matrixOf(base.transform),
        b = matrixOf(item.transform);
      const tx: Matrix = [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
      ];
      if (Math.abs(tx[1]) > 0.001 || Math.abs(tx[2]) > 0.001 || tx[0] <= 0) continue;
      size = Math.hypot(tx[2], tx[3]);
      textWidth = item.width;
      x = tx[4];
      y = tx[5] - size * (content.styles[item.fontName]?.ascent ?? 0.8);
      usedItems.add(itemIndex);
    } else {
      if (
        !px ||
        first.method !== 'fillText' ||
        Math.abs(m[1]) > 0.001 ||
        Math.abs(m[2]) > 0.001 ||
        m[0] <= 0 ||
        m[3] <= 0
      )
        continue;
      size = (Number(px[1]) * Math.hypot(m[2], m[3])) / scale;
      textWidth = (last.at[0] + last.width - first.at[0]) / scale;
      x = first.at[0] / scale;
      y = first.at[1] / scale - size * 0.8;
    }
    if (size < 1 || size > 1000 || textWidth <= 0) continue;
    const frame = { x, y, width: textWidth + 1, height: size * 1.2 };
    // Allow text fully inside a rectangular clip; keep possible cropped ink in the source picture.
    const margin = size / 4;
    if (
      values.some(
        ({ clip }) =>
          clip === null ||
          (clip !== undefined &&
            (x - margin < clip[0] ||
              y - margin < clip[1] ||
              x + frame.width + margin > clip[2] ||
              y + frame.height + margin > clip[3])),
      )
    )
      continue;
    native.set(index, {
      id: `pdf-text-${index}`,
      kind: 'text',
      text: words,
      lang: null,
      frame,
      style: {
        fontFamily: 'Noto Sans',
        fontSize: size,
        fontWeight: /bold|[6-9]00/u.test(first.font) ? 700 : 400,
        color: fill,
        align: 'left',
        verticalAlign: 'top',
        lineHeight: 1,
        shadow: false,
      },
      ...(/italic|oblique/u.test(first.font) ? { runs: [{ text: words, italic: true }] } : {}),
      ...(first.alpha < 1 ? { opacity: first.alpha } : {}),
    });
  }
  if (painted.size > 500)
    throw new Error('This page has too many separately painted objects to edit safely.');
  if (hasEffects && (painted.size - native.size) * width * height > MAX_EFFECT_RASTER_PIXELS)
    throw new Error('This page has too much clipped or masked paint to edit safely.');
  const elements: SlideElement[] = [],
    assets: EditablePdfPage['assets'] = [];
  for (const index of [...painted].sort((a, b) => a - b)) {
    await control.checkpoint?.();
    const text = native.get(index);
    if (text) {
      elements.push(text);
      continue;
    }
    const target = await render(new Set([index]));
    try {
      const pixels = target.context.getImageData(0, 0, width, height).data;
      let left = width,
        top = height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4 + 3] === 0) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      if (right < left || bottom < top) continue;
      const crop = factory.create(right - left + 1, bottom - top + 1);
      try {
        crop.context.drawImage(
          target.canvas,
          left,
          top,
          crop.canvas.width,
          crop.canvas.height,
          0,
          0,
          crop.canvas.width,
          crop.canvas.height,
        );
        const id = `pdf-paint-${index}`;
        const png = await pngOf(crop.canvas);
        assetBytes += png.byteLength;
        if (assetBytes > (control.maxAssetBytes ?? Infinity))
          throw new Error('This page exceeds the editable object byte limit.');
        assets.push({ id, png });
        elements.push({
          id,
          kind: 'image',
          mediaId: id,
          fit: 'stretch',
          frame: {
            x: left / scale,
            y: top / scale,
            width: crop.canvas.width / scale,
            height: crop.canvas.height / scale,
          },
        });
      } finally {
        factory.destroy(crop);
      }
    } finally {
      factory.destroy(target);
    }
  }
  if (hasEffects && assets.length)
    issues.push('Clipped or masked graphics stay as pictures. You can move or remove those pictures.');
  if (assets.length && [...groupedWords].some((index) => !native.has(index)))
    issues.push(
      'Words drawn in PDF transparency groups stay in pictures. Add a text box to write new words.',
    );
  if (
    [...painted].some(
      (index) => show.has(list.fnArray[index]) && !native.has(index) && !groupedWords.has(index),
    )
  )
    issues.push(
      'Some clipped, rotated, outlined or unusual-font text stays as a separate picture. It can be moved or removed, but its words cannot be retyped.',
    );
  if (
    !hasEffects &&
    [...painted].some((index) => list.fnArray[index] === ops['constructPath'] && !native.has(index))
  )
    issues.push(
      'Some stroked or complex source drawings stay as separate pictures. They can be moved or removed; their control points cannot be edited.',
    );
  return { width: base.width, height: base.height, elements, assets, issues };
}
