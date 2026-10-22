import { describe, expect, it } from 'vitest';
import type { PipLayer, PipSource } from '../../../shared/engine/state';
import { boxThisComputerOnly, thisComputerOnly } from './this-computer-only';

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

  // Session 50, section 8: a video input or a window in the picture-in-picture box is on this computer only too;
  // a box of media or the slides shows on the nodes as well.
  it('names a video input or a window in the picture-in-picture box, and nothing for media or the slides', () => {
    const box = (source: PipSource): PipLayer => ({
      source,
      place: {
        corner: 'bottom-right' as const,
        x: 0,
        y: 0,
        size: 'medium' as const,
        border: true,
        rounded: true,
        motion: 'fade' as const,
      },
      swapped: false,
      shownAt: 1,
    });
    expect(
      boxThisComputerOnly(
        box({ kind: 'input', inputId: 'i1', name: 'Placeholder input', device: 'fake_device_0' }),
      ),
    ).toEqual({
      kind: 'input',
      text: 'The video input “Placeholder input” in the picture-in-picture box shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.',
    });
    expect(
      boxThisComputerOnly(box({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting' })),
    ).toEqual({
      kind: 'window',
      text: 'The window “Placeholder meeting” in the picture-in-picture box shows on this computer’s screens only: the nodes’ screens show the rest of the show without it.',
    });
    expect(boxThisComputerOnly(box({ kind: 'slides' }))).toBeNull();
    expect(boxThisComputerOnly(box({ kind: 'media', mediaId: 'm', media: 'video' }))).toBeNull();
    expect(boxThisComputerOnly(null)).toBeNull();
  });
});
