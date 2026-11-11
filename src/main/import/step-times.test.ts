import { describe, expect, it } from 'vitest';
import { STEPS_LINE, StepTimes, stepsLine } from './step-times';

/*
 * Where a deck's or a PDF's import spends its time (Session 56): each step added up over the file, in the steps'
 * order, in one log line the timing check reads back.
 */

describe('an import’s step times', () => {
  it('add each step up, list only those that took any time, in the steps’ order, with the whole file’s time', async () => {
    const times = new StepTimes();
    times.add('cut', 1200.4);
    times.add('original', 30);
    times.add('app', 500);
    times.add('app', 250.6);
    await times.time('write', () => new Promise((resolve) => setTimeout(resolve, 20)));
    const { steps, totalMs } = times.summary();
    expect(Object.keys(steps)).toEqual(['original', 'app', 'cut', 'write']);
    expect(steps.app).toBe(751);
    expect(steps.cut).toBe(1200);
    expect(steps.write).toBeGreaterThanOrEqual(15);
    expect(totalMs).toBeGreaterThanOrEqual(steps.write ?? 0);
  });

  it('count a step that fails too', async () => {
    const times = new StepTimes();
    await expect(
      times.time('pictures', () => new Promise((_, reject) => setTimeout(() => reject(new Error('no')), 10))),
    ).rejects.toThrow('no');
    expect(times.summary().steps.pictures).toBeGreaterThanOrEqual(5);
  });

  it('make one log line the timing check reads back', () => {
    const times = new StepTimes();
    times.add('movie', 4000);
    const line = stepsLine({ name: 'Placeholder deck 6.pptx', kind: 'pptx', slides: 6, how: 'baked' }, times);
    expect(line.startsWith(STEPS_LINE)).toBe(true);
    expect(JSON.parse(line.slice(STEPS_LINE.length))).toMatchObject({
      name: 'Placeholder deck 6.pptx',
      kind: 'pptx',
      slides: 6,
      how: 'baked',
      steps: { movie: 4000 },
    });
  });
});
