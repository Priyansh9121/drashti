import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EASE } from '../../src/renderer/src/render/easing';
import { dipsAndOvershoots, type FrameLight, swings } from '../../src/shared/flash';
import { MAX_TRANSITION_MS, TRANSITION_KINDS, type TransitionKind } from '../../src/shared/model';
import type { Movement } from '../../src/shared/looks';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  setUpScreen,
  windowShowing,
} from './helpers';
import { canvasPixels, lightOf } from './pixels';
import {
  drawPicture,
  engineState,
  goLive,
  halves,
  holdClock,
  makeSlides,
  plain,
  setTransition,
} from './placeholder-slides';

/*
 * The audience screens' motion, measured on their real frames (Session 27; the design lab's flash check,
 * src/shared/flash.ts). Every transition at its shortest allowed length (the slide editor's 0.1 s), its
 * output held at moments 60 times a second (a test switch, DRASHTI_TEST_CLOCK_HOLD):
 *   - at most 3 swings of light in any second, over the frame and in each quarter, and of saturated red;
 *   - never a dip below the darker end over the frame, nor where both slides are the same, and never above
 *     the brighter end (fade through black dips, by choice);
 *   - a key and fill pair: the key is exactly the fill's light part-way, at held moments;
 *   - a screen reloaded part-way through shows the new slide whole, never the old one fading out.
 * Each check was seen to fail under a named mutation (the session report). Generated pictures only.
 */

const FPS = 60;
const STEP = 1000 / FPS;
/** The slide editor's shortest transition (SlidePanel: 0.1 s). */
const SHORTEST = 100;
/** Every kind that takes time (a cut has no frames between). */
const KINDS: readonly TransitionKind[] = TRANSITION_KINDS.filter((k) => k !== 'cut');

/** Pictures: the same mid-dark left half, a dark or a bright right half; saturated red, and a grey of its light. */
const DARK = halves('70,70,110', '20,20,30');
const BRIGHT = halves('70,70,110', '235,235,215');
const RED = plain('255,0,0');
const GREY = plain('127,127,127');

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

/** The audience group's Movement in the live Look (an admin's choice in Screens). */
const setMovement = (win: Page, movement: Movement) =>
  win.evaluate(async (movement) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.role === 'audience')?.id ?? '';
    const set = await d.looks.setGroup((await d.engine.snapshot()).state.look.id, group, { movement });
    if (!set.ok) throw new Error(set.message);
  }, movement);

