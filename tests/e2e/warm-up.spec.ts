import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOWER_THIRD_FONT_CHOICES } from '../../src/shared/lower-third-fonts';
import { MOVEMENTS } from '../../src/shared/looks';
import { TRANSITION_KINDS } from '../../src/shared/model';
import { launchApp, operatorPage, operatorReady, outputPage, outputPages, setUpScreen } from './helpers';
import { goLive, makeSlides } from './placeholder-slides';

/*
 * Warming the GPU, unseen (Session 27, render/WarmUp.tsx): before a screen first draws the show, it draws
 * every transition kind in both Movements part-way, with a lower third, messages and the ticker's band (the
 * idle rotation went in Session 55), under a brightness(0) filter, so the GPU has made what they need before the first
 * Bold transition of a show; the audience sees black throughout. A test switch keeps it drawn, to look at.
 * Where Chromium draws without a graphics chip there is nothing to warm, and an output draws the show without
 * one (Session 57): a test switch says how Chromium draws, so both kinds of computer are tried on every system.
 * A scene that fails as it draws (another test switch) ends the warm-up there, and the page draws the show: never
 * black for good, never reloaded for it (Session 57, the review of h-maskperf's MEDIUM-1).
 * Placeholder words and pictures only.
 */

const HOLD = { DRASHTI_TEST_HOLD_WARM_UP: '1' };

/**
 * Chromium's word on how it draws held back until the test gives it (Main's drashtiTestGpuSaid), and every page's
 * warm-up kept drawn till then, as a slow computer's still runs when Chromium says (a test switch, Session 57).
 */
const SAID_LATE = { DRASHTI_TEST_GPU_SAID: 'late' };

/** Main's own test hook for that (never in a packaged Drashti). */
interface MainGlobals {
  drashtiTestGpuSaid?: () => void;
}

/** How Main reads Chromium's gpu_compositing once Chromium has said how it draws (a test switch, Session 57). */
const WITH_A_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'enabled' };
const WITHOUT_A_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software' };
/** The log's line for an output without a graphics chip. */
const SKIPPED =
  /^Warm-up: skipped, no graphics chip \(gpu_compositing disabled_software\), for output ".+"$/u;

/**
 * One warm-up scene made to fail as it draws part-way, on every page that warms up, as a bug in any scene would (a test
 * switch, never in an installed Drashti, Session 57): a deck's own Cover, which runs a deck's code on every screen at
 * every start.
 */
const SCENE_FAILS = { DRASHTI_TEST_WARM_UP_FAILS: 'deck-cover/calm' };

