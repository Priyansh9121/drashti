import { describe, expect, it } from 'vitest';
import type { PipLayer, PipPlace } from '../../../shared/engine/state';
import type { LookLayer } from '../../../shared/looks';
import {
  droppedPlace,
  PIP_REST,
  pipDraw,
  pipLength,
  pipMainMove,
  pipMainPlaces,
  pipMainPose,
  pipName,
  pipPlaces,
  pipPose,
  pipRect,
  pipRunAt,
  pipShownFor,
  pipShowsHere,
} from './pip';

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

describe('the main picture in a swap (Session 51)', () => {
  const VIDEO = { kind: 'media', mediaId: 'm', media: 'video' } as const;
  /** A box swapped at 30 s, from `from` to `to`. */
  const swapping = (from: boolean, to: boolean, over: Partial<PipLayer> = {}): PipLayer =>
    box({ swapped: to, changed: { at: 30_000, place: over.place ?? place(), swapped: from }, ...over });
  const runAt = (b: PipLayer, t: number, movement: 'calm' | 'bold' = 'calm') =>
    pipRunAt(b, null, movement, 30_000 + t, HD);

  it('moves the picture that changes there, the box’s own (or the slide): in over the one it replaces, or out over the one replacing it', () => {
    // The slides in the box, swapped: the slide comes in whole over the background; swapped back, it goes out.
    expect(pipMainMove(runAt(swapping(false, true), 100))).toEqual({ picture: 'slide', way: 'in' });
    expect(pipMainMove(runAt(swapping(true, false), 100))).toEqual({ picture: 'slide', way: 'out' });
    // A video in the box: it comes in, in the background's place (under the slide), and goes out again.
    expect(pipMainMove(runAt(swapping(false, true, { source: VIDEO }), 300))).toEqual({
      picture: 'source',
      way: 'in',
    });
    expect(pipMainMove(runAt(swapping(true, false, { source: VIDEO }), 300))).toEqual({
      picture: 'source',
      way: 'out',
    });
    // Coming in, still, moving, going out, or once the swap is over: nothing moves on the main picture.
    expect(pipMainMove(pipRunAt(box(), null, 'calm', 10_100, HD))).toBeNull();
    expect(pipMainMove(pipRunAt(box(), null, 'calm', 20_000, HD))).toBeNull();
    expect(pipMainMove(runAt(swapping(false, true), 500))).toBeNull();
    const moved = box({ changed: { at: 30_000, place: place({ corner: 'top-left' }), swapped: false } });
    expect(pipMainMove(runAt(moved, 100))).toBeNull();
    expect(pipMainMove(pipRunAt(null, { layer: box(), at: 30_000 }, 'calm', 30_100, HD))).toBeNull();
  });

  it('moves the same as the box at the same moment, by its motion and the Movement, never a cut at the middle', () => {
    for (const motion of ['fade', 'scale', 'slide'] as const)
      for (const movement of ['calm', 'bold'] as const)
        for (const [from, to] of [
          [false, true],
          [true, false],
        ] as const) {
          const b = swapping(from, to, { place: place({ motion }) });
          const length = pipLength('swap', motion, movement);
          const half = length / 2;
          const way = pipMainMove(runAt(b, 0, movement))?.way;
          const what = `${motion} ${movement} ${String(from)} to ${String(to)}`;
          for (const t of [0, 1, half / 3, half - 1, half, half + 1, half + half / 2, length - 1]) {
            const run = runAt(b, t, movement);
            const main = pipMainPose(run, 30_000 + t, HD);
            const shown = pipPose(run, 30_000 + t, HD);
            // In its half (an in after the middle, an out before it), as the box at that moment: its
            // opacity, and its scale; elsewhere wholly in or out of the way.
            const moving = way === 'in' ? t >= half : t < half;
            if (moving) {
              expect(main.opacity, `${what} at ${String(t)}`).toBeCloseTo(shown.opacity, 9);
              expect(main.scaleX, `${what} at ${String(t)}`).toBeCloseTo(shown.scaleX, 9);
            } else if (way === 'out') expect(main, `${what} at ${String(t)}`).not.toEqual(PIP_REST);
          }
          // At the middle it is just as it was: wholly away for an in, whole for an out about to leave.
          const middle = pipMainPose(runAt(b, half - 0.001, movement), 30_000 + half - 0.001, HD);
          const start = pipMainPose(runAt(b, half, movement), 30_000 + half, HD);
          if (way === 'in') {
            expect(start.opacity === 0 || Math.abs(start.x) >= 1920 || Math.abs(start.y) >= 1080, what).toBe(
              true,
            );
          } else {
            expect(pipMainPose(runAt(b, 0, movement), 30_000, HD), what).toEqual(PIP_REST);
            expect(
              middle.opacity < 0.01 || Math.abs(middle.x) > 1900 || Math.abs(middle.y) > 1070,
              what,
            ).toBe(true);
          }
          // Done: at rest.
          expect(pipMainPose(runAt(b, length, movement), 30_000 + length, HD), what).toEqual(PIP_REST);
        }
  });

  it('a slide moves from the box’s corner over the whole screen: a short way fading in Calm, from beyond the edges in Bold', () => {
    const b = swapping(false, true, { place: place({ motion: 'slide', corner: 'bottom-right' }) });
    // Calm, a quarter into its in: on its way from the bottom right, faint.
    const calm = pipMainPose(runAt(b, 250 + 62.5), 30_000 + 250 + 62.5, HD);
    expect(calm.opacity).toBeGreaterThan(0);
    expect(calm.opacity).toBeLessThan(0.5);
    expect(calm.x).toBeGreaterThan(0);
    expect(calm.x).toBeLessThan(0.12 * 1920);
    expect(calm.y).toBeGreaterThan(0);
    // Bold, at the start of its in: just beyond the screen's bottom right corner, whole.
    expect(pipMainPose(runAt(b, 300, 'bold'), 30_300, HD)).toMatchObject({ opacity: 1, x: 1920, y: 1080 });
    const topLeft = swapping(false, true, { place: place({ motion: 'slide', corner: 'top-left' }) });
    expect(pipMainPose(runAt(topLeft, 300, 'bold'), 30_300, HD)).toMatchObject({ x: -1920, y: -1080 });
  });

  it('draws both pictures through the half in which the main picture moves, the moving one over the other', () => {
    const both = (...pictures: string[]) => pictures.map((picture) => ({ picture, shown: true }));
    // The slides in the box, swapped (an in): before the middle as before, the slide ready unseen; after it,
    // the background under the slide coming in; then the slide alone.
    const slidesIn = swapping(false, true);
    expect(pipMainPlaces('slides', runAt(slidesIn, 100), true)).toEqual([
      { picture: 'background', shown: true },
      { picture: 'slide', shown: false },
    ]);
    expect(pipMainPlaces('slides', runAt(slidesIn, 300), true)).toEqual(both('background', 'slide'));
    expect(pipMainPlaces('slides', runAt(slidesIn, 600), true)).toEqual(both('slide'));
    // Swapped back (an out): both before the middle, the slide going out over the background; then the
    // background alone.
    const slidesOut = swapping(true, false);
    expect(pipMainPlaces('slides', runAt(slidesOut, 100), false)).toEqual(both('background', 'slide'));
    expect(pipMainPlaces('slides', runAt(slidesOut, 300), false)).toEqual(both('background'));
    // A video in the box: the same in the background's place, the slide over both throughout.
    const videoIn = swapping(false, true, { source: VIDEO });
    expect(pipMainPlaces('media', runAt(videoIn, 100), true)).toEqual([
      { picture: 'background', shown: true },
      { picture: 'source', shown: false },
      { picture: 'slide', shown: true },
    ]);
    expect(pipMainPlaces('media', runAt(videoIn, 300), true)).toEqual(both('background', 'source', 'slide'));
    expect(pipMainPlaces('media', runAt(videoIn, 600), true)).toEqual(both('source', 'slide'));
    const videoOut = swapping(true, false, { source: VIDEO });
    expect(pipMainPlaces('media', runAt(videoOut, 100), false)).toEqual(
      both('background', 'source', 'slide'),
    );
    expect(pipMainPlaces('media', runAt(videoOut, 300), false)).toEqual(both('background', 'slide'));
    // No box here, or no run of its own: as pipPlaces has it.
    expect(pipMainPlaces(null, null, false)).toEqual(pipPlaces(null, false, false).main);
    expect(pipMainPlaces('slides', null, true)).toEqual(both('slide'));
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