/** Wait until `out` draws the slide layer at `p` of its transition (1: done). */
async function drawnAt(out: Page, p: number): Promise<void> {
  if (p >= 1) await expect(out.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(0);
  else await expect(out.locator('[data-layer="slide"]')).toHaveAttribute('data-fade', p.toFixed(3));
}

/**
 * Each frame of the transition from slide `from` to slide `to`, as `outs` draw it, held 60 times a second
 * from just before it to 300 ms after it (as the lab samples, at twice its rate).
 */
async function framesOf(
  app: ElectronApplication,
  win: Page,
  outs: Page[],
  id: string,
  from: number,
  to: number,
  ms: number,
): Promise<FrameLight[][]> {
  await holdClock(app, null);
  await goLive(win, id, from);
  for (const out of outs) {
    await expect(out.locator('[data-layer="slide"] [data-slide]')).toHaveCount(1, { timeout: 10_000 });
    await drawnAt(out, 1);
  }
  // Held before the next slide comes on: it waits at its very start, on every screen alike.
  await holdClock(app, Date.now() - 60_000);
  await goLive(win, id, to);
  const shownAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
  const lights: FrameLight[][] = outs.map(() => []);
  for (let i = -2; i * STEP <= ms + 300; i++) {
    const t = Math.round(i * STEP);
    await holdClock(app, shownAt + t);
    for (const [n, out] of outs.entries()) {
      await drawnAt(out, Math.min(1, Math.max(0, t / ms)));
      lights[n]?.push(await lightOf(out));
    }
  }
  await holdClock(app, null);
  return lights;
}

/** Swings in each series of a transition's frames: the whole frame, each quarter, and saturated red. */
function measured(lights: FrameLight[]) {
  const whole = lights.map((l) => l.mean);
  const quads = [0, 1, 2, 3].map((k) => lights.map((l) => l.quad[k] ?? 0));
  const red = lights.map((l) => l.red);
  return {
    whole: swings(whole, FPS).worst,
    quads: quads.map((q) => swings(q, FPS).worst),
    // Saturated red: every swing counts, however bright its ends (WCAG 2.3.1's red flash).
    red: swings(red, FPS, 0.1, 2).worst,
    ...dipsAndOvershoots(whole),
    // The left quarters are the same on both slides of the dark-to-bright pair: they must hold steady.
    sameDips: [0, 2].some((k) => dipsAndOvershoots(quads[k] ?? []).dips),
    low: Math.min(...whole),
    high: Math.max(...whole),
  };
}

test('every transition at its shortest, Calm and Bold: at most 3 swings a second (red too), never a dip; a table of each', async () => {
  test.setTimeout(600_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-flash-'));
  const files = await Promise.all(
    (
      [
        ['Placeholder dark', DARK],
        ['Placeholder bright', BRIGHT],
        ['Placeholder red', RED],
        ['Placeholder grey', GREY],
      ] as const
    ).map(([name, patches]) => drawPicture(win, join(dir, `${name}.png`), [...patches])),
  );
  const [dark = '', bright = '', red = '', grey = ''] = await importAndGetIds(win, files);
  // Pictures alone (dark to bright, red to grey), then pictures with words, which the moves move.
  const id = await makeSlides(
    win,
    'Placeholder flash slides',
    [
      { picture: dark },
      { picture: bright },
      { picture: red },
      { picture: grey },
      { picture: dark, words: 'Placeholder words one\nPlaceholder line two' },
      { picture: bright, words: 'Placeholder words three\nPlaceholder line four' },
    ],
    { kind: 'cut', durationMs: 0 },
  );
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const table: string[] = [];
  const failures: string[] = [];
  for (const movement of ['calm', 'bold'] as const) {
    await setMovement(win, movement);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-movement', movement);
    for (const kind of KINDS) {
      await setTransition(win, id, { kind, durationMs: SHORTEST });
      for (const [pair, from, to] of [
        ['dark to bright', 0, 1],
        ['red to grey', 2, 3],
        ['words', 4, 5],
      ] as const) {
        const [lights = []] = await framesOf(app, win, [out], id, from, to, SHORTEST);
        const m = measured(lights);
        table.push(
          `${movement.padEnd(4)} ${kind.padEnd(13)} ${pair.padEnd(14)} ${String(SHORTEST)} ms: swings a second ${String(m.whole)} (quarters ${m.quads.join(' ')}), red ${String(m.red)}; light ${m.low.toFixed(3)} to ${m.high.toFixed(3)}${m.dips ? ', dips' : ''}${m.sameDips && pair === 'dark to bright' ? ', the same part dips' : ''}${m.overshoots ? ', overshoots' : ''}`,
        );
        const name = `${movement} ${kind}, ${pair}`;
        if (m.whole > 3 || m.quads.some((q) => q > 3)) failures.push(`${name}: more than 3 swings a second`);
        if (m.red > 3) failures.push(`${name}: saturated red swings more than 3 times a second`);
        // Never a dip (fade through black dips, by choice): over the whole frame, and where both slides are
        // the same. Two different colours of the same light (red to grey) mix a little darker part-way, as
        // every screen blends colours (in sRGB, not in light): no flash, so that pair is judged on its
        // swings. The slide moves whole slides (Repeat Slides' own, kept as chosen), so its same part does
        // not stay put. Words that move are judged on their swings.
        if (
          pair === 'dark to bright' &&
          kind !== 'fade-black' &&
          (m.dips || (m.sameDips && kind !== 'slide'))
        )
          failures.push(`${name}: dips below its darker end`);
        if (pair === 'dark to bright' && m.overshoots) failures.push(`${name}: rises above its brighter end`);
      }
    }
  }
  console.log(`FLASH TABLE\n${table.join('\n')}`);
  expect(failures).toEqual([]);
  await app.close();
});

test('a key and fill pair: the key is the fill’s light at held moments of every transition', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  // White blocks on nothing: the fill draws them over black, the key draws where they are, white.
  const id = await makeSlides(
    win,
    'Placeholder key slides',
    [
      {
        shapes: [{ x: 160, y: 200, width: 640, height: 680, fill: '#ffffff' }],
        words: 'Placeholder words one\nPlaceholder line two',
        wordsColor: '#ffffff',
      },
      {
        shapes: [{ x: 1120, y: 200, width: 640, height: 680, fill: '#ffffff' }],
        words: 'Placeholder words three\nPlaceholder line four',
        wordsColor: '#ffffff',
      },
    ],
    { kind: 'cut', durationMs: 0 },
  );
  const screens = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.screens.createGroup('Placeholder switcher');
    if (!made.ok) throw new Error(made.message);
    const group = made.snapshot.groups.find((g) => g.name === 'Placeholder switcher');
    const role = await d.screens.setGroupRole(group?.id ?? '', 'keyfill');
    if (!role.ok) throw new Error(role.message);
    // The main display and the test's extra one, a copy of it (CI's two), however many this computer has: the
    // fill's and the key's windows on one physical screen, so their pixels are read alike.
    const { displays } = made.snapshot;
    for (const display of [displays.find((x) => x.primary), displays[displays.length - 1]]) {
      if (!display) throw new Error('no main display');
      const used = await d.screens.assignDisplay(group?.id ?? '', display.id, { coverOperator: true });
      if (!used.ok) throw new Error(used.message);
    }
    // As designed, not as a lower third (a key and fill group starts with that): blocks with no words.
    const look = (await d.engine.snapshot()).state.look.id;
    const set = await d.looks.setGroup(look, group?.id ?? '', { slides: 'designed' });
    if (!set.ok) throw new Error(set.message);
    return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens ?? [];
  });
  expect(screens.map((s) => s.feed)).toEqual(['fill', 'key']);
  const fill = await outputFor(app, screens[0]?.id ?? '');
  const key = await outputFor(app, screens[1]?.id ?? '');
  for (const out of [fill, key])
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const failures: string[] = [];
  // Fade through black draws black over both: the key keys that black in (truly through black), so the two
  // are not alike by design while it runs.
  for (const movement of ['calm', 'bold'] as const)
    for (const kind of KINDS.filter((k) => k !== 'fade-black')) {
      await win.evaluate(async (movement) => {
        const d = (globalThis as PageGlobals).drashti;
        const group = (await d.screens.get()).groups.find((g) => g.role === 'keyfill')?.id ?? '';
        const set = await d.looks.setGroup((await d.engine.snapshot()).state.look.id, group, { movement });
        if (!set.ok) throw new Error(set.message);
      }, movement);
      await setTransition(win, id, { kind, durationMs: SHORTEST });
      const [f = [], k = []] = await framesOf(app, win, [fill, key], id, 0, 1, SHORTEST);
      for (const [i, light] of f.entries()) {
        const other = k[i];
        const off = other
          ? Math.max(
              Math.abs(light.mean - other.mean),
              ...light.quad.map((q, n) => Math.abs(q - (other.quad[n] ?? 0))),
            )
          : 1;
        if (off > 0.01)
          failures.push(`${kind}, frame ${String(i)}: the key is ${off.toFixed(3)} from the fill`);
      }
    }
  expect(failures).toEqual([]);
  await app.close();
});

