import { describe, expect, it } from 'vitest';
import type { MediaLayer, Slots } from './background-slots';
import { NO_SLOTS, slotKey, slotsReducer } from './background-slots';

const video = (mediaId: string, startedAt: number, extra: Partial<MediaLayer> = {}): MediaLayer => ({
  kind: 'media',
  mediaId,
  media: 'video',
  fit: 'fill',
  loop: true,
  startedAt,
  ...extra,
});

const run = (...events: Parameters<typeof slotsReducer>[1][]): Slots => events.reduce(slotsReducer, NO_SLOTS);
const onScreen = (s: Slots) => (s.shown?.state === 'ready' ? s.shown.key : null);

describe('background slots', () => {
  const a = video('A', 1);
  const b = video('B', 2);
  const c = video('C', 3);

  it('shows nothing until the first background has its first frame', () => {
    const s = run({ type: 'layer', layer: a });
    expect(onScreen(s)).toBeNull();
    expect(s.incoming?.key).toBe(slotKey(a));
    expect(onScreen(slotsReducer(s, { type: 'ready', key: slotKey(a) }))).toBe(slotKey(a));
  });

  it('keeps the old background on screen until the new one is ready', () => {
    let s = run({ type: 'layer', layer: a }, { type: 'ready', key: slotKey(a) }, { type: 'layer', layer: b });
    expect(onScreen(s)).toBe(slotKey(a));
    expect(s.incoming).toMatchObject({ key: slotKey(b), state: 'loading' });
    s = slotsReducer(s, { type: 'ready', key: slotKey(b) });
    expect(onScreen(s)).toBe(slotKey(b));
    expect(s.incoming).toBeNull();
  });

  it('drops a background that was still loading when another replaced it', () => {
    const s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: b },
      { type: 'layer', layer: c },
      // B finishing late changes nothing.
      { type: 'ready', key: slotKey(b) },
    );
    expect(onScreen(s)).toBe(slotKey(a));
    expect(s.incoming?.key).toBe(slotKey(c));
  });

  it('keeps the same playback when only its settings change, and forgets what was loading', () => {
    const s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: b },
      { type: 'layer', layer: { ...a, fit: 'fit', loop: false } },
    );
    expect(s.shown).toMatchObject({ key: slotKey(a), state: 'ready', layer: { fit: 'fit', loop: false } });
    expect(s.incoming).toBeNull();
  });

  it('clears at once for Clear background or a colour', () => {
    const shown = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: b },
    );
    expect(slotsReducer(shown, { type: 'layer', layer: null })).toEqual(NO_SLOTS);
    expect(slotsReducer(shown, { type: 'layer', layer: { kind: 'color', color: '#000000' } })).toEqual(
      NO_SLOTS,
    );
  });

  it('replaces the old picture with nothing when the new file cannot play', () => {
    let s = run({ type: 'layer', layer: a }, { type: 'ready', key: slotKey(a) }, { type: 'layer', layer: b });
    s = slotsReducer(s, { type: 'failed', key: slotKey(b) });
    expect(onScreen(s)).toBeNull();
    expect(s.shown).toMatchObject({ key: slotKey(b), state: 'failed' });
    // A playing background that fails shows nothing either; the next one loads as usual.
    s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'failed', key: slotKey(a) },
    );
    expect(onScreen(s)).toBeNull();
    s = slotsReducer(s, { type: 'layer', layer: c });
    expect(s).toEqual({ shown: null, incoming: { key: slotKey(c), layer: c, state: 'loading' } });
  });

  it('treats the same file started again as a new playback', () => {
    const again = video('A', 9);
    const s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: again },
    );
    expect(onScreen(s)).toBe(slotKey(a));
    expect(s.incoming?.key).toBe(slotKey(again));
  });
});
