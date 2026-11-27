import { describe, expect, it } from 'vitest';
import type { InputBackground } from '../../../shared/engine/state';
import type { MediaLayer, Slots } from './background-slots';
import {
  drawnKeyOf,
  drawnOver,
  NO_SLOTS,
  retryAfterLanding,
  slotKey,
  slotsReducer,
} from './background-slots';

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
const after = (slots: Slots, ...events: Parameters<typeof slotsReducer>[1][]): Slots =>
  events.reduce(slotsReducer, slots);
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

  it('a video whose data is in is drawn over the one before, which stays until the video has been presented on the screen (alpha.20; CI x54-1121-023510-80364: shown on its data alone, the hall saw a black frame)', () => {
    let s = run({ type: 'layer', layer: a }, { type: 'ready', key: slotKey(a) }, { type: 'layer', layer: b });
    expect(s.incoming && drawnOver(s, s.incoming)).toBe(false);
    s = slotsReducer(s, { type: 'loaded', key: slotKey(b) });
    // Its data in: drawn over the one before, which is still on screen.
    expect(onScreen(s)).toBe(slotKey(a));
    expect(s.incoming).toMatchObject({ key: slotKey(b), state: 'loaded' });
    expect(s.incoming && drawnOver(s, s.incoming)).toBe(true);
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    // Presented: on screen, the one before gone.
    s = slotsReducer(s, { type: 'ready', key: slotKey(b) });
    expect(onScreen(s)).toBe(slotKey(b));
    expect(s.incoming).toBeNull();
    // Its data in again, or one no longer coming: nothing changes.
    expect(slotsReducer(s, { type: 'loaded', key: slotKey(b) })).toBe(s);
    expect(slotsReducer(s, { type: 'loaded', key: slotKey(c) })).toBe(s);
  });

  it('a video whose data is in while a dissolve is on screen is not drawn over it: it follows the dissolve', () => {
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: { ...b, fade: { at: 1000, durationMs: 800 } } },
      { type: 'ready', key: slotKey(b), at: 1100 },
    );
    expect(s.fade).not.toBeNull();
    s = slotsReducer(s, { type: 'layer', layer: c });
    s = slotsReducer(s, { type: 'loaded', key: slotKey(c) });
    expect(s.incoming).toMatchObject({ key: slotKey(c), state: 'loaded' });
    expect(s.incoming && drawnOver(s, s.incoming)).toBe(false);
    // The dissolve over: drawn over what is on screen, until it is presented.
    s = slotsReducer(s, { type: 'faded', start: s.fade?.start ?? 0 });
    expect(onScreen(s)).toBe(slotKey(b));
    expect(s.incoming && drawnOver(s, s.incoming)).toBe(true);
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

  it('keeps the picture before when the new file cannot play, and draws one that fails while it plays as it was until it is taken off (Q60-31)', () => {
    // A file that cannot play as it loads: the picture before stays drawn (the show takes the file off: Main is told).
    let s = run({ type: 'layer', layer: a }, { type: 'ready', key: slotKey(a) }, { type: 'layer', layer: b });
    s = slotsReducer(s, { type: 'failed', key: slotKey(b) });
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    expect(s.incoming).toMatchObject({ key: slotKey(b), state: 'failed' });
    // One that fails with nothing before it draws nothing (the screen's nothing-up shows meanwhile: Scene.tsx).
    expect(drawnKeyOf(run({ type: 'layer', layer: b }, { type: 'failed', key: slotKey(b) }))).toBeNull();
    // A playing background that fails stays drawn as it was until the show takes it off, never black meanwhile.
    s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'failed', key: slotKey(a) },
    );
    expect(s.shown).toMatchObject({ key: slotKey(a), state: 'failed', drawn: true });
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    expect(slotsReducer(s, { type: 'layer', layer: null })).toEqual(NO_SLOTS);
    // The next one loads as usual, the failed one drawn until it has its first frame.
    s = slotsReducer(s, { type: 'layer', layer: c });
    expect(s.incoming).toMatchObject({ key: slotKey(c), state: 'loading' });
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    expect(drawnKeyOf(slotsReducer(s, { type: 'ready', key: slotKey(c) }))).toBe(slotKey(c));
  });

  it('dissolves a background a dissolving slide brings, from when the slide began or when it is ready', () => {
    const faded = video('F', 100, { fade: { at: 100, durationMs: 1000 } });
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: faded },
    );
    // Ready straight away: from the slide's own start, so every screen is at the same point.
    s = slotsReducer(s, { type: 'ready', key: slotKey(faded), at: 90 });
    expect(s).toMatchObject({
      shown: { key: slotKey(faded) },
      leaving: { key: slotKey(a) },
      fade: { start: 100, ms: 1000 },
    });
    // Done: the old picture goes.
    s = slotsReducer(s, { type: 'faded', start: 100 });
    expect(s).toMatchObject({ shown: { key: slotKey(faded) }, leaving: null, fade: null });
    // Ready late: from then; too late (after the slide's fade): no dissolve at all.
    const late = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: faded },
    );
    expect(slotsReducer(late, { type: 'ready', key: slotKey(faded), at: 600 }).fade).toEqual({
      start: 600,
      ms: 1000,
    });
    expect(slotsReducer(late, { type: 'ready', key: slotKey(faded), at: 2000 })).toMatchObject({
      leaving: null,
      fade: null,
    });
  });

  it('dissolves a dissolving slide’s background in over one that failed while it played, drawn as it was: never in from black (Q60-31)', () => {
    const faded = video('F', 100, { fade: { at: 100, durationMs: 1000 } });
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'failed', key: slotKey(a) },
      { type: 'layer', layer: faded },
    );
    // Drawn as it was meanwhile (the test above), until the new one is ready.
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    s = slotsReducer(s, { type: 'ready', key: slotKey(faded), at: 90 });
    // It goes as the new one comes, over the slide's dissolve, as a playing one does: nothing black under the new one.
    expect(s).toMatchObject({
      shown: { key: slotKey(faded), state: 'ready' },
      leaving: { key: slotKey(a), state: 'failed', drawn: true },
      fade: { start: 100, ms: 1000 },
    });
    expect(drawnKeyOf(s)).toBe(slotKey(faded));
    s = slotsReducer(s, { type: 'faded', start: 100 });
    expect(s).toMatchObject({ shown: { key: slotKey(faded) }, leaving: null, fade: null });
    // A video input that comes in over it dissolves in the same way (Session 50).
    const input: InputBackground = {
      kind: 'input',
      inputId: 'I',
      name: 'Placeholder input',
      device: 'fake_device_0',
      fit: 'fit',
      startedAt: 7,
    };
    s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'failed', key: slotKey(a) },
      { type: 'layer', layer: { ...input, fade: { at: 7, durationMs: 500 } } },
      { type: 'ready', key: slotKey(input), at: 50 },
    );
    expect(s).toMatchObject({ leaving: { key: slotKey(a), drawn: true }, fade: { start: 50, ms: 500 } });
  });

  it('a dissolve cut short by another background carries on to its end: never left part-way, dim (Session 23)', () => {
    const faded = video('F', 100, { fade: { at: 100, durationMs: 1000 } });
    const third = video('T', 500, { fade: { at: 500, durationMs: 1000 } });
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: faded },
      { type: 'ready', key: slotKey(faded), at: 100 },
      { type: 'layer', layer: third },
    );
    // The dissolve on screen goes on (both pictures add up to the whole), the third loads meanwhile.
    expect(s).toMatchObject({
      shown: { key: slotKey(faded) },
      leaving: { key: slotKey(a) },
      incoming: { key: slotKey(third), state: 'loading' },
      fade: { start: 100, ms: 1000 },
    });
    // Ready before that dissolve is over: it waits for it (no jump back up of the half-faded picture)...
    s = slotsReducer(s, { type: 'ready', key: slotKey(third), at: 600 });
    expect(s).toMatchObject({
      shown: { key: slotKey(faded) },
      leaving: { key: slotKey(a) },
      incoming: { key: slotKey(third), state: 'ready' },
      fade: { start: 100, ms: 1000 },
    });
    // ...then dissolves in from the second, now whole, as the first dissolve ends.
    s = slotsReducer(s, { type: 'faded', start: 100 });
    expect(s).toMatchObject({
      shown: { key: slotKey(third) },
      leaving: { key: slotKey(faded) },
      incoming: null,
      fade: { start: 1100, ms: 1000 },
    });
    // If its own dissolve is over by then, it simply replaces it.
    const late = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: faded },
      { type: 'ready', key: slotKey(faded), at: 100 },
      { type: 'layer', layer: video('U', 50, { fade: { at: 50, durationMs: 500 } }) },
      { type: 'ready', key: slotKey(video('U', 50)), at: 600 },
      { type: 'faded', start: 100 },
    );
    expect(late).toMatchObject({ shown: { key: 'U@50' }, leaving: null, incoming: null, fade: null });
  });

  it('Back during a dissolve: the picture going away comes back whole, at once (Session 23)', () => {
    const faded = video('F', 100, { fade: { at: 100, durationMs: 1000 } });
    const s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: faded },
      { type: 'ready', key: slotKey(faded), at: 100 },
      { type: 'layer', layer: a },
    );
    // Never the same picture twice (leaving and loading again): it is simply back.
    expect(s).toEqual({
      shown: { key: slotKey(a), layer: a, state: 'ready' },
      incoming: null,
      leaving: null,
      fade: null,
    });
  });

  it('a window that joins during a dissolve shows its background whole, never fading in from black (Session 23)', () => {
    const faded = video('F', 100, { fade: { at: 100, durationMs: 1000 } });
    // The first background this window hears of, part-way through the slide's dissolve.
    let s = run(
      { type: 'layer', layer: faded, joined: true },
      { type: 'ready', key: slotKey(faded), at: 400 },
    );
    expect(s).toMatchObject({ shown: { key: slotKey(faded) }, leaving: null, fade: null });
    // A window that was already there, with no background before it: it fades in with the slide, as before.
    s = run(
      { type: 'layer', layer: null, joined: true },
      { type: 'layer', layer: faded },
      { type: 'ready', key: slotKey(faded), at: 400 },
    );
    expect(s.fade).toEqual({ start: 400, ms: 1000 });
  });

  it('tries a background again when its copy lands on a node, after it had failed (Session 13)', () => {
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: b },
      { type: 'failed', key: slotKey(b) },
    );
    expect(s.incoming).toMatchObject({ key: slotKey(b), state: 'failed' });
    // The picture before stays drawn meanwhile (Q60-31), and while it is tried again.
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    s = slotsReducer(s, { type: 'retry', key: slotKey(b) });
    expect(drawnKeyOf(s)).toBe(slotKey(a));
    expect(s.incoming).toMatchObject({ key: slotKey(b), state: 'loading', attempt: 1 });
    expect(onScreen(slotsReducer(s, { type: 'ready', key: slotKey(b) }))).toBe(slotKey(b));
    // Only a failed background is tried again: one on screen, or one no longer up, is left alone.
    const fine = run({ type: 'layer', layer: c }, { type: 'ready', key: slotKey(c) });
    expect(slotsReducer(fine, { type: 'retry', key: slotKey(c) })).toBe(fine);
    expect(slotsReducer(fine, { type: 'retry', key: slotKey(b) })).toBe(fine);
  });

  it('tries a failed background again once for each landing of its file, never in a loop', () => {
    let s = run({ type: 'layer', layer: b }, { type: 'failed', key: slotKey(b) });
    // Not landed yet: no try.
    expect(retryAfterLanding(s, 0)).toBeNull();
    // Landed once: one try.
    expect(retryAfterLanding(s, 1)).toBe(slotKey(b));
    s = slotsReducer(s, { type: 'retry', key: slotKey(b) });
    // While that try loads, nothing more.
    expect(retryAfterLanding(s, 1)).toBeNull();
    s = slotsReducer(s, { type: 'failed', key: slotKey(b) });
    // It failed again: no new try until the file lands again.
    expect(s.incoming).toMatchObject({ state: 'failed', attempt: 1 });
    expect(retryAfterLanding(s, 1)).toBeNull();
    expect(retryAfterLanding(s, 2)).toBe(slotKey(b));
    // One on screen is left alone; one that failed while it played is tried again the same way (a GPU process gone).
    expect(
      retryAfterLanding(run({ type: 'layer', layer: b }, { type: 'ready', key: slotKey(b) }), 3),
    ).toBeNull();
    const played = run(
      { type: 'layer', layer: b },
      { type: 'ready', key: slotKey(b) },
      { type: 'failed', key: slotKey(b) },
    );
    expect(retryAfterLanding(played, 1)).toBe(slotKey(b));
  });

  it('tries one that failed while it played out of sight, drawn as it was meanwhile, never black (Q60-31: a node, its copy landed before, tries it again at once)', () => {
    let s = run(
      { type: 'layer', layer: b },
      { type: 'ready', key: slotKey(b) },
      { type: 'failed', key: slotKey(b) },
    );
    expect(retryAfterLanding(s, 1)).toBe(slotKey(b));
    s = slotsReducer(s, { type: 'retry', key: slotKey(b) });
    expect(drawnKeyOf(s)).toBe(slotKey(b));
    expect(s.incoming).toMatchObject({ key: slotKey(b), state: 'loading', attempt: 1 });
    // While that try loads, nothing more.
    expect(retryAfterLanding(s, 1)).toBeNull();
    expect(slotsReducer(s, { type: 'retry', key: slotKey(b) })).toBe(s);
    // The try draws: it is on screen.
    const back = slotsReducer(s, { type: 'ready', key: slotKey(b) });
    expect(back.shown).toMatchObject({ key: slotKey(b), state: 'ready', attempt: 1 });
    expect(back.incoming).toBeNull();
    // The try fails too: still drawn as it was; no more tries until the file lands again.
    const again = slotsReducer(s, { type: 'failed', key: slotKey(b) });
    expect(drawnKeyOf(again)).toBe(slotKey(b));
    expect(retryAfterLanding(again, 1)).toBeNull();
  });

  it('tries one again only for a landing or a new GPU process after it failed, never for one before (Q60-31: a node whose copy landed long before)', () => {
    // Its file landed once before it played (a node's copy); then it failed while it played.
    const s = run(
      { type: 'layer', layer: b },
      { type: 'ready', key: slotKey(b) },
      { type: 'failed', key: slotKey(b), landed: 1 },
    );
    expect(retryAfterLanding(s, 1)).toBeNull();
    // A landing since (or a new GPU process): one try.
    expect(retryAfterLanding(s, 2)).toBe(slotKey(b));
    // As it loaded, the same.
    const loading = run({ type: 'layer', layer: b }, { type: 'failed', key: slotKey(b), landed: 3 });
    expect(retryAfterLanding(loading, 3)).toBeNull();
    expect(retryAfterLanding(loading, 4)).toBe(slotKey(b));
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

/*
 * A video input (Session 50) comes and goes as a video does: the picture before it stays until it has its first
 * frame, and it dissolves in with the fade a video gets, never a cut through black.
 */
describe('a video input in the background slots (Session 50)', () => {
  const input = (
    inputId: string,
    startedAt: number,
    extra: Partial<InputBackground> = {},
  ): InputBackground => ({
    kind: 'input',
    inputId,
    name: 'Placeholder input',
    device: 'fake_device_0',
    fit: 'fit',
    startedAt,
    ...extra,
  });
  const a = video('A', 1);

  it('keeps the video before it on screen until the input has its first frame', () => {
    const one = input('I', 5);
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: one },
    );
    expect(onScreen(s)).toBe(slotKey(a));
    expect(s.incoming).toMatchObject({ key: slotKey(one), state: 'loading', layer: { kind: 'input' } });
    s = slotsReducer(s, { type: 'ready', key: slotKey(one) });
    expect(onScreen(s)).toBe(slotKey(one));
    // And a video after it the same way: the input stays until the video is ready.
    const next = video('B', 9);
    s = slotsReducer(s, { type: 'layer', layer: next });
    expect(onScreen(s)).toBe(slotKey(one));
    expect(onScreen(slotsReducer(s, { type: 'ready', key: slotKey(next) }))).toBe(slotKey(next));
  });

  it('is never taken for a file of the same id', () => {
    expect(slotKey(input('A', 1))).not.toBe(slotKey(video('A', 1)));
    expect(slotKey(input('A', 1))).not.toBe(slotKey(input('A', 2)));
  });

  it('dissolves in with the fade a video gets, from when it is ready even after the fade’s own time', () => {
    const one = input('I', 100, { fade: { at: 100, durationMs: 1000 } });
    const before = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: one },
    );
    // Ready at once: from the fade's own start, as a video's.
    expect(slotsReducer(before, { type: 'ready', key: slotKey(one), at: 90 })).toMatchObject({
      shown: { key: slotKey(one) },
      leaving: { key: slotKey(a) },
      fade: { start: 100, ms: 1000 },
    });
    // A capture takes a moment to open: ready after its fade's time, it still dissolves, from then.
    expect(slotsReducer(before, { type: 'ready', key: slotKey(one), at: 2500 })).toMatchObject({
      shown: { key: slotKey(one) },
      leaving: { key: slotKey(a) },
      fade: { start: 2500, ms: 1000 },
    });
    // A window that opens while it is up shows it whole.
    expect(
      run({ type: 'layer', layer: one, joined: true }, { type: 'ready', key: slotKey(one), at: 2500 }),
    ).toMatchObject({ shown: { key: slotKey(one) }, leaving: null, fade: null });
  });

  it('carries on through a change of fit, and clears at once', () => {
    const one = input('I', 5);
    let s = run({ type: 'layer', layer: one }, { type: 'ready', key: slotKey(one) });
    s = slotsReducer(s, { type: 'layer', layer: { ...one, fit: 'fill' } });
    expect(s.shown).toMatchObject({ key: slotKey(one), state: 'ready', layer: { fit: 'fill' } });
    expect(slotsReducer(s, { type: 'layer', layer: null })).toEqual(NO_SLOTS);
  });

  it('shows nothing when it cannot start, and comes on at once when it can (plugged in again)', () => {
    const one = input('I', 5, { fade: { at: 5, durationMs: 1000 } });
    let s = run(
      { type: 'layer', layer: a },
      { type: 'ready', key: slotKey(a) },
      { type: 'layer', layer: one },
      { type: 'failed', key: slotKey(one) },
    );
    expect(onScreen(s)).toBeNull();
    s = slotsReducer(s, { type: 'ready', key: slotKey(one), at: 60_000 });
    expect(s).toEqual({
      shown: { key: slotKey(one), layer: one, state: 'ready' },
      incoming: null,
      leaving: null,
      fade: null,
    });
    // A file that could not play stays as it is: only a node's copy landing tries it again.
    const failed = run({ type: 'layer', layer: a }, { type: 'failed', key: slotKey(a) });
    expect(slotsReducer(failed, { type: 'ready', key: slotKey(a), at: 9 })).toBe(failed);
  });

  it('is never tried again for a copy landing (it is no file)', () => {
    const s = run({ type: 'layer', layer: input('I', 5) }, { type: 'failed', key: slotKey(input('I', 5)) });
    expect(retryAfterLanding(s, 3)).toBeNull();
  });
});

