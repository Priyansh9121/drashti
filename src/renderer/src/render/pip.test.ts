import { describe, expect, it } from 'vitest';
import type { PipLayer, PipPlace } from '../../../shared/engine/state';
import type { LookLayer } from '../../../shared/looks';
import { pipSwapMs } from '../../../shared/pip';
import {
  droppedPlace,
  keptPipRun,
  PIP_REST,
  pipDraw,
  pipLength,
  pipMainDissolve,
  pipMainOpacity,
  pipMainPlaces,
  pipName,
  pipPlaces,
  pipPose,
  pipRect,
  type PipRun,
  pipRunAt,
  pipRunLater,
  pipShownFor,
  pipShowsHere,
  type PipSlot,
  samePipRun,
} from './pip';
import { transitionFrame } from './transition-frame';

/* The picture-in-picture box on the screens (Session 50): where it sits, how it moves, and what goes where. */

const HD = { width: 1920, height: 1080 };
const place = (over: Partial<PipPlace> = {}): PipPlace => ({
  corner: 'bottom-right',
  x: 0,
  y: 0,
  size: 'medium',
  border: true,
  rounded: true,
  motion: 'fade',
  ...over,
});
const box = (over: Partial<PipLayer> = {}): PipLayer => ({
  source: { kind: 'slides' },
  place: place(),
  swapped: false,
  shownAt: 10_000,
  ...over,
});

describe('where the box sits', () => {
  it('is a quarter, a third or two fifths of the screen’s width, always 16:9', () => {
    for (const [size, width] of [
      ['small', 480],
      ['medium', 640],
      ['large', 768],
    ] as const) {
      const r = pipRect(place({ size }), HD);
      expect(r.width).toBe(width);
      expect(r.height).toBe((width * 9) / 16);
    }
    // On a 4:3 screen too: its width's share, 16:9.
    const r = pipRect(place({ size: 'medium' }), { width: 1024, height: 768 });
    expect(r.width).toBe(341);
    expect(r.height).toBe(192);
  });

  it('sits in each corner the same way in from the edges', () => {
    const m = 43; // 4% of the screen's height
    expect(pipRect(place({ corner: 'top-left' }), HD)).toEqual({ x: m, y: m, width: 640, height: 360 });
    expect(pipRect(place({ corner: 'top-right' }), HD)).toEqual({
      x: 1920 - m - 640,
      y: m,
      width: 640,
      height: 360,
    });
    expect(pipRect(place({ corner: 'bottom-left' }), HD)).toEqual({
      x: m,
      y: 1080 - m - 360,
      width: 640,
      height: 360,
    });
    expect(pipRect(place({ corner: 'bottom-right' }), HD)).toEqual({
      x: 1920 - m - 640,
      y: 1080 - m - 360,
      width: 640,
      height: 360,
    });
  });

  it('goes where it was dragged, its top left at x and y, kept wholly inside the screen', () => {
    expect(pipRect(place({ corner: null, x: 0.25, y: 0.5 }), HD)).toEqual({
      x: 480,
      y: 540,
      width: 640,
      height: 360,
    });
    // Past the right and bottom edges: as far as it can go.
    expect(pipRect(place({ corner: null, x: 0.95, y: 0.99 }), HD)).toEqual({
      x: 1280,
      y: 720,
      width: 640,
      height: 360,
    });
    expect(pipRect(place({ corner: null, x: 0, y: 0, size: 'large' }), HD)).toEqual({
      x: 0,
      y: 0,
      width: 768,
      height: 432,
    });
  });

  it('on a screen too wide for it, is as tall as fits, still 16:9', () => {
    const wall = { width: 5760, height: 1080 };
    const r = pipRect(place({ size: 'large' }), wall);
    expect(r.height).toBe(1080 - 2 * 43);
    expect(r.width).toBe(Math.round(((1080 - 2 * 43) * 16) / 9));
    expect(r.x + r.width).toBe(5760 - 43);
  });

  it('let go near a corner, goes into it; anywhere else, stays where it was let go, inside the screen', () => {
    const from = place({ corner: 'bottom-right' });
    // Dragged 600 px left and 10 up: free, its top left there.
    const free = droppedPlace(from, HD, -600, -10);
    expect(free.corner).toBeNull();
    expect(pipRect(free, HD)).toEqual({ x: 1237 - 600, y: 677 - 10, width: 640, height: 360 });
    // Dragged almost all the way to the top left: into that corner.
    const corner = droppedPlace(from, HD, -1180, -620);
    expect(corner.corner).toBe('top-left');
    expect(pipRect(corner, HD)).toEqual({ x: 43, y: 43, width: 640, height: 360 });
    // Far past the edge: inside the screen.
    const past = droppedPlace(place({ corner: null, x: 0.3, y: 0.3 }), HD, 5000, -5000);
    expect(pipRect(past, HD)).toMatchObject({ x: 1280, y: 0 });
    // Everything else about it is kept.
    expect(
      droppedPlace(place({ size: 'small', border: false, motion: 'slide' }), HD, -300, -300),
    ).toMatchObject({
      size: 'small',
      border: false,
      rounded: true,
      motion: 'slide',
    });
  });
});

