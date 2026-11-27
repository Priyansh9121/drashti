import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';

/*
 * A cued video's Go, and the same video put up again going round AT ONCE, before Go's moment has come (alpha.24,
 * lead 2's cuerace; a25 list item 47, the cuestill hands-on's row 20). The engine takes the loop as the same playback
 * with new settings (its start kept), and until alpha.24 every picture page then kept that playback out of sight for
 * ever, waiting for a Go it no longer knew it had: the screens went on showing what was up before (or nothing), and no
 * next cue was ever prepared over it ("Preparing first frame…", Go disabled). Now each page still starts it at Go's
 * moment, draws it, and prepares the next cue as after any Go. Placeholder words and generated media only.
 */

/** The picture pages: LIVE (the operator window's preview alone), the hall and the stream. */
interface Pages {
  win: Page;
  hall: Page;
  stream: Page;
}
const PLACES = [
  ['LIVE', 'win', '[data-testid="live-preview"]'],
  ['the hall', 'hall', 'body'],
  ['the stream', 'stream', 'body'],
] as const;

/**
 * What a page draws of the background showing `slot` (background-slots.ts slotKey): "drawn" when one of its videos is
 * that showing's, with its first frame (data-state "ready"), whole (its own and its place's opacity 1), its scene not on
 * the nothing-up picture, and no other background video is drawn; else what it is, to read in a failure.
 */
const drawing = (page: Page, scope: string, slot: string) =>
  page.evaluate(
    ({ scope, slot }) => {
      const root = document.querySelector(scope);
      const videos = [...(root?.querySelectorAll<HTMLVideoElement>('video[data-bg-slot]') ?? [])];
      const whole = (v: HTMLVideoElement) => {
        const place = v.closest<HTMLElement>('[data-bg-wrap]');
        return getComputedStyle(v).opacity === '1' && (!place || getComputedStyle(place).opacity === '1');
      };
      const mine = videos.filter((v) => v.getAttribute('data-bg-slot') === slot);
      const drawn = mine.some(
        (v) => v.getAttribute('data-state') === 'ready' && whole(v) && !v.closest('[data-nothing-up]'),
      );
      const others = videos.filter((v) => v.getAttribute('data-bg-slot') !== slot && whole(v));
      if (drawn && others.length === 0) return 'drawn';
      return [
        mine.length === 0
          ? 'not there'
          : mine
              .map(
                (v) =>
                  `${v.getAttribute('data-state') ?? '?'}, opacity ${getComputedStyle(v).opacity}${v.closest('[data-nothing-up]') ? ', nothing up' : ''}`,
              )
              .join(' / '),
        ...others.map((v) => `also drawn: ${v.getAttribute('data-bg-slot') ?? '?'}`),
      ].join('; ');
    },
    { scope, slot },
  );

/** Each picture page's drawing of `slot`, by name. */
async function drawings(pages: Pages, slot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, page, scope] of PLACES) out[name] = await drawing(pages[page], scope, slot);
  return out;
}

const EVERY_PAGE_DRAWS = Object.fromEntries(PLACES.map(([name]) => [name, 'drawn']));

/** The background showing now, as the engine has it (its slot key). */
async function showing(win: Page): Promise<string> {
  const bg = (await snapshot(win)).layers.background;
  if (bg?.kind !== 'media') throw new Error('no background video');
  return `${bg.mediaId}@${String(bg.startedAt)}`;
}

/**
 * Go for the cue up, and the same video put up again going round in the very next command: both from the operator
 * window in one turn, so the loop reaches the engine (and the pages) well inside Go's lead (shared/video-cue.ts
 * VIDEO_GO_LEAD_MS). Returns Go's moment and when the loop's command came back, both on the engine's clock.
 */
