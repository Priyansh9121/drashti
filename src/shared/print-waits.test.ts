import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState, type MessageItem } from './engine/state';
import { printWaits } from './print-waits';

/*
 * When the three printers (the Manual, a playlist's running order, a kirtan's words) wait (alpha.22; the lead's yes to
 * a22-review-print S1): the Manual's rule (anything up, the stream on air or recording) and, since Cue, a video waiting
 * at Cue or going out in a crossfade, whose Go a hidden printing page must never cost a frame (as a save waits:
 * shared/save-waits.ts). The main process asks this one test for all three.
 */

type Cue = NonNullable<EngineState['videoCue']>;
type Start = NonNullable<EngineState['videoStart']>;
type Fade = NonNullable<EngineState['videoCrossfade']>;

describe('printWaits', () => {
  const idle = initialEngineState();

  it('lets a print go only with nothing up, nothing waiting at Cue, and the stream not in use', () => {
    expect(printWaits(idle, false)).toBe(false);
    expect(printWaits({ ...idle, layers: { ...idle.layers, messages: [{} as MessageItem] } }, false)).toBe(
      true,
    );
    expect(printWaits(idle, true)).toBe(true);
  });

  it('waits while a video waits at Cue, its Go’s files are held, or one goes out in a crossfade, with nothing up', () => {
    expect(printWaits({ ...idle, videoCue: { id: 'placeholder' } as unknown as Cue }, false)).toBe(true);
    expect(printWaits({ ...idle, videoStart: { id: 'placeholder' } as unknown as Start }, false)).toBe(true);
    expect(printWaits({ ...idle, videoCrossfade: { id: 'placeholder' } as unknown as Fade }, false)).toBe(
      true,
    );
    expect(printWaits({ ...idle, videoCue: null, videoStart: null, videoCrossfade: null }, false)).toBe(
      false,
    );
  });

  it('waits when the show’s state is not known yet: the safe side', () => {
    expect(printWaits(null, false)).toBe(true);
    expect(printWaits(undefined, false)).toBe(true);
  });
});