it('arms a loaded cue as a real showing before Go, retaining its old picture until activation and reporting failures normally', () => {
  const old = video('old', 1);
  const background = {
    ...video('prepared', 2),
    media: 'video' as const,
    cueId: 'cue',
    seek: { at: 100, toMs: 500, paused: true },
  };
  const cue = { id: 'cue', label: 'Placeholder', background, playlist: null, required: [], ready: [] };
  const prepared = run(
    { type: 'layer', layer: old },
    { type: 'ready', key: slotKey(old) },
    { type: 'cue', cue },
    { type: 'ready', key: slotKey(background) },
  );
  const armed = slotsReducer(prepared, {
    type: 'cue',
    cue: { ...cue, background: { ...background, seek: { at: 500, toMs: 500 } } },
  });
  expect(armed.shown?.key).toBe(slotKey(old));
  expect(armed.incoming).toMatchObject({ key: slotKey(background), state: 'ready' });
  expect(
    armed.incoming?.cued,
    'Go is armed: decode errors must use the ordinary showing take-off path',
  ).not.toBe(true);
  const failed = slotsReducer(armed, { type: 'failed', key: slotKey(background) });
  expect(slotsReducer(failed, { type: 'activate', key: slotKey(background), at: 500 }).shown?.key).toBe(
    slotKey(old),
  );
  const started = slotsReducer(armed, { type: 'activate', key: slotKey(background), at: 500 });
  expect(started.shown?.key).toBe(slotKey(background));
  expect(started.shown?.layer).toMatchObject({ startedAt: 2, seek: { at: 500, toMs: 500 } });
});

