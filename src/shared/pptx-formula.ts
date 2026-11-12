/*
 * PowerPoint's own formulas for where a shape is and how big while an effect runs (ECMA-376 Part 1 §19.5: an
 * animation's values, such as Basic Zoom Out's "(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*#ppt_w"). Drashti reads the
 * part PowerPoint's own effects use: numbers, + − × ÷ and ^, brackets, min, max, abs and sqrt, and the shape's own
 * place and size: #ppt_x and #ppt_y (its centre) and #ppt_w and #ppt_h, all shares of the slide. Anything else is not
 * read. A formula is read once and kept; working it out at a frame is a few sums, never eval.
 */

/** A shape's centre and size, as shares of the slide (PowerPoint's #ppt_x, #ppt_y, #ppt_w and #ppt_h). */
export interface ShapePlace {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PptxFormula = (place: ShapePlace) => number;

/** The longest formula Drashti reads (PowerPoint's own are under 60 characters). */
export const FORMULA_LENGTH = 200;
const DEPTH = 32;
const FUNCTIONS: Record<string, (values: number[]) => number> = {
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  abs: ([value = Number.NaN]) => Math.abs(value),
  sqrt: ([value = Number.NaN]) => Math.sqrt(value),
};
const ARGUMENTS: Record<string, [number, number]> = { min: [1, 8], max: [1, 8], abs: [1, 1], sqrt: [1, 1] };

const read = new Map<string, PptxFormula | null>();

/** A formula as a way to work it out for a shape's place, or null when Drashti does not read it. */
export function pptxFormula(text: string): PptxFormula | null {
  const known = read.get(text);
  if (known !== undefined) return known;
  const formula = parse(text);
  // Only what could be a formula is kept: a deck's longer text is never held on to.
  if (text.length > FORMULA_LENGTH) return formula;
  if (read.size >= 256) read.clear();
  read.set(text, formula);
  return formula;
}

class Unread extends Error {}

function parse(text: string): PptxFormula | null {
  if (text.length === 0 || text.length > FORMULA_LENGTH) return null;
  let at = 0;
  const next = (): string | undefined => {
    while (text[at] === ' ') at++;
    return text[at];
  };
  const take = (what: string) => {
    if (next() !== what) throw new Unread();
    at++;
  };

  const sum = (depth: number): PptxFormula => {
    if (depth > DEPTH) throw new Unread();
    let left = product(depth);
    for (let sign = next(); sign === '+' || sign === '-'; sign = next()) {
      at++;
      const a = left;
      const b = product(depth);
      left = sign === '+' ? (place) => a(place) + b(place) : (place) => a(place) - b(place);
    }
    return left;
  };
  const product = (depth: number): PptxFormula => {
    let left = power(depth);
    for (let sign = next(); sign === '*' || sign === '/'; sign = next()) {
      at++;
      const a = left;
      const b = power(depth);
      left = sign === '*' ? (place) => a(place) * b(place) : (place) => a(place) / b(place);
    }
    return left;
  };
  const power = (depth: number): PptxFormula => {
    const base = signed(depth);
    if (next() !== '^') return base;
    at++;
    const exponent = power(depth + 1);
    return (place) => base(place) ** exponent(place);
  };
  const signed = (depth: number): PptxFormula => {
    if (depth > DEPTH) throw new Unread();
    const sign = next();
    if (sign !== '+' && sign !== '-') return single(depth);
    at++;
    const inner = signed(depth + 1);
    return sign === '-' ? (place) => -inner(place) : inner;
  };
  const single = (depth: number): PptxFormula => {
    next();
    const rest = text.slice(at);
    const variable = /^#ppt_([xywh])/u.exec(rest)?.[1] as keyof ShapePlace | undefined;
    if (variable) {
      at += 6;
      return (place) => place[variable];
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iu.exec(rest)?.[0];
    if (number) {
      at += number.length;
      const value = Number(number);
      return () => value;
    }
    if (rest.startsWith('(')) {
      at++;
      const inner = sum(depth + 1);
      take(')');
      return inner;
    }
    const name = /^([a-z]+)\(/u.exec(rest)?.[1];
    // Only the functions' own names: never one every object has (`constructor`), which a deck could write.
    const known = name !== undefined && Object.hasOwn(FUNCTIONS, name) && Object.hasOwn(ARGUMENTS, name);
    const work = known ? FUNCTIONS[name] : undefined;
    const [fewest, most] = (known ? ARGUMENTS[name] : undefined) ?? [0, 0];
    if (!name || !work) throw new Unread();
    at += name.length + 1;
    const values = [sum(depth + 1)];
    while (next() === ',') {
      at++;
      values.push(sum(depth + 1));
    }
    take(')');
    if (values.length < fewest || values.length > most) throw new Unread();
    return (place) => work(values.map((value) => value(place)));
  };

  try {
    const formula = sum(0);
    return next() === undefined ? formula : null;
  } catch (error) {
    if (error instanceof Unread) return null;
    throw error;
  }
}
