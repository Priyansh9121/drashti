import { describe, expect, it } from 'vitest';
import { switchButton } from './ScreenSwitches';

/*
 * The top bar's Audience and Stage (alpha.22, a22-review-stage S6): until the main process has said which are on,
 * neither can be pressed, so the bar never says Stage On and then flips to Off as a library with Stage kept off
 * starts. Placeholder state only.
 */

describe('the top bar’s Audience and Stage', () => {
  it('cannot be pressed until the main process has said which are on', () => {
    const before = { audience: true, stage: true };
    expect(switchButton('audience', before, false)).toEqual({ on: true, disabled: true });
    expect(switchButton('stage', before, false)).toEqual({ on: true, disabled: true });
  });

  it('can be pressed once it has, each saying On or Off as the main process says', () => {
    const now = { audience: true, stage: false };
    expect(switchButton('audience', now, true)).toEqual({ on: true, disabled: false });
    expect(switchButton('stage', now, true)).toEqual({ on: false, disabled: false });
  });
});