/** What Drashti's log has said of render errors (Session 23), each line from its "Render error in". */
function renderErrorLines(userData: string): string[] {
  const file = join(userData, 'logs', 'drashti.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes('Render error in '))
    .map((line) => line.slice(line.indexOf('Render error in ')).trimEnd());
}

/** Main's watchdog, as the end-to-end tests read it (render-errors.spec.ts). */
interface WatchdogGlobals {
  drashtiDiagnostics: { watchdog: { events: { window: string; kind: string }[] } };
}

/** What Drashti's log has said of its outputs' warm-ups (Session 57), each line from its "Warm-up:". */
function warmUpLines(userData: string): string[] {
  const file = join(userData, 'logs', 'drashti.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes('Warm-up: '))
    .map((line) => line.slice(line.indexOf('Warm-up: ')).trimEnd());
}

/**
 * The log says which Main chose for the output: once for each output window (one made again, after a display change
 * say, is decided afresh and said again), and never the other choice.
 */
async function expectSaid(userData: string, said: RegExp): Promise<void> {
  await expect
    .poll(() => warmUpLines(userData).length, { message: 'the log’s Warm-up lines' })
    .toBeGreaterThan(0);
  for (const line of warmUpLines(userData)) expect(line).toMatch(said);
}

/** A page's warm-up marks for a trace (render/WarmUp.tsx), in the order they came. */
const warmUpMarks = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('mark')
      .map((m) => m.name)
      .filter((name) => name.startsWith('drashti-warm-up')),
  );

/** The Lower Thirds studio's font families (Session 55, Part 16), bundled with Drashti. */
const STUDIO_FAMILIES = LOWER_THIRD_FONT_CHOICES.filter((c) => c.bundled === 'studio').flatMap(
  (c) => c.families,
);

/**
 * How many of the studio's font faces a page has, by how far each has loaded ("unloaded": never asked for). A page
 * asks for them once it has drawn, never with its start (Session 55: with an output's start they kept its show from its
 * screen longer, PERF-1).
 */
const studioFonts = (page: Page) =>
  page.evaluate((families) => {
    const by: Record<string, number> = {};
    for (const face of Array.from(document.fonts))
      if (families.includes(face.family.replace(/["']/gu, ''))) by[face.status] = (by[face.status] ?? 0) + 1;
    return by;
  }, STUDIO_FAMILIES);

/**
 * The brightest any pixel is (0 to 255, any channel) in a page's screenshot, or in one element's box of it,
 * 2 px in from its edges (a box at fractions of a pixel takes in what is around it: the LIVE picture's border).
 */
async function brightest(page: Page, selector?: string): Promise<number> {
  const box = selector ? await page.locator(selector).first().boundingBox() : null;
  const clip = box ? { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 } : null;
  const png = (await page.screenshot({ scale: 'css', ...(clip ? { clip } : {}) })).toString('base64');
  return page.evaluate(async (png) => {
    // Decoded by hand: the page's security policy refuses fetch() of a data URL.
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let max = 0;
    for (let i = 0; i < data.length; i += 4)
      max = Math.max(max, data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    return max;
  }, png);
}

/**
 * Each warm-up scene in `scope` as drawn now: its slide's transition, how far through, its words apart. Its
 * shadow tree is open only while the test switch keeps it drawn (closed, nothing finds it).
 */
const scenesIn = (page: Page, scope: string) =>
  page.evaluate((scope) => {
    const tree = document.querySelector(scope)?.querySelector('[data-warm-up]')?.shadowRoot;
    return [...(tree?.querySelectorAll<HTMLElement>('[data-warm-scene]') ?? [])].map((s) => {
      const layer = s.querySelector<HTMLElement>('[data-layer="slide"]');
      return {
        key: s.dataset['warmScene'] ?? '',
        kind: layer?.dataset['transition'] ?? '',
        fade: Number(layer?.dataset['fade'] ?? Number.NaN),
        apart: s.querySelector('[data-words-apart]')?.getAttribute('data-words-apart') ?? '',
        lowerThird: s.querySelector('[data-testid="lower-third"]') !== null,
        messages: s.querySelector('[data-layer="messages"]') !== null,
        ticker: s.querySelector('[data-layer="ticker"]') !== null,
      };
    });
  }, scope);

/** How each kind's words move on a Bold screen while it runs (a Calm one: only line by line and word by word). */
const BOLD_APART: Record<string, string> = {
  dissolve: 'settle',
  wipe: 'wipe',
  push: 'push',
  'zoom-dissolve': 'zoom',
  lines: 'lines',
  words: 'words',
};

/** What a page's warm-up draws, part-way, and that all of it is black. */
async function expectWarmUp(page: Page, scope: string, what: string, ticker = true): Promise<void> {
  await expect(page.locator(`${scope} [data-warm-up="during"]`), what).toHaveCount(1, { timeout: 30_000 });
  // Every frame of a transition that runs ten seconds, drawn by its own clock: part-way when looked at.
  await expect
    .poll(async () =>
      (await scenesIn(page, scope)).every(
        (s) => !s.key.includes('/') || !Number.isNaN(s.fade) || s.key.startsWith('lower-third'),
      ),
    )
    .toBe(true);
  const scenes = await scenesIn(page, scope);
  for (const movement of MOVEMENTS)
    for (const kind of TRANSITION_KINDS.filter((k) => k !== 'cut')) {
      const s = scenes.find((x) => x.key === `${kind}/${movement}`);
      expect(s?.kind, `${what}: ${kind} on ${movement}`).toBe(kind);
      expect(s?.fade, `${what}: ${kind} on ${movement} part-way`).toBeGreaterThan(0.3);
      expect(s?.fade, `${what}: ${kind} on ${movement} part-way`).toBeLessThan(0.7);
      const apart =
        movement === 'bold' ? (BOLD_APART[kind] ?? '') : kind === 'lines' || kind === 'words' ? kind : '';
      expect(s?.apart, `${what}: ${kind} on ${movement}, the words`).toBe(apart);
    }
  for (const movement of MOVEMENTS) {
    const fade = scenes.find((x) => x.key === `dissolve/${movement}`);
    expect(fade?.messages, `${what}: a message coming in on ${movement}`).toBe(true);
    expect(fade?.ticker, `${what}: the ticker's band on ${movement}`).toBe(ticker);
    for (const phase of ['in', 'change'])
      expect(
        scenes.find((x) => x.key === `lower-third-${phase}/${movement}`)?.lowerThird,
        `${what}: a lower third ${phase} on ${movement}`,
      ).toBe(true);
  }
  // The idle rotation's dissolve went with it (Session 55, Part 12): none is drawn.
  expect(scenes.map((x) => x.key)).not.toContain('idle');
  // The audience sees none of it.
  expect(await brightest(page, `${scope} [data-warm-up]`), `${what}: black throughout`).toBe(0);
}

async function streamPage(app: ElectronApplication): Promise<Page> {
  const isStream = (p: Page) => p.url().includes('stream.html');
  return app.windows().find(isStream) ?? app.waitForEvent('window', { predicate: isStream });
}

test('before a screen first draws the show it draws every kind in both Movements part-way, unseen: an output, the LIVE picture and the stream’s page', async () => {
  test.setTimeout(180_000);
  // Kept drawn even where Main says Chromium draws without a graphics chip (Session 57): a test asked to look at it.
  const { app } = await launchApp({
    ...HOLD,
    ...WITHOUT_A_CHIP,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await expectWarmUp(win, '[data-testid="live-preview"]', 'the LIVE picture');
  await setUpScreen(win);
  const out = await outputPage(app);
  await expectWarmUp(out, '[data-testid="output-root"]', 'an output');
  // Until it is done, the show is not drawn there (nor is the screen ready).
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'loading');
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-warm-up', 'warming');
  expect(await brightest(out), 'the whole output').toBe(0);
  // Its own Noto fonts are in, and none of the Lower Thirds studio's is asked for while it starts (Session 55).
  expect(Object.keys(await studioFonts(out)), 'an output’s start: the studio’s fonts').toEqual(['unloaded']);
  expect(Object.keys(await studioFonts(win)), 'the LIVE picture’s start: the studio’s fonts').toEqual([
    'unloaded',
  ]);
  await win.getByTestId('open-stream').click();
  const program = await streamPage(app);
  // The stream draws no ticker.
  await expectWarmUp(program, '[data-testid="program-root"]', 'the stream’s page', false);
  expect(Object.keys(await studioFonts(program)), 'the stream’s page’s start: the studio’s fonts').toEqual([
    'unloaded',
  ]);
  await app.close();
});

test('with a graphics chip the warm-up passes by itself and the show is drawn after it; the screen is black until then', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({ ...WITH_A_CHIP, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder warm-up slides',
    [{ words: 'Placeholder words', background: '#3a6ea5' }],
    {
      kind: 'dissolve',
      durationMs: 400,
    },
  );
  await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
    timeout: 60_000,
  });
  // Every frame each new window draws, from its first: the brightest pixel (every 7th looked at).
  await app.evaluate(({ app }) => {
    const seen = new Map<number, { url: string; frames: number; max: number; stop: () => void }>();
    (globalThis as { warmFrames?: typeof seen }).warmFrames = seen;
    app.on('browser-window-created', (_event, w) => {
      const id = w.webContents.id;
      const mine = { url: '', frames: 0, max: 0, stop: () => w.webContents.endFrameSubscription() };
      seen.set(id, mine);
      // From its page's first moments (a frame subscription before then gets nothing): the warm-up waits
      // for the fonts and its pictures, so it has drawn nothing yet.
      w.webContents.once('dom-ready', () => {
        w.webContents.beginFrameSubscription(false, (image) => {
          const bitmap = image.toBitmap();
          let max = 0;
          for (let i = 0; i + 2 < bitmap.length; i += 28)
            max = Math.max(max, bitmap[i] ?? 0, bitmap[i + 1] ?? 0, bitmap[i + 2] ?? 0);
          mine.url = w.webContents.getURL();
          mine.frames += 1;
          mine.max = Math.max(mine.max, max);
        });
      });
    });
  });
  await setUpScreen(win);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const out = await outputPage(app);
  const root = out.getByTestId('output-root');
  await expect(root).toHaveAttribute('data-warm-up', 'done', { timeout: 60_000 });
  const frames = await app.evaluate(() => {
    const seen = (
      globalThis as {
        warmFrames?: Map<number, { url: string; frames: number; max: number; stop: () => void }>;
      }
    ).warmFrames;
    const all = [...(seen?.values() ?? [])];
    for (const w of all) w.stop();
    const output = all.find((w) => w.url.includes('output.html'));
    return {
      frames: output?.frames ?? 0,
      max: output?.max ?? -1,
      windows: all.map((w) => `${w.url.split('?')[0] ?? ''} ${String(w.frames)}`),
    };
  });
  expect(frames.frames, `frames drawn while it warmed up (${frames.windows.join('; ')})`).toBeGreaterThan(3);
  expect(frames.max, `black throughout (${String(frames.frames)} frames)`).toBe(0);
  await expect(root).toHaveAttribute('data-fonts', 'ready');
  await expect(out.locator('[data-warm-up]')).toHaveCount(1);
  await expect(out.locator('[data-warm-scene]')).toHaveCount(0);
  // Then the show draws as ever.
  await goLive(win, id, 0);
  await expect.poll(() => brightest(out), { timeout: 15_000 }).toBeGreaterThan(40);
  // And once it has drawn, every face of the Lower Thirds studio's fonts comes (Session 55), as in the LIVE picture.
  await expect.poll(async () => Object.keys(await studioFonts(out)), { timeout: 15_000 }).toEqual(['loaded']);
  await expect.poll(async () => Object.keys(await studioFonts(win)), { timeout: 15_000 }).toEqual(['loaded']);
  // The log says which Main chose for the output (Session 57).
  await expectSaid(
    userData,
    /^Warm-up: as before, a graphics chip \(gpu_compositing enabled\), for output ".+"$/u,
  );
  await app.close();
});

test('where Chromium draws without a graphics chip an output draws the show without a warm-up, black until then, and the log says so once', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({ ...WITHOUT_A_CHIP, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder slides without a chip',
    [{ words: 'Placeholder words', background: '#3a6ea5' }],
    { kind: 'dissolve', durationMs: 400 },
  );
  // The LIVE picture warms up as before (only the outputs are told): once it has drawn, Chromium has said how it
  // draws, so the output below opens knowing it.
  await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await setUpScreen(win);
  const out = await outputPage(app);
  const root = out.getByTestId('output-root');
  // Ready to draw the show, without warming up: it never began a warm-up (none of its marks).
  await expect(root).toHaveAttribute('data-warm-up', 'skipped', { timeout: 60_000 });
  await expect(root).toHaveAttribute('data-fonts', 'ready');
  expect(await warmUpMarks(out), 'the output’s warm-up marks').toEqual([]);
  // The show drawn at once, black until something goes up (nothing up, no wallpaper chosen).
  await expect(out.getByTestId('scene')).toHaveAttribute('data-nothing-up', 'black');
  expect(await brightest(out), 'the whole output').toBe(0);
  // Then the show draws as ever.
  await goLive(win, id, 0);
  await expect.poll(() => brightest(out), { timeout: 15_000 }).toBeGreaterThan(40);
  await expect(root).toHaveAttribute('data-warm-up', 'skipped');
  // The log says which Main chose for the output.
  await expectSaid(userData, SKIPPED);
  await app.close();
});

test('an output told it draws without a graphics chip after its warm-up began ends the warm-up there and draws the show, black until something goes up', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({
    ...WITHOUT_A_CHIP,
    ...SAID_LATE,
    DRASHTI_WINDOWED_OUTPUTS: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder slides told late',
    [{ words: 'Placeholder words', background: '#3a6ea5' }],
    { kind: 'dissolve', durationMs: 400 },
  );
  await setUpScreen(win);
  const out = await outputPage(app);
  const root = out.getByTestId('output-root');
  // Opened before Chromium said how it draws: warming up, black, and nothing said in the log yet.
  await expect(out.locator('[data-testid="output-root"] [data-warm-up="during"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(root).toHaveAttribute('data-warm-up', 'warming');
  await expect(root).toHaveAttribute('data-fonts', 'loading');
  expect(await warmUpMarks(out), 'the output’s warm-up marks as it warms up').toEqual([
    'drashti-warm-up:output',
  ]);
  expect(await brightest(out), 'the whole output, warming up').toBe(0);
  expect(warmUpLines(userData), 'the log before Chromium has said').toEqual([]);
  // Chromium says it draws without a graphics chip: the warm-up ends there, cut, never drawn to its end.
  await app.evaluate(() => {
    (globalThis as MainGlobals).drashtiTestGpuSaid?.();
  });
  await expect(root).toHaveAttribute('data-warm-up', 'skipped');
  await expect(root).toHaveAttribute('data-fonts', 'ready');
  // Marked as the warm-up goes (its effect's cleanup, which React may run a moment after the page changed).
  await expect
    .poll(() => warmUpMarks(out), { message: 'the output’s warm-up marks once told' })
    .toEqual(['drashti-warm-up:output', 'drashti-warm-up:output-cut']);
  // The show drawn from there, black until something goes up.
  await expect(out.getByTestId('scene')).toHaveAttribute('data-nothing-up', 'black');
  expect(await brightest(out), 'the whole output, told').toBe(0);
  await goLive(win, id, 0);
  await expect.poll(() => brightest(out), { timeout: 15_000 }).toBeGreaterThan(40);
  await expect(root).toHaveAttribute('data-warm-up', 'skipped');
  await expectSaid(userData, SKIPPED);
  await app.close();
});

test('a warm-up scene that fails as it draws ends the warm-up there and the show draws, logged once and never reloaded: an output, the LIVE picture and the stream’s page', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({
    ...WITH_A_CHIP,
    ...SCENE_FAILS,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder slides after a failed warm-up',
    [{ words: 'Placeholder words', background: '#3a6ea5' }],
    { kind: 'dissolve', durationMs: 400 },
  );
  await setUpScreen(win);
  const out = await outputPage(app);
  const root = out.getByTestId('output-root');
  // The hall's screen: its warm-up ended where the scene failed, through the same hand-over as one drawn to its end
  // (never cut, never at its cap), and only once.
  await expect(root).toHaveAttribute('data-warm-up', 'done', { timeout: 60_000 });
  await expect(root).toHaveAttribute('data-fonts', 'ready');
  await expect
    .poll(() => warmUpMarks(out), { message: 'the output’s warm-up marks' })
    .toEqual(['drashti-warm-up:output', 'drashti-warm-up:output-error', 'drashti-warm-up:output-end']);
  // The show drawn from there: black until something goes up, never the black of a scene that failed.
  await expect(out.getByTestId('scene')).toHaveAttribute('data-nothing-up', 'black');
  await expect(out.locator('[data-render-error]')).toHaveCount(0);
  // The LIVE picture, warmed up as the operator window opened (nothing up since): the same.
  const live = win.getByTestId('live-preview');
  await expect
    .poll(() => warmUpMarks(win), { message: 'the LIVE picture’s warm-up marks', timeout: 60_000 })
    .toContain('drashti-warm-up:live-end');
  const liveMarks = await warmUpMarks(win);
  expect(liveMarks, 'the LIVE picture’s warm-up marks').toContain('drashti-warm-up:live-error');
  expect(liveMarks, 'the LIVE picture’s warm-up marks').not.toContain('drashti-warm-up:live-cap');
  expect(liveMarks.at(-1), 'the LIVE picture’s last warm-up mark').toBe('drashti-warm-up:live-end');
  await expect(live.locator('[data-warm-up]')).toHaveCount(0);
  await expect(live.locator('[data-render-error]')).toHaveCount(0);
  await expect(live.getByTestId('scene')).toHaveCount(1);
  // Then the show draws as ever.
  await goLive(win, id, 0);
  await expect.poll(() => brightest(out), { timeout: 15_000 }).toBeGreaterThan(40);
  // The stream's page the same.
  await win.getByTestId('open-stream').click();
  const program = await streamPage(app);
  const programRoot = program.getByTestId('program-root');
  await expect(programRoot).toHaveAttribute('data-warm-up', 'done', { timeout: 60_000 });
  await expect(programRoot).toHaveAttribute('data-fonts', 'ready');
  const streamMarks = await warmUpMarks(program);
  expect(streamMarks, 'the stream’s page’s warm-up marks').toContain('drashti-warm-up:stream-error');
  expect(streamMarks, 'the stream’s page’s warm-up marks').not.toContain('drashti-warm-up:stream-cap');
  expect(streamMarks.at(-1), 'the stream’s page’s last warm-up mark').toBe('drashti-warm-up:stream-end');
  await expect(program.locator('[data-render-error]')).toHaveCount(0);
  await expect(program.getByTestId('program-picture')).toHaveCount(1);
  // Each page's error is in the log once, as its warm-up's, and the hall's screen was never reloaded for it: the
  // watchdog was never told (a reload would only warm up, and fail, again).
  await expect
    .poll(() => renderErrorLines(userData).length, { message: 'the log’s render-error lines' })
    .toBe(3);
  const lines = renderErrorLines(userData);
  for (const line of lines)
    expect(line).toMatch(
      /^Render error in .+ \(warm-up\): Error: A test asked this warm-up scene to fail as it drew/u,
    );
  expect(
    lines
      .map((line) => /^Render error in (operator|output|the stream’s page)\b/u.exec(line)?.[1] ?? line)
      .sort(),
  ).toEqual(['operator', 'output', 'the stream’s page']);
  const watched = await app.evaluate(() =>
    (globalThis as unknown as WatchdogGlobals).drashtiDiagnostics.watchdog.events
      .filter((e) => e.window.startsWith('output '))
      .map((e) => e.kind),
  );
  expect(watched, 'the watchdog’s events for the output').toEqual([]);
  await expect(root).toHaveAttribute('data-warm-up', 'done');
  await app.close();
});