describe('how the box moves', () => {
  it('takes its time by the Look’s movement: Calm in 300 ms and out 250, Bold 400 and 300; a swap goes out and in', () => {
    expect(pipLength('in', 'fade', 'calm')).toBe(300);
    expect(pipLength('in', 'scale', 'bold')).toBe(400);
    expect(pipLength('out', 'slide', 'calm')).toBe(250);
    expect(pipLength('out', 'fade', 'bold')).toBe(300);
    expect(pipLength('swap', 'fade', 'calm')).toBe(500);
    expect(pipLength('swap', 'scale', 'bold')).toBe(600);
    // A move glides there when it slides; a fade or a scale goes out and comes in at the new place.
    expect(pipLength('move', 'slide', 'calm')).toBe(400);
    expect(pipLength('move', 'slide', 'bold')).toBe(500);
    expect(pipLength('move', 'fade', 'calm')).toBe(500);
    // The engine takes no other Swap while one runs on the slowest group's screens (Session 51): as long.
    expect(pipSwapMs([])).toBe(pipLength('swap', 'fade', 'calm'));
    expect(pipSwapMs(['calm'])).toBe(pipLength('swap', 'scale', 'calm'));
    expect(pipSwapMs(['calm', 'bold'])).toBe(pipLength('swap', 'slide', 'bold'));
  });

  it('comes in from when it went up, then stays; a screen that joins later draws it still', () => {
    const b = box();
    expect(pipRunAt(b, null, 'calm', 10_100, HD)).toMatchObject({ phase: 'in', start: 10_000, length: 300 });
    expect(pipRunAt(b, null, 'calm', 10_300, HD)).toMatchObject({ phase: 'still', layer: b });
    expect(pipRunAt(b, null, 'bold', 10_350, HD)).toMatchObject({ phase: 'in', length: 400 });
  });

  it('goes out from when it was taken off, then is gone', () => {
    const off = { layer: box(), at: 20_000 };
    expect(pipRunAt(null, off, 'calm', 20_100, HD)).toMatchObject({
      phase: 'out',
      start: 20_000,
      layer: off.layer,
    });
    expect(pipRunAt(null, off, 'calm', 20_250, HD)).toMatchObject({ phase: 'gone', layer: null });
    expect(pipRunAt(null, null, 'calm', 20_100, HD)).toMatchObject({ phase: 'gone', layer: null });
    // A box up again wins over one going.
    const again = box({ shownAt: 20_050 });
    expect(pipRunAt(again, off, 'calm', 20_100, HD)).toMatchObject({ phase: 'in', layer: again });
  });

  it('swaps its pictures at the middle of the swap, going out with the old and coming in with the new', () => {
    const b = box({ swapped: true, changed: { at: 30_000, place: place(), swapped: false } });
    const first = pipRunAt(b, null, 'calm', 30_100, HD);
    expect(first).toMatchObject({ phase: 'swap', start: 30_000, length: 500, swapped: false });
    expect(first.from).toEqual({ place: place(), swapped: false });
    expect(pipRunAt(b, null, 'calm', 30_250, HD)).toMatchObject({ phase: 'swap', swapped: true });
    expect(pipRunAt(b, null, 'calm', 30_500, HD)).toMatchObject({ phase: 'still', swapped: true });
  });

  it('moves: a slide glides from the old place, a fade or a scale changes place at the middle', () => {
    const before = place({ corner: 'top-left' });
    const glide = box({
      place: place({ motion: 'slide' }),
      changed: { at: 40_000, place: before, swapped: false },
    });
    expect(pipRunAt(glide, null, 'calm', 40_050, HD)).toMatchObject({ phase: 'move', place: glide.place });
    const fade = box({ changed: { at: 40_000, place: before, swapped: false } });
    expect(pipRunAt(fade, null, 'calm', 40_100, HD)).toMatchObject({ phase: 'move', place: before });
    expect(pipRunAt(fade, null, 'calm', 40_300, HD)).toMatchObject({ phase: 'move', place: fade.place });
    // A border, the corners or the motion changed alone: nothing to animate.
    const look = box({
      changed: { at: 40_000, place: place({ border: false, motion: 'scale' }), swapped: false },
    });
    expect(pipRunAt(look, null, 'calm', 40_100, HD)).toMatchObject({ phase: 'still' });
  });

  it('draws each frame from the engine’s time: a fade’s opacity, a scale’s size, a slide from its corner', () => {
    const fade = box();
    const at = (b: PipLayer, now: number, movement: 'calm' | 'bold' = 'calm') =>
      pipPose(pipRunAt(b, null, movement, now, HD), now, HD);
    expect(at(fade, 10_000).opacity).toBe(0);
    expect(at(fade, 10_150).opacity).toBeGreaterThan(0);
    expect(at(fade, 10_150).opacity).toBeLessThan(1);
    expect(at(fade, 10_300)).toMatchObject({ opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 });
    // A scale grows into place: further in Bold.
    const scale = box({ place: place({ motion: 'scale' }) });
    expect(at(scale, 10_000).scaleX).toBeCloseTo(0.85, 9);
    expect(at(scale, 10_000, 'bold').scaleX).toBeCloseTo(0.5, 9);
    // A slide comes from its corner: in Calm a short way, fading; in Bold from beyond the screen's edges.
    const slide = box({ place: place({ motion: 'slide' }) });
    const calm = at(slide, 10_000);
    expect(calm.opacity).toBe(0);
    expect(calm.x).toBeGreaterThan(0);
    expect(calm.y).toBeGreaterThan(0);
    const bold = at(slide, 10_000, 'bold');
    const r = pipRect(slide.place, HD);
    expect(bold.opacity).toBe(1);
    expect(r.x + bold.x).toBe(1920);
    expect(r.y + bold.y).toBe(1080);
    const topLeft = box({ place: place({ motion: 'slide', corner: 'top-left' }) });
    const tl = at(topLeft, 10_000, 'bold');
    const tr = pipRect(topLeft.place, HD);
    expect(tr.x + tr.width + tl.x).toBe(0);
    expect(tr.y + tr.height + tl.y).toBe(0);
  });

  it('a swap is out of sight at its middle; a glide starts where the box was', () => {
    const b = box({ swapped: true, changed: { at: 30_000, place: place(), swapped: false } });
    expect(pipPose(pipRunAt(b, null, 'calm', 30_249, HD), 30_249, HD).opacity).toBeLessThan(0.01);
    expect(pipPose(pipRunAt(b, null, 'calm', 30_251, HD), 30_251, HD).opacity).toBeLessThan(0.01);
    const before = place({ corner: 'top-left', size: 'small' });
    const glide = box({
      place: place({ motion: 'slide' }),
      changed: { at: 40_000, place: before, swapped: false },
    });
    const start = pipPose(pipRunAt(glide, null, 'calm', 40_000, HD), 40_000, HD);
    const from = pipRect(before, HD);
    const to = pipRect(glide.place, HD);
    expect(start.origin).toBe('top-left');
    expect(to.x + start.x).toBeCloseTo(from.x, 6);
    expect(to.y + start.y).toBeCloseTo(from.y, 6);
    expect(to.width * start.scaleX).toBeCloseTo(from.width, 6);
    const end = pipPose(pipRunAt(glide, null, 'calm', 40_400, HD), 40_400, HD);
    expect(end).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 });
  });

  it('goes out the way it came in', () => {
    const off = { layer: box({ place: place({ motion: 'scale' }) }), at: 20_000 };
    const frame = (now: number) => pipPose(pipRunAt(null, off, 'calm', now, HD), now, HD);
    expect(frame(20_000)).toMatchObject({ opacity: 1, scaleX: 1 });
    expect(frame(20_249).opacity).toBeLessThan(0.01);
    expect(frame(20_249).scaleX).toBeLessThan(0.86);
  });
});

