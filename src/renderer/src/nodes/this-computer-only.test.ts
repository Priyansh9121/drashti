import { describe, expect, it } from 'vitest';
import { thisComputerOnly } from './this-computer-only';

/*
 * The screens dashboard says what the nodes' screens cannot show, being other computers: another app's window
 * (Session 48) and a video input (Session 50) are on this computer only.
 */

describe('what only this computer’s screens show', () => {
  it('names a video input up now', () => {
    expect(
      thisComputerOnly({
        kind: 'input',
        inputId: 'i1',
        name: 'Placeholder input',
        device: 'fake_device_0',
        fit: 'fit',
        startedAt: 1,
      }),
    ).toEqual({
      kind: 'input',
      text: 'The video input “Placeholder input” shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.',
    });
  });

  it('names a window as before, and nothing for what the nodes show too', () => {
    expect(
      thisComputerOnly({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting', startedAt: 1 }),
    ).toEqual({
      kind: 'window',
      text: 'The window “Placeholder meeting” shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.',
    });
    expect(thisComputerOnly(null)).toBeNull();
    expect(thisComputerOnly(undefined)).toBeNull();
    expect(
      thisComputerOnly({
        kind: 'media',
        mediaId: 'm',
        media: 'image',
        fit: 'fit',
        loop: false,
        startedAt: 1,
      }),
    ).toBeNull();
  });
});