test('a screen reloaded part-way through any transition shows the new slide whole', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-reload-'));
  const files = await Promise.all([
    drawPicture(win, join(dir, 'Placeholder dark.png'), [...DARK]),
    drawPicture(win, join(dir, 'Placeholder bright.png'), [...BRIGHT]),
  ]);
  const [dark = '', bright = ''] = await importAndGetIds(win, files);
  // Long enough that the screen is back while it still runs: the longest Drashti allows (10 s), so a slow
  // machine has room (an 8 s one ended first on a slow Windows CI machine, Session 49).
  const MS = MAX_TRANSITION_MS;
  const id = await makeSlides(win, 'Placeholder reload slides', [{ picture: dark }, { picture: bright }], {
    kind: 'cut',
    durationMs: 0,
  });
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const RIGHT = { x: 1440, y: 540 };
  for (const movement of ['calm', 'bold'] as const)
    for (const kind of KINDS) {
      await setMovement(win, movement);
      await setTransition(win, id, { kind: 'cut', durationMs: 0 });
      await goLive(win, id, 0);
      await expect(out.locator('[data-layer="slide"] img')).toHaveCount(1);
      await setTransition(win, id, { kind, durationMs: MS });
      await goLive(win, id, 1);
      const shownAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
      await expect(out.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(1);
      await out.reload();
      await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
      await expect(out.locator('[data-layer="slide"] img')).toHaveCount(1);
      const [colour] = await canvasPixels(out, [RIGHT]);
      // Still inside the transition, by the engine's clock: otherwise this would prove nothing.
      expect(Date.now(), `${kind}: back after the transition had ended`).toBeLessThan(shownAt + MS);
      expect(await out.locator('[data-layer="slide"][data-fading="true"]').count(), kind).toBe(0);
      expect(
        colour !== undefined && [235, 235, 215].every((c, i) => Math.abs((colour[i] ?? -999) - c) <= 12),
        `${kind}: ${String(colour)} where the new slide is bright`,
      ).toBe(true);
    }
  await app.close();
});

