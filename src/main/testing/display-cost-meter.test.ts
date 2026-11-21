import { expect, it } from 'vitest';
import { nativeCostPair } from '../../../tests/e2e/display-cost-meter';
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