describe('a screen’s run of the box, worked out at every drawing (Session 51)', () => {
  const swapped = box({ swapped: true, changed: { at: 30_000, place: place(), swapped: false } });

  it('is kept while it draws the same, so a clock that jumps draws nothing again that has not changed', () => {
    const first = pipRunAt(swapped, null, 'calm', 30_100, HD);
    // Later in the same half: the same, so the one the screen has is kept.
    expect(samePipRun(first, pipRunAt(swapped, null, 'calm', 30_200, HD))).toBe(true);
    expect(keptPipRun(first, pipRunAt(swapped, null, 'calm', 30_200, HD))).toBe(first);
    // Past the middle its pictures have changed places: the new one.
    const second = pipRunAt(swapped, null, 'calm', 30_300, HD);
    expect(samePipRun(first, second)).toBe(false);
    expect(keptPipRun(first, second)).toBe(second);
    // Still, at any later moment, and gone, likewise.
    const still = pipRunAt(swapped, null, 'calm', 31_000, HD);
    expect(keptPipRun(still, pipRunAt(swapped, null, 'calm', 99_000, HD))).toBe(still);
    const gone = pipRunAt(null, null, 'calm', 31_000, HD);
    expect(keptPipRun(gone, pipRunAt(null, null, 'calm', 99_000, HD))).toBe(gone);
    // Another box (even one alike), another Movement, or gone instead: not the same.
    expect(samePipRun(still, pipRunAt({ ...swapped }, null, 'calm', 31_000, HD))).toBe(false);
    expect(samePipRun(still, pipRunAt(swapped, null, 'bold', 31_000, HD))).toBe(false);
    expect(samePipRun(gone, still)).toBe(false);
    // A move: the same until its middle (a fade changes place there), then the new place.
    const moved = box({ changed: { at: 40_000, place: place({ corner: 'top-left' }), swapped: false } });
    const early = pipRunAt(moved, null, 'calm', 40_050, HD);
    expect(keptPipRun(early, pipRunAt(moved, null, 'calm', 40_200, HD))).toBe(early);
    expect(samePipRun(early, pipRunAt(moved, null, 'calm', 40_300, HD))).toBe(false);
  });

  it('worked out again from itself, reaches a swap’s or a move’s middle and each end by the time alone', () => {
    const first = pipRunAt(swapped, null, 'calm', 30_100, HD);
    expect(samePipRun(pipRunLater(first, 30_249, HD), first)).toBe(true);
    expect(pipRunLater(first, 30_250, HD)).toMatchObject({ phase: 'swap', swapped: true });
    expect(pipRunLater(first, 30_500, HD)).toMatchObject({ phase: 'still', swapped: true });
    // Coming in: still at its end, whatever frames the screen drew before.
    const coming = pipRunAt(box(), null, 'calm', 10_100, HD);
    expect(pipRunLater(coming, 10_299, HD)).toMatchObject({ phase: 'in' });
    expect(pipRunLater(coming, 10_300, HD)).toMatchObject({ phase: 'still' });
    // Going out: gone at its end.
    const leaving = pipRunAt(null, { layer: box(), at: 20_000 }, 'calm', 20_100, HD);
    expect(samePipRun(pipRunLater(leaving, 20_249, HD), leaving)).toBe(true);
    expect(pipRunLater(leaving, 20_250, HD)).toMatchObject({ phase: 'gone', layer: null });
    // Worked out as the screen would from the engine's state at that moment.
    for (const t of [30_100, 30_249, 30_250, 30_499, 30_500, 31_000])
      expect(samePipRun(pipRunLater(first, t, HD), pipRunAt(swapped, null, 'calm', t, HD))).toBe(true);
  });
});

