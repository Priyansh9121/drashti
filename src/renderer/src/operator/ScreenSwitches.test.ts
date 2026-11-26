import { describe, expect, it } from 'vitest';
import { SWITCH_STILL, switchButton, switchLook } from './ScreenSwitches';

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

  it('look quiet in the top bar’s group while on (alpha.24, uitop): no box, a small dot in the success colour beside its name and On; off, the warning’s box and dot, with Off', () => {
    expect(switchLook(true)).toEqual({ variant: 'ghost', dot: 'bg-success', word: 'On' });
    expect(switchLook(false)).toEqual({ variant: 'warning', dot: 'bg-warning', word: 'Off' });
  });

  it('never move in any interface motion, as they change the hall’s screens (uimotion’s review): no lift, no press, no fade, yet no show control, as the header’s gradient may never lie under one', () => {
    const classes = SWITCH_STILL.split(' ');
    // Important, so they hold over the motion rules (unlayered, by data-variant) as over the button's own fade.
    expect(classes).toEqual(
      expect.arrayContaining(['translate-none!', 'transform-none!', 'transition-none!']),
    );
    expect(classes.every((c) => c.endsWith('!'))).toBe(true);
  });
});