test('the held clock reaches the stream’s picture: part-way through a dissolve it draws what the hall’s screen does', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-held-'));
  const files = await Promise.all([
    drawPicture(win, join(dir, 'Placeholder dark.png'), [...DARK]),
    drawPicture(win, join(dir, 'Placeholder bright.png'), [...BRIGHT]),
  ]);
  const [dark = '', bright = ''] = await importAndGetIds(win, files);
  const MS = 1000;
  const id = await makeSlides(win, 'Placeholder stream slides', [{ picture: dark }, { picture: bright }], {
    kind: 'dissolve',
    durationMs: MS,
  });
  await setUpScreen(win);
  const hall = await outputPage(app);
  await expect(hall.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await win.getByTestId('open-stream').click();
  const isStream = (p: Page) => p.url().includes('stream.html');
  const program = await windowShowing(app, isStream, 'stream');
  await expect(program.getByTestId('program-root')).toBeVisible();
  const [lights = [], streamLights = []] = await framesOf(app, win, [hall, program], id, 0, 1, MS);
  // The stream's page is drawn off screen, without the display's colour profile: about 5% brighter
  // throughout. What must match is where each frame is in the dissolve, its light between start and end.
  const progress = (ls: FrameLight[]) => {
    const first = ls[0]?.mean ?? 0;
    const last = ls[ls.length - 1]?.mean ?? 1;
    return ls.map((l) => (l.mean - first) / (last - first));
  };
  const [a, b] = [progress(lights), progress(streamLights)];
  expect(b).toHaveLength(a.length);
  const off = a.map((v, i) => Math.abs(v - (b[i] ?? 9)));
  expect(
    Math.max(...off),
    'where the stream is in the dissolve against the hall, frame by frame',
  ).toBeLessThan(0.02);
  await app.close();
});

