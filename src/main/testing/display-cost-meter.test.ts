import { expect, it } from 'vitest';
import { droppedFrames, macDropVerdict, nativeCostPair } from '../../../tests/e2e/display-cost-meter';
import { DISPLAY_COST_REPLAYS } from './display-cost-replay-fixture';

for (const replay of DISPLAY_COST_REPLAYS) {
  it(replay.name, () => {
    const actual = replay.pairs.map((pair) => nativeCostPair(pair.control, pair.imported).worse);
    const expectedEither = replay.expectedNativeWorse.map(
      (native, index) => native || replay.originalCallbackWorse[index],
    );
    expect(actual).toEqual(expectedEither);
  });
}

it('refuses absent native evidence instead of substituting capture callback arrival', () => {
  const pair = DISPLAY_COST_REPLAYS[0].pairs[0];
  expect(() => nativeCostPair({ main: pair.control.main }, { main: pair.imported.main })).toThrow(
    'Native presentation evidence is missing.',
  );
});

// QA22-L8-3 B (the owner, 24 Nov 2026): on the Mac the cost test is judged by the hall's dropped presented frames,
// import trials against control trials, in the dissolve's first second and after it.
it('counts the dropped presented frames of a trial, split at the first second of the dissolve', () => {
  const period = 1000 / 60;
  // 20 frames on time, one frame missed (a 2-period gap) at 300 ms, 60 on time, two missed at 1.5 s.
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < 20; i++) times.push((t += period));
  times.push((t += 2 * period));
  while (t < 1500) times.push((t += period));
  times.push((t += 3 * period));
  for (let i = 0; i < 30; i++) times.push((t += period));
  expect(droppedFrames(times, 0)).toEqual({ first: 1, after: 1 });
});

// Recorded per trial on CI's Mac ([first second, after]): imports and controls of one attempt each.
const trials = (imports: [number, number][], controls: [number, number][]) => [
  ...imports.map(([first, after]) => ({ importing: true, dropped: { first, after } })),
  ...controls.map(([first, after]) => ({ importing: false, dropped: { first, after } })),
];

it('fails an import that dropped more frames: L8 before its worker waited for the dissolve (5e86c44f)', () => {
  // lead-1123-113215-2365, its fifth attempt: the import's worker process started during the dissolve.
  const verdict = macDropVerdict(trials([[14, 8], [6, 5], [5, 27]], [[3, 4], [1, 8], [1, 13]]));
  expect(verdict).toMatchObject({ importFirst: 25, controlFirst: 5, firstWorse: true, worse: true });
});

it('passes imports that drop no more than the controls within the margin: recorded L8 attempts', () => {
  // a22-l8-1124-012539-84279's first attempt, failed by the renderer-frame meter: the import dropped fewer frames.
  expect(macDropVerdict(trials([[6, 29], [9, 8], [4, 25]], [[12, 35], [6, 16], [8, 19]])).worse).toBe(false);
  // a22-l8-1123-222251-24517's first attempt, the largest import excess on record in a first second (15 vs 2).
  expect(macDropVerdict(trials([[6, 8], [4, 6], [5, 13]], [[1, 4], [0, 4], [1, 7]])).worse).toBe(false);
});
