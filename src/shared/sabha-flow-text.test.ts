import { describe, expect, it } from 'vitest';
import { flowRulesOf, flowTextPageSchema, flowTextsOf } from './sabha-flow-text';

/*
 * Sabha flow (alpha.23): a page's text layer and borders as the pictures window takes them from pdf.js (here in
 * pdf.js's own shapes, by hand). What one odd run or one huge path does to the rest (review S4, S5).
 */

const viewport = { width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] };
const item = (str: string, x: number, y: number, width = 30) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
});

describe('a page’s runs of text', () => {
  it('leaves out a run far off the page or impossibly wide (S5): the page keeps the rest, and passes its check', () => {
    const texts = flowTextsOf(
      {
        items: [
          item('Placeholder', 40, 742),
          item('Far off', 250_000, 742),
          item('Wide', 40, 700, 300_000),
          item('Far down', 40, -150_000),
          item('Kept', 300, 742),
        ],
      },
      viewport,
    );
    expect(texts.map((t) => t.s)).toEqual(['Placeholder', 'Kept']);
    expect(flowTextPageSchema.safeParse({ width: 595, height: 842, texts, rules: [] }).success).toBe(true);
  });
});

describe('a page’s borders', () => {
  it('reads a filled path of 200,000 points without failing (S4): a long thin one is a border', () => {
    const points: number[] = [0, 40, 100];
    for (let k = 1; k < 200_000; k++) points.push(1, 40 + (k % 2 === 0 ? 0 : 400), 100 + (k % 3) * 0.1);
    const list = { fnArray: [91], argsArray: [[22, [new Float32Array(points)], null]] };
    const ops = { constructPath: 91, fill: 22, stroke: 20, save: 10, restore: 11, transform: 12 };
    expect(flowRulesOf(list, ops, viewport)).toEqual([
      {
        x0: 40,
        y0: expect.closeTo(742 - 0.1, 1) as unknown,
        x1: 440,
        y1: expect.closeTo(742 - 0.1, 1) as unknown,
      },
    ]);
  });
});
