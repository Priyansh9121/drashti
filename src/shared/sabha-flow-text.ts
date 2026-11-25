import { z } from 'zod';
import { cutText } from './text';

/*
 * Sabha flow (alpha.23): what the reader needs of a PDF page, taken from pdf.js in the hidden pictures window (and, in
 * the tests, from the same pdf.js in Node): the page's words where they stand, and its straight lines (a table's
 * borders), both in the page's own points with y downwards (the page as it shows, its rotation applied). Nothing is
 * guessed from the picture: no OCR.
 */

/** One run of text as pdf.js gives it: its words, left edge, baseline, width and font height (page points). */
export interface FlowText {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A straight line drawn on the page, across (y0 = y1) or down (x0 = x1): a table border, as stroked or filled. */
export interface FlowRule {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FlowTextPage {
  width: number;
  height: number;
  texts: FlowText[];
  rules: FlowRule[];
}

/** At most this many runs of text and lines are kept from one page. */
export const FLOW_PAGE_LIMITS = { texts: 8000, rules: 8000, chars: 2000 } as const;

const coord = z.number().min(-100000).max(100000);
export const flowTextPageSchema: z.ZodType<FlowTextPage> = z.object({
  width: z.number().min(1).max(100000),
  height: z.number().min(1).max(100000),
  texts: z
    .array(
      z.object({
        s: z.string().max(FLOW_PAGE_LIMITS.chars),
        x: coord,
        y: coord,
        w: z.number().min(0).max(100000),
        h: z.number().min(0).max(100000),
      }),
    )
    .max(FLOW_PAGE_LIMITS.texts),
  rules: z.array(z.object({ x0: coord, y0: coord, x1: coord, y1: coord })).max(FLOW_PAGE_LIMITS.rules),
});

type Matrix = [number, number, number, number, number, number];

/** pdf.js's own product of two matrices (Util.transform): m2 first, then m1. */
function times(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function matrixOf(value: unknown): Matrix | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const list = Array.from(value as ArrayLike<unknown>);
  if (list.length !== 6 || !list.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return list as Matrix;
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** What the reader needs of pdf.js's viewport at scale 1: its size and its transform (rotation and y downwards). */
export interface FlowViewport {
  width: number;
  height: number;
  transform: readonly number[];
}

/** What the reader needs of pdf.js's getTextContent(). */
export interface FlowTextContent {
  items: readonly unknown[];
}

/**
 * The page's runs of text, from getTextContent() and the viewport at scale 1. Only upright text (a table's words);
 * text turned on its side is left out.
 */
export function flowTextsOf(content: FlowTextContent, viewport: FlowViewport): FlowText[] {
  const view = matrixOf(viewport.transform);
  if (!view) return [];
  const texts: FlowText[] = [];
  for (const raw of content.items) {
    if (texts.length >= FLOW_PAGE_LIMITS.texts) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { str?: unknown; transform?: unknown; width?: unknown };
    if (typeof item.str !== 'string' || item.str === '') continue;
    const tm = matrixOf(item.transform);
    if (!tm) continue;
    const tx = times(view, tm);
    const h = Math.hypot(tx[2], tx[3]);
    if (!(h > 0)) continue;
    // Upright: no turn, and y downwards in the viewport.
    if (Math.abs(tx[1]) > 0.02 * h || Math.abs(tx[2]) > 0.02 * h || tx[0] <= 0 || tx[3] >= 0) continue;
    const width = typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : 0;
    texts.push({
      s: cutText(item.str, FLOW_PAGE_LIMITS.chars),
      x: tx[4],
      y: tx[5],
      w: Math.max(0, width),
      h,
    });
  }
  return texts;
}

/** pdf.js's operator numbers the lines are read by (its OPS). */
export type FlowOps = Readonly<Record<string, number>>;

/** What the reader needs of pdf.js's getOperatorList(). */
export interface FlowOperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** A line is at most this thick (points) to be a border; anything thicker is a shape. */
const THIN = 2.5;
/** And at least this long. */
const LONG = 2;

/** pdf.js's packed path (v6): 0 moveTo x y, 1 lineTo x y, 2 curveTo 6 numbers, 3 quadraticCurveTo 4, 4 closePath. */
function subpathsOf(data: ArrayLike<number>): [number, number][][] {
  const paths: [number, number][][] = [];
  let current: [number, number][] = [];
  const close = () => {
    if (current.length > 0) paths.push(current);
    current = [];
  };
  for (let i = 0; i < data.length;) {
    const op = data[i++];
    if (op === 0) {
      close();
      current.push([Number(data[i]), Number(data[i + 1])]);
      i += 2;
    } else if (op === 1) {
      current.push([Number(data[i]), Number(data[i + 1])]);
      i += 2;
    } else if (op === 2) {
      // A curve is no border: its end is kept, so the next straight piece starts where it ends.
      current.push([Number(data[i + 4]), Number(data[i + 5])]);
      current.push([Number.NaN, Number.NaN]);
      current.push([Number(data[i + 4]), Number(data[i + 5])]);
      i += 6;
    } else if (op === 3) {
      current.push([Number.NaN, Number.NaN]);
      current.push([Number(data[i + 2]), Number(data[i + 3])]);
      i += 4;
    } else if (op === 4) {
      const first = current[0];
      if (first) current.push([first[0], first[1]]);
    } else break;
  }
  close();
  return paths;
}

function packedPath(args: unknown): ArrayLike<number> | null {
  if (!Array.isArray(args)) return null;
  const wrapped: unknown = args[1];
  const data: unknown = Array.isArray(wrapped) ? wrapped[0] : wrapped;
  if (data instanceof Float32Array || data instanceof Float64Array) return data;
  if (Array.isArray(data) && data.every((n) => typeof n === 'number')) return data;
  return null;
}

/**
 * The page's straight lines (borders), from getOperatorList() and the viewport at scale 1: each stroked straight
 * piece across or down, and each thin filled rectangle (as Word draws a table's borders), in the viewport's points.
 */
export function flowRulesOf(list: FlowOperatorList, ops: FlowOps, viewport: FlowViewport): FlowRule[] {
  const view = matrixOf(viewport.transform);
  if (!view) return [];
  const stroking = new Set(
    ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map((name) => ops[name])
      .filter((n): n is number => typeof n === 'number'),
  );
  const filling = new Set(
    ['fill', 'eoFill', 'rawFillPath', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map((name) => ops[name])
      .filter((n): n is number => typeof n === 'number'),
  );
  const rules: FlowRule[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    if (rules.length >= FLOW_PAGE_LIMITS.rules) return;
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    const across = Math.abs(y1 - y0) <= THIN && Math.abs(x1 - x0) >= LONG;
    const down = Math.abs(x1 - x0) <= THIN && Math.abs(y1 - y0) >= LONG;
    if (across) {
      const y = (y0 + y1) / 2;
      rules.push({ x0: Math.min(x0, x1), y0: y, x1: Math.max(x0, x1), y1: y });
    } else if (down) {
      const x = (x0 + x1) / 2;
      rules.push({ x0: x, y0: Math.min(y0, y1), x1: x, y1: Math.max(y0, y1) });
    }
  };
  const count = list.fnArray.length;
  for (let index = 0; index < count; index++) {
    const fn = list.fnArray[index];
    const args = list.argsArray[index];
    if (fn === ops['save']) stack.push(ctm);
    else if (fn === ops['restore']) ctm = stack.pop() ?? ctm;
    else if (fn === ops['transform']) {
      const m = matrixOf(args);
      if (m) ctm = times(ctm, m);
    } else if (fn === ops['paintFormXObjectBegin']) {
      stack.push(ctm);
      const m = Array.isArray(args) ? matrixOf(args[0]) : null;
      if (m) ctm = times(ctm, m);
    } else if (fn === ops['paintFormXObjectEnd']) ctm = stack.pop() ?? ctm;
    else if (fn === ops['constructPath']) {
      const paint: unknown = Array.isArray(args) ? args[0] : undefined;
      if (typeof paint !== 'number' || (!stroking.has(paint) && !filling.has(paint))) continue;
      const data = packedPath(args);
      if (!data) continue;
      const toView = times(view, ctm);
      for (const path of subpathsOf(data)) {
        const points = path.map(([x, y]) => apply(toView, x, y));
        if (stroking.has(paint))
          for (let k = 1; k < points.length; k++) {
            const a = points[k - 1];
            const b = points[k];
            if (a && b) add(a[0], a[1], b[0], b[1]);
          }
        if (filling.has(paint)) {
          const solid = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
          if (solid.length < 3 || solid.length !== points.length) continue;
          const xs = solid.map(([x]) => x);
          const ys = solid.map(([, y]) => y);
          const left = Math.min(...xs);
          const right = Math.max(...xs);
          const top = Math.min(...ys);
          const bottom = Math.max(...ys);
          // A thin filled box is a line; a cell's shading is not.
          if (bottom - top <= THIN && right - left >= LONG)
            add(left, (top + bottom) / 2, right, (top + bottom) / 2);
          else if (right - left <= THIN && bottom - top >= LONG)
            add((left + right) / 2, top, (left + right) / 2, bottom);
        }
      }
    }
  }
  return rules;
}