test('every move draws the words apart where it should: the pictures and the background only dissolve, then the slide is whole again; Calm fades the Bold kinds; never word by word on a kirtan', async () => {
  test.setTimeout(400_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-apart-'));
  const files = await Promise.all([
    drawPicture(win, join(dir, 'Placeholder dark.png'), [...DARK]),
    drawPicture(win, join(dir, 'Placeholder bright.png'), [...BRIGHT]),
    drawPicture(win, join(dir, 'Placeholder backdrop one.png'), plain('40,90,40')),
    drawPicture(win, join(dir, 'Placeholder backdrop two.png'), plain('200,120,60')),
  ]);
  const [dark = '', bright = '', backOne = '', backTwo = ''] = await importAndGetIds(win, files);
  const MS = 1000;
  const id = await makeSlides(
    win,
    'Placeholder apart slides',
    [
      { picture: dark, words: 'Placeholder words one\nPlaceholder line two', backgroundCue: backOne },
      { picture: bright, words: 'Placeholder words three\nPlaceholder line four', backgroundCue: backTwo },
    ],
    { kind: 'dissolve', durationMs: MS },
  );
  // Each picture covers only the top half of the slide, so the background shows below it.
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const opened = await d.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    for (const slide of opened.doc.groups.flatMap((g) => g.slides))
      for (const el of slide.elements)
        if (el.kind === 'image')
          el.frame = { x: 0, y: 0, width: opened.doc.width, height: opened.doc.height / 2 };
    const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
    if (!saved.ok) throw new Error(saved.message);
  }, id);
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  // A point on the slide's picture (its top edge) and one on the background (its bottom edge), clear of the words.
  const PICTURE = { x: 240, y: 40 };
  const BACKGROUND = { x: 240, y: 1040 };
  const mixed = (a: readonly number[], b: readonly number[], e: number) =>
    a.map((c, i) => c * (1 - e) + (b[i] ?? 0) * e);
  const near = (got: readonly number[] | undefined, want: readonly number[], within = 18) =>
    got !== undefined && want.every((c, i) => Math.abs((got[i] ?? -999) - c) <= within);
  const failures: string[] = [];
  const run = async (movement: 'calm' | 'bold', kind: TransitionKind, apart: string | null, label = '') => {
    await setMovement(win, movement);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-movement', movement);
    await setTransition(win, id, { kind, durationMs: MS });
    await holdClock(app, null);
    await goLive(win, id, 0);
    await expect(out.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(0, { timeout: 10_000 });
    // The background settled too: slide one's picture alone, whole. A picture slow to be ready dissolves in
    // late, and a dissolve still running finishes before the next one starts (Session 23): Checkpoint D's
    // Mac drew that one where this one should have been.
    const pictures = out.locator('[data-layer="background"] [data-bg-slot]');
    await expect(pictures.and(out.locator(`[data-media-id="${backOne}"]`))).toHaveAttribute(
      'data-state',
      'ready',
    );
    await expect(out.locator('[data-layer="background"][data-fading="true"]')).toHaveCount(0);
    await expect(pictures).toHaveCount(1);
    await holdClock(app, Date.now() - 60_000);
    await goLive(win, id, 1);
    const shownAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
    // Slide two's picture ready before the clock moves on, so its dissolve starts with the slide's.
    await expect(pictures.and(out.locator(`[data-media-id="${backTwo}"][data-state="ready"]`))).toHaveCount(
      1,
    );
    const name = `${movement} ${kind}${label}`;
    for (const p of [0.25, 0.5, 0.75]) {
      await holdClock(app, shownAt + p * MS);
      await drawnAt(out, p);
      // Counted first: getAttribute would wait for one that is rightly not there.
      const apartNow = out.locator('[data-words-apart]');
      const has = (await apartNow.count()) > 0 ? await apartNow.getAttribute('data-words-apart') : null;
      if (has !== apart)
        failures.push(`${name} at ${String(p)}: words apart ${String(has)}, wanted ${String(apart)}`);
      const [picture = [], back = []] = await canvasPixels(out, [PICTURE, BACKGROUND]);
      const e = (movement === 'bold' ? EASE.inOut : EASE.smooth)(p);
      if (!near(picture, [70, 70, 110]))
        failures.push(`${name} at ${String(p)}: the picture is ${String(picture)}`);
      if (!near(back, mixed([40, 90, 40], [200, 120, 60], e)))
        failures.push(`${name} at ${String(p)}: the background is ${String(back)}`);
    }
    await holdClock(app, shownAt + MS + 100);
    await drawnAt(out, 1);
    if ((await out.locator('[data-words-apart], [data-words-hidden]').count()) > 0)
      failures.push(`${name}: still apart once over`);
    await holdClock(app, null);
  };
  // Bold: each move draws the words apart; the pictures only dissolve, on Bold's curve.
  for (const [kind, apart] of [
    ['dissolve', 'settle'],
    ['wipe', 'wipe'],
    ['push', 'push'],
    ['zoom-dissolve', 'zoom'],
    ['lines', 'lines'],
    ['words', 'words'],
  ] as const)
    await run('bold', kind, apart);
  // Calm: the Bold kinds fade (whole slides); line by line and word by word reveal the words.
  for (const [kind, apart] of [
    ['dissolve', null],
    ['wipe', null],
    ['push', null],
    ['zoom-dissolve', null],
    ['lines', 'lines'],
    ['words', 'words'],
  ] as const)
    await run('calm', kind, apart);
  // A kirtan's slides are never word by word, whatever the Look: its dissolve instead.
  await win.evaluate(async (id) => {
    const set = await (globalThis as PageGlobals).drashti.kirtans.setDetails(id, {
      category: null,
      kavi: 'Placeholder kavi',
      raag: null,
      occasions: [],
      audioMediaId: null,
    });
    if (!set.ok) throw new Error(set.message);
  }, id);
  await run('bold', 'words', 'settle', ' (a kirtan)');
  await run('calm', 'words', null, ' (a kirtan)');
  // A cut: whole slides, at once.
  await setTransition(win, id, { kind: 'cut', durationMs: 0 });
  await goLive(win, id, 0);
  await expect(out.locator('[data-words-apart]')).toHaveCount(0);
  expect(failures).toEqual([]);
  await app.close();
});
