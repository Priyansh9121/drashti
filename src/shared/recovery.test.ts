import { describe, expect, it } from 'vitest';
import { RECOVERY_MAX_AGE_MS, recoveryText, stoppedWhen } from './recovery';

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

  it('names the sound, props, messages, the stage message and timers', () => {
    expect(
      recoveryText({ ...notice, audio: true, props: 2, messages: 1, stageMessage: true, timers: 3 }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: the sound, 2 props, a message, the stage message and 3 timers.',
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

  it('after a stop too long ago, says what was live and when, and that nothing went back (Session 20)', () => {
    expect(RECOVERY_MAX_AGE_MS).toBe(3 * 60 * 60 * 1000);
    // Made from the computer's own time, so it reads 18:34 wherever the test runs.
    const savedAt = new Date(2026, 9, 9, 18, 34).toISOString();
    expect(stoppedWhen(savedAt)).toBe('on Fri 9 Oct at 18:34');
    expect(
      recoveryText({
        ...notice,
        savedAt,
        putBack: false,
        slide: { presentationName: 'Placeholder Hymn', slideNumber: 3 },
        blackout: true,
      }),
    ).toBe(
      'Drashti stopped unexpectedly on Fri 9 Oct at 18:34, 3 hours or more before it started again, so nothing was put back on the screens. What was live then: "Placeholder Hymn", slide 3 and black-out.',
    );
    expect(recoveryText({ ...notice, savedAt: 'not a time', putBack: false, slideGone: true })).toBe(
      'Drashti stopped unexpectedly at a time it cannot tell, so nothing was put back on the screens. The slide that was live is no longer in the library.',
    );
  });
});