it('an unavailable edited cue owns no source decoder and retains the live picture', () => {
  const old = video('old', 1);
  const background = {
    ...video('new', 2),
    media: 'video' as const,
    cueId: 'cue',
    seek: { at: 100, toMs: 0, paused: true },
  };
  const cue = { id: 'cue', label: 'Placeholder', playlist: null, required: [], ready: [], background };
  const before = run(
    { type: 'layer', layer: old },
    { type: 'ready', key: slotKey(old) },
    { type: 'cue', cue },
  );
  const waiting = slotsReducer(before, {
    type: 'cue',
    cue: { ...cue, error: 'The edited copy is preparing.' },
  });
  expect(waiting.shown?.key).toBe(slotKey(old));
  expect(waiting.incoming).toBeNull();
});

describe('a cued video Go’d, then put up again going round before its Go moment came (a25 item 47, cuerace)', () => {
  // BackgroundMedia.tsx starts a slot coming in at its Go moment by its cue's id (the slot's layer.cueId); the engine
  // takes the loop as the same playback with new settings (its start and Go's moment kept), and no cue id.
  const old = video('old', 1);
  const background = {
    ...video('cued', 2, { loop: false }),
    media: 'video' as const,
    cueId: 'cue',
    seek: { at: 100, toMs: 0, paused: true },
  };
  const cue = { id: 'cue', label: 'Placeholder', background, playlist: null, required: [], ready: [] };
  const go = { ...background, seek: { at: 500, toMs: 0 } };
  const { cueId: _cueId, ...loop } = { ...go, loop: true };
  const key = slotKey(background);
  const prepared = run(
    { type: 'layer', layer: old },
    { type: 'ready', key: slotKey(old) },
    { type: 'cue', cue },
    { type: 'ready', key },
  );
  const next = {
    ...video('next', 3),
    media: 'video' as const,
    cueId: 'next',
    seek: { at: 600, toMs: 0, paused: true },
  };

  it('still starts at its Go moment, going round, and the next cue is prepared over it', () => {
    const armed = after(
      prepared,
      { type: 'layer', layer: go },
      { type: 'cue', cue: null },
      { type: 'layer', layer: loop },
    );
    expect(armed.shown?.key, 'the picture before stays until Go’s moment').toBe(slotKey(old));
    expect(armed.incoming).toMatchObject({
      key,
      state: 'ready',
      layer: { cueId: 'cue', loop: true, seek: { at: 500, toMs: 0 } },
    });
    expect(armed.incoming?.cued).not.toBe(true);
    const started = slotsReducer(armed, { type: 'activate', key, at: 500 });
    expect(started.shown).toMatchObject({ key, state: 'ready', layer: { loop: true } });
    expect(started.incoming).toBeNull();
    const again = slotsReducer(started, { type: 'cue', cue: { ...cue, id: 'next', background: next } });
    expect(again.incoming).toMatchObject({ key: slotKey(next), state: 'loading', cued: true });
  });

  it('the same where the page hears of Go and the loop together (only the loop)', () => {
    const armed = after(prepared, { type: 'layer', layer: loop }, { type: 'cue', cue: null });
    expect(armed.shown?.key).toBe(slotKey(old));
    expect(armed.incoming).toMatchObject({ key, state: 'ready', layer: { cueId: 'cue', loop: true } });
    expect(armed.incoming?.cued).not.toBe(true);
  });

  it('a background coming in with no cue keeps none when its settings change', () => {
    const plain = run({ type: 'layer', layer: old }, { type: 'layer', layer: { ...old, fit: 'fit' } });
    expect(plain.incoming?.layer).toEqual({ ...old, fit: 'fit' });
  });
});
