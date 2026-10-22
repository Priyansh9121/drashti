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

  it('names another app’s window that was showing, and says it was not put back (Session 48)', () => {
    expect(
      recoveryText({
        ...notice,
        slide: { presentationName: 'Placeholder Hymn', slideNumber: 3 },
        window: 'Placeholder meeting',
      }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: "Placeholder Hymn", slide 3. The window “Placeholder meeting” was on the screens and was not put back, as it may be gone: Show a Window… shows it again.',
    );
    expect(recoveryText({ ...notice, window: 'Placeholder meeting' })).toBe(
      'Drashti stopped unexpectedly. The window “Placeholder meeting” was on the screens and was not put back, as it may be gone: Show a Window… shows it again.',
    );
    // A stop too long ago: named with the rest of what was live (nothing went back anyway).
    expect(
      recoveryText({
        ...notice,
        savedAt: new Date(2026, 9, 9, 18, 34).toISOString(),
        putBack: false,
        window: 'Placeholder meeting',
      }),
    ).toBe(
      'Drashti stopped unexpectedly on Fri 9 Oct at 18:34, 3 hours or more before it started again, so nothing was put back on the screens. What was live then: the window “Placeholder meeting”.',
    );
  });

  it('names the picture-in-picture box put back, and a window that was in it and was not (Session 50)', () => {
    expect(recoveryText({ ...notice, lowerThird: true, pip: true, timers: 1 })).toBe(
      'Drashti stopped unexpectedly and has put back what was live: the lower third, the picture-in-picture box and a timer.',
    );
    expect(
      recoveryText({
        ...notice,
        background: true,
        window: 'Placeholder slides app',
        pipWindow: 'Placeholder meeting',
      }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: the background. The window “Placeholder slides app” was on the screens and was not put back, as it may be gone: Show a Window… shows it again. The window “Placeholder meeting” was in the picture-in-picture box and was not put back, as it may be gone.',
    );
    // A stop too long ago: named with the rest of what was live.
    const savedAt = new Date(2026, 9, 9, 18, 34).toISOString();
    expect(recoveryText({ ...notice, savedAt, putBack: false, pip: true })).toBe(
      'Drashti stopped unexpectedly on Fri 9 Oct at 18:34, 3 hours or more before it started again, so nothing was put back on the screens. What was live then: the picture-in-picture box.',
    );
    expect(recoveryText({ ...notice, savedAt, putBack: false, pipWindow: 'Placeholder meeting' })).toBe(
      'Drashti stopped unexpectedly on Fri 9 Oct at 18:34, 3 hours or more before it started again, so nothing was put back on the screens. What was live then: the window “Placeholder meeting” in the picture-in-picture box.',
    );
  });

  it('names a video input put back, and one that was not there after the restart (Session 50)', () => {
    expect(
      recoveryText({
        ...notice,
        slide: { presentationName: 'Placeholder Hymn', slideNumber: 3 },
        input: 'Placeholder input',
      }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: "Placeholder Hymn", slide 3 and the video input “Placeholder input”.',
    );
    expect(
      recoveryText({
        ...notice,
        slide: { presentationName: 'Placeholder Hymn', slideNumber: 3 },
        inputGone: 'Placeholder input',
      }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: "Placeholder Hymn", slide 3. The video input “Placeholder input” was not there after the restart, so it was not put back.',
    );
    expect(recoveryText({ ...notice, inputGone: 'Placeholder input' })).toBe(
      'Drashti stopped unexpectedly. The video input “Placeholder input” was not there after the restart, so it was not put back.',
    );
    // A stop too long ago: named with the rest of what was live.
    expect(
      recoveryText({
        ...notice,
        savedAt: new Date(2026, 9, 9, 18, 34).toISOString(),
        putBack: false,
        input: 'Placeholder input',
      }),
    ).toBe(
      'Drashti stopped unexpectedly on Fri 9 Oct at 18:34, 3 hours or more before it started again, so nothing was put back on the screens. What was live then: the video input “Placeholder input”.',
    );
  });

  it('names a video input in the picture-in-picture box that was not there after the restart: the box was not put back (Session 51)', () => {
    expect(
      recoveryText({
        ...notice,
        slide: { presentationName: 'Placeholder Hymn', slideNumber: 3 },
        pipInputGone: 'Placeholder input',
      }),
    ).toBe(
      'Drashti stopped unexpectedly and has put back what was live: "Placeholder Hymn", slide 3. The video input “Placeholder input” in the picture-in-picture box was not there after the restart, so the box was not put back.',
    );
    expect(recoveryText({ ...notice, pipInputGone: 'Placeholder input' })).toBe(
      'Drashti stopped unexpectedly. The video input “Placeholder input” in the picture-in-picture box was not there after the restart, so the box was not put back.',
    );
    // The background's input and the box's, neither there: each is named.
    expect(
      recoveryText({ ...notice, inputGone: 'Placeholder input', pipInputGone: 'Placeholder mixer' }),
    ).toBe(
      'Drashti stopped unexpectedly. The video input “Placeholder input” was not there after the restart, so it was not put back. The video input “Placeholder mixer” in the picture-in-picture box was not there after the restart, so the box was not put back.',
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