describe('the main picture in a swap (Session 51; a dissolve since Session 52)', () => {
  const VIDEO = { kind: 'media', mediaId: 'm', media: 'video' } as const;
  /** A box swapped at 30 s, from `from` to `to`. */
  const swapping = (from: boolean, to: boolean, over: Partial<PipLayer> = {}): PipLayer =>
    box({ swapped: to, changed: { at: 30_000, place: over.place ?? place(), swapped: from }, ...over });
  const runAt = (b: PipLayer, t: number, movement: 'calm' | 'bold' = 'calm') =>
    pipRunAt(b, null, movement, 30_000 + t, HD);

  it('dissolves the picture that changes there into the one replacing it, in the half of the swap the box moves the same way', () => {
    // The slides in the box, swapped: the background goes as the slide comes in over it, as the box comes in
    // again (the second half); swapped back, the slide goes from over the background as the box goes out (the
    // first).
    expect(pipMainDissolve(runAt(swapping(false, true), 100))).toEqual({
      going: 'background',
      coming: 'slide',
      half: 'second',
    });
    expect(pipMainDissolve(runAt(swapping(true, false), 100))).toEqual({
      going: 'slide',
      coming: 'background',
      half: 'first',
    });
    // A video in the box: the same in the background's place, under the slide.
    expect(pipMainDissolve(runAt(swapping(false, true, { source: VIDEO }), 300))).toEqual({
      going: 'background',
      coming: 'source',
      half: 'second',
    });
    expect(pipMainDissolve(runAt(swapping(true, false, { source: VIDEO }), 300))).toEqual({
      going: 'source',
      coming: 'background',
      half: 'first',
    });
    // Coming in, still, moving, going out, or once the swap is over: nothing dissolves on the main picture.
    expect(pipMainDissolve(pipRunAt(box(), null, 'calm', 10_100, HD))).toBeNull();
    expect(pipMainDissolve(pipRunAt(box(), null, 'calm', 20_000, HD))).toBeNull();
    expect(pipMainDissolve(runAt(swapping(false, true), 500))).toBeNull();
    const moved = box({ changed: { at: 30_000, place: place({ corner: 'top-left' }), swapped: false } });
    expect(pipMainDissolve(runAt(moved, 100))).toBeNull();
    expect(pipMainDissolve(pipRunAt(null, { layer: box(), at: 30_000 }, 'calm', 30_100, HD))).toBeNull();
  });

  /**
   * The main picture's light at `now` where all its pictures are the same whole picture, drawn as a screen draws
   * them (Scene.tsx MainSlot): bottom to top over black, each at its opacity, one that adds (plus-lighter) added
   * light for light, any other over what is under it. 1 is the picture as it was; under 1 it dips.
   */
  const lightOf = (slots: readonly PipSlot[], run: PipRun, now: number): number =>
    slots
      .filter((s) => s.shown)
      .reduce((light, s) => {
        const a = s.dissolve ? pipMainOpacity(run, s.dissolve, now) : 1;
        return s.adds ? light + a : a + (1 - a) * light;
      }, 0);

  it('draws every frame of it by opacity alone, the two pictures adding up and never under the old, on the Movement’s curve in the box’s time', () => {
    for (const [kind, source] of [
      ['slides', { kind: 'slides' }],
      ['media', VIDEO],
    ] as const)
      for (const motion of ['fade', 'scale', 'slide'] as const)
        for (const movement of ['calm', 'bold'] as const)
          for (const to of [true, false]) {
            const b = swapping(!to, to, { source, place: place({ motion }) });
            const length = pipLength('swap', motion, movement);
            const half = length / 2;
            const what = `${kind} ${motion} ${movement} to ${to ? 'swapped' : 'unswapped'}`;
            // Swapped, the box's own picture (or the slide) comes in over the background as the box comes in
            // again; swapped back, it goes from over the background as the box goes out.
            const own = kind === 'slides' ? 'slide' : 'source';
            const from = to ? half : 0;
            let was = -1;
            for (let t = 0; t <= length; t++) {
              const now = 30_000 + t;
              const run = runAt(b, t, movement);
              const slots = pipMainPlaces(kind, run, to);
              const at = `${what} at ${String(t)}`;
              // Never under the old: as whole as the picture was at every moment, never dipping or black.
              expect(lightOf(slots, run, now), at).toBeCloseTo(1, 12);
              const dissolving = slots.filter((s) => s.dissolve !== undefined);
              if (t < from || t >= from + half) {
                expect(dissolving, at).toEqual([]);
                continue;
              }
              // Through its half: the background and the box's own picture (or the slide), both drawn, one going
              // and the other coming, the upper added light for light over the other.
              expect(
                dissolving.map((s) => [s.picture, s.shown, s.dissolve, s.adds === true]),
                at,
              ).toEqual([
                ['background', true, to ? 'out' : 'in', false],
                [own, true, to ? 'in' : 'out', true],
              ]);
              // Opacity alone, the two adding up to one, on the Movement's curve as a slide's dissolve is.
              const coming = pipMainOpacity(run, 'in', now);
              expect(coming + pipMainOpacity(run, 'out', now), at).toBeCloseTo(1, 12);
              expect(coming, at).toBeCloseTo(
                transitionFrame('dissolve', (t - from) / half, movement).in.opacity,
                12,
              );
              expect(coming, at).toBeGreaterThanOrEqual(was);
              was = coming;
            }
            // From the old picture whole at its start to the new one whole by its end, never a cut.
            expect(pipMainOpacity(runAt(b, from, movement), 'in', 30_000 + from), what).toBe(0);
            expect(was, what).toBeGreaterThan(0.999);
            // The box keeps its own move meanwhile: out of its place part-way through each half.
            for (const t of [half / 2, half + half / 2])
              expect(pipPose(runAt(b, t, movement), 30_000 + t, HD), what).not.toEqual(PIP_REST);
          }
  });

  it('draws both pictures through the half in which the main picture dissolves, the upper added light for light over the other', () => {
    const both = (...pictures: string[]) => pictures.map((picture) => ({ picture, shown: true }));
    const going = (picture: string, adds = false) => ({
      picture,
      shown: true,
      dissolve: 'out',
      ...(adds ? { adds } : {}),
    });
    const coming = (picture: string, adds = false) => ({
      picture,
      shown: true,
      dissolve: 'in',
      ...(adds ? { adds } : {}),
    });
    // Swapped, the background is kept under the main picture, unseen and playing, so a swap back shows it at
    // once, never black under the picture going out while it would load.
    const kept = { picture: 'background', shown: false };
    // The slides in the box, swapped: before the middle as before, the slide ready unseen; after it, the
    // background going as the slide comes in over it; then the slide alone, the background kept unseen.
    const slidesIn = swapping(false, true);
    expect(pipMainPlaces('slides', runAt(slidesIn, 100), true)).toEqual([
      { picture: 'background', shown: true },
      { picture: 'slide', shown: false },
    ]);
    expect(pipMainPlaces('slides', runAt(slidesIn, 300), true)).toEqual([
      going('background'),
      coming('slide', true),
    ]);
    expect(pipMainPlaces('slides', runAt(slidesIn, 600), true)).toEqual([kept, ...both('slide')]);
    // Swapped back: before the middle the slide goes from over the background as it comes; then the
    // background alone.
    const slidesOut = swapping(true, false);
    expect(pipMainPlaces('slides', runAt(slidesOut, 100), false)).toEqual([
      coming('background'),
      going('slide', true),
    ]);
    expect(pipMainPlaces('slides', runAt(slidesOut, 300), false)).toEqual(both('background'));
    // A video in the box: the same in the background's place, the slide whole over both throughout.
    const videoIn = swapping(false, true, { source: VIDEO });
    expect(pipMainPlaces('media', runAt(videoIn, 100), true)).toEqual([
      { picture: 'background', shown: true },
      { picture: 'source', shown: false },
      { picture: 'slide', shown: true },
    ]);
    expect(pipMainPlaces('media', runAt(videoIn, 300), true)).toEqual([
      going('background'),
      coming('source', true),
      ...both('slide'),
    ]);
    expect(pipMainPlaces('media', runAt(videoIn, 600), true)).toEqual([kept, ...both('source', 'slide')]);
    const videoOut = swapping(true, false, { source: VIDEO });
    expect(pipMainPlaces('media', runAt(videoOut, 100), false)).toEqual([
      coming('background'),
      going('source', true),
      ...both('slide'),
    ]);
    expect(pipMainPlaces('media', runAt(videoOut, 300), false)).toEqual(both('background', 'slide'));
    // No box here, or no run of its own: as pipPlaces has it, the background kept unseen while swapped.
    expect(pipMainPlaces(null, null, false)).toEqual(pipPlaces(null, false, false).main);
    expect(pipMainPlaces('slides', null, false)).toEqual(both('background'));
    expect(pipMainPlaces('slides', null, true)).toEqual([kept, ...both('slide')]);
    expect(pipMainPlaces('window', null, true)).toEqual([kept, ...both('source', 'slide')]);
    // Swapped and still, and swapping back: the same background all along, never put on the page again, coming
    // in from the swap's first moment.
    const still = pipRunAt(swapping(false, true, { source: VIDEO }), null, 'calm', 31_000, HD);
    expect(pipMainPlaces('media', still, true)).toEqual([kept, ...both('source', 'slide')]);
    expect(pipMainPlaces('media', runAt(videoOut, 0), false)[0]).toEqual(coming('background'));
  });
});