async function goThenLoopAtOnce(win: Page, mediaId: string): Promise<{ goAt: number; loopDone: number }> {
  const cue = (await snapshot(win)).videoCue;
  if (!cue) throw new Error('no video cue');
  const done = await win.evaluate(
    async ({ cueId, mediaId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const go = await d.engine.dispatch({ type: 'goVideoCue', cueId });
      const loop = await d.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
      });
      return { go: go.ok, loop: loop.ok, at: Date.now() };
    },
    { cueId: cue.id, mediaId },
  );
  expect(done.go, 'Go').toBe(true);
  expect(done.loop, 'the loop put up').toBe(true);
  const bg = (await snapshot(win)).layers.background;
  if (bg?.kind !== 'media' || bg.mediaId !== mediaId || !bg.loop) throw new Error('no looping background');
  // The same playback (its start kept), with Go's moment as the place it plays from.
  expect(bg.startedAt, 'the loop is the Go’d playback, carrying on').toBe(cue.background.startedAt);
  const goAt = bg.seek?.at ?? 0;
  return { goAt, loopDone: done.at };
}

test('Go, then the same video put up going round at once, nothing up before: every picture page draws it, and the next cue gets ready and goes', async () => {
  test.setTimeout(180_000);
  const { app, win, hall, stream, ids } = await setupVideoCue();
  const pages = { win, hall, stream };
  try {
    const first = ids[1] ?? '';
    const second = ids[0] ?? '';
    expect((await dispatch(win, { type: 'cueVideo', mediaId: first })).ok).toBe(true);
    await cueReady(win);
    const { goAt, loopDone } = await goThenLoopAtOnce(win, first);
    await test.info().attach('cuerace-times.json', {
      body: Buffer.from(JSON.stringify({ goAt, loopDone, leadLeftMs: goAt - loopDone })),
      contentType: 'application/json',
    });
    expect(loopDone, 'the loop went up before Go’s moment (else this walks no race)').toBeLessThan(goAt);
    const loop = await showing(win);
    await expect
      .poll(() => drawings(pages, loop), { message: 'the looping video drawn on every picture page' })
      .toEqual(EVERY_PAGE_DRAWS);
    // The next cue: prepared on every page as after any Go, then Go puts it up on each.
    expect((await dispatch(win, { type: 'cueVideo', mediaId: second })).ok).toBe(true);
    await cueReady(win);
    const next = (await snapshot(win)).videoCue;
    if (!next) throw new Error('no second cue');
    expect((await dispatch(win, { type: 'goVideoCue', cueId: next.id })).ok).toBe(true);
    await expect
      .poll(async () => drawings(pages, await showing(win)), {
        message: 'the second cued video drawn on every picture page after its Go',
      })
      .toEqual(EVERY_PAGE_DRAWS);
    expect(((await snapshot(win)).layers.background as { mediaId?: string } | null)?.mediaId).toBe(second);
  } finally {
    await app.close();
  }
});

test('Go over a video playing, then the cued video put up going round at once: every picture page leaves the one before for it, and the next cue gets ready', async () => {
  test.setTimeout(180_000);
  const { app, win, hall, stream, ids } = await setupVideoCue();
  const pages = { win, hall, stream };
  try {
    const first = ids[1] ?? '';
    const second = ids[0] ?? '';
    // The one before: the other video, going round, drawn on every page.
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: second, media: 'video', fit: 'fill', loop: true },
        })
      ).ok,
    ).toBe(true);
    const before = await showing(win);
    await expect
      .poll(() => drawings(pages, before), { message: 'the video before drawn on every picture page' })
      .toEqual(EVERY_PAGE_DRAWS);
    expect((await dispatch(win, { type: 'cueVideo', mediaId: first })).ok).toBe(true);
    await cueReady(win);
    const { goAt, loopDone } = await goThenLoopAtOnce(win, first);
    await test.info().attach('cuerace-times.json', {
      body: Buffer.from(JSON.stringify({ goAt, loopDone, leadLeftMs: goAt - loopDone })),
      contentType: 'application/json',
    });
    expect(loopDone, 'the loop went up before Go’s moment (else this walks no race)').toBeLessThan(goAt);
    const loop = await showing(win);
    await expect
      .poll(() => drawings(pages, loop), {
        message: 'the looping video drawn on every picture page, the one before gone',
      })
      .toEqual(EVERY_PAGE_DRAWS);
    expect((await dispatch(win, { type: 'cueVideo', mediaId: second })).ok).toBe(true);
    await cueReady(win);
    expect((await dispatch(win, { type: 'cancelVideoCue' })).ok).toBe(true);
    await expect.poll(async () => (await snapshot(win)).videoCue ?? null).toBeNull();
    expect(await showing(win)).toBe(loop);
  } finally {
    await app.close();
  }
});
