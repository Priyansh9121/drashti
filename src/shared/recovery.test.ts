import { describe, expect, it } from 'vitest';
import { recoveryText } from './recovery';

const notice = {
  savedAt: '2026-09-29T10:00:00.000Z',
  slide: null,
  slideGone: false,
  background: false,
  blackout: false,
};

describe('the recovery notice', () => {
  it('says what went back on the screens', () => {
    expect(
      recoveryText({
        ...notice,
        slide: { presentationName: 'Placeholder Hymn', slideNumber: 3 },
        background: true,
        blackout: true,
      }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: "Placeholder Hymn", slide 3, the background and black-out.',
    );
    expect(recoveryText({ ...notice, background: true })).toBe(
      'Drashti stopped unexpectedly and has put back what was live: the background.',
    );
  });

  it('says when the live slide could not go back', () => {
    expect(recoveryText({ ...notice, slideGone: true, blackout: true })).toBe(
      'Drashti stopped unexpectedly and has put back what was live: black-out. The slide that was live is no longer in the library.',
    );
    expect(recoveryText({ ...notice, slideGone: true })).toBe(
      'Drashti stopped unexpectedly. The slide that was live is no longer in the library.',
    );
  });
});