describe('what goes where', () => {
  it('without a box: the background and the slide on the main picture', () => {
    expect(pipDraw(null, false)).toEqual({ main: ['background', 'slide'], box: [] });
  });

  it('the slides in the box: the main picture shows the background without the slide; swapped, the slide full and the background small', () => {
    expect(pipDraw('slides', false)).toEqual({ main: ['background'], box: ['slide'] });
    expect(pipDraw('slides', true)).toEqual({ main: ['slide'], box: ['background'] });
  });

  it('anything else in the box: over the show; swapped, it fills the background’s place under the slide, and the background is small', () => {
    for (const kind of ['media', 'input', 'window'] as const) {
      expect(pipDraw(kind, false)).toEqual({ main: ['background', 'slide'], box: ['source'] });
      expect(pipDraw(kind, true)).toEqual({ main: ['source', 'slide'], box: ['background'] });
    }
  });

  it('while a swap goes out, has the pictures for after it ready, unseen, so nothing goes black at its middle', () => {
    expect(pipPlaces('slides', false, true)).toEqual({
      main: [
        { picture: 'background', shown: true },
        { picture: 'slide', shown: false },
      ],
      box: [
        { picture: 'background', shown: false },
        { picture: 'slide', shown: true },
      ],
    });
    expect(pipPlaces('input', true, false)).toEqual({
      main: [
        { picture: 'background', shown: false },
        { picture: 'source', shown: true },
        { picture: 'slide', shown: true },
      ],
      box: [
        { picture: 'background', shown: true },
        { picture: 'source', shown: false },
      ],
    });
    // Not swapping: only what shows.
    expect(pipPlaces('media', false, false)).toEqual({
      main: [
        { picture: 'background', shown: true },
        { picture: 'slide', shown: true },
      ],
      box: [{ picture: 'source', shown: true }],
    });
  });

  it('a video input or a window only on this computer’s pages; media and the slides everywhere', () => {
    expect(pipShowsHere({ kind: 'slides' }, false)).toBe(true);
    expect(pipShowsHere({ kind: 'media', mediaId: 'm', media: 'video' }, false)).toBe(true);
    expect(pipShowsHere({ kind: 'input', inputId: 'i', name: 'Input 1', device: 'Placeholder' }, false)).toBe(
      false,
    );
    expect(pipShowsHere({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting' }, false)).toBe(
      false,
    );
    expect(pipShowsHere({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting' }, true)).toBe(
      true,
    );
  });

  it('a Look that leaves the box out of a group hides it there (once the Looks know the box)', () => {
    const all = [
      'background',
      'slide',
      'props',
      'pip',
      'messages',
      'ticker',
      'masks',
    ] as unknown as LookLayer[];
    const without = all.filter((l) => (l as string) !== 'pip');
    expect(pipShownFor({ layers: all }, true)).toBe(true);
    expect(pipShownFor({ layers: without }, true)).toBe(false);
    // Before the Looks know it, every group shows it.
    expect(pipShownFor({ layers: without }, false)).toBe(true);
  });

  it('is named in words: by its kind, or the input’s or window’s own name (the state has no media name)', () => {
    expect(pipName({ kind: 'slides' })).toBe('the slides');
    expect(pipName({ kind: 'media', mediaId: 'm', media: 'video' })).toBe('a video');
    expect(pipName({ kind: 'media', mediaId: 'm', media: 'image' })).toBe('a picture');
    expect(pipName({ kind: 'input', inputId: 'i', name: 'Input 1', device: 'Placeholder camera' })).toBe(
      'Input 1',
    );
    expect(pipName({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting' })).toBe(
      'Placeholder meeting',
    );
  });
});
