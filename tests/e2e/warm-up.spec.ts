import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOWER_THIRD_FONT_CHOICES } from '../../src/shared/lower-third-fonts';
import { MOVEMENTS } from '../../src/shared/looks';
import { TRANSITION_KINDS } from '../../src/shared/model';
import {
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';
import { decodePng } from './png-decode';

/*
 * Warming the GPU, unseen (Session 27, render/WarmUp.tsx): before a screen first draws the show, it draws
 * every transition kind in both Movements part-way, with a lower third, messages and the ticker's band (the
 * idle rotation went in Session 55), under translucent black covers in separate groups, so the GPU has made what they need before the first
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

/** What Drashti's log has said of how its outputs' warm-ups ended (Session 58, WU-2), each line from its "Warm-up of". */
function warmUpEndLines(userData: string): string[] {
  const file = join(userData, 'logs', 'drashti.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes('Warm-up of '))
    .map((line) => line.slice(line.indexOf('Warm-up of ')).trimEnd());
}

/** The log says how the output's warm-up ended and how long it took, once (Session 58, WU-2). */
async function expectEnded(userData: string, ended: RegExp): Promise<void> {
  await expect
    .poll(() => warmUpEndLines(userData), { message: 'the log’s Warm-up of lines' })
    .toHaveLength(1);
  expect(warmUpEndLines(userData)[0]).toMatch(ended);
}

/**
 * The log says which Main chose for the output: once for each output window (one made again, after a display change
 * say, is decided afresh and said again), and never the other choice. (The LIVE picture's and the stream's page's own
 * lines, since Session 58, are their tests'.)
 */
async function expectSaid(userData: string, said: RegExp): Promise<void> {
  const outputs = () => warmUpLines(userData).filter((line) => line.includes(', for output "'));
  await expect.poll(() => outputs().length, { message: 'the log’s Warm-up lines' }).toBeGreaterThan(0);
  for (const line of outputs()) expect(line).toMatch(said);
}

/** The log's line for the LIVE picture where Chromium draws without a graphics chip (Session 58, WU-1). */
const LIVE_SKIPPED =
  'Warm-up: skipped, no graphics chip (gpu_compositing disabled_software), for the LIVE picture';

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

/** The brightest any pixel is (0 to 255, any channel) in the whole page, decoded in Node. */
async function brightest(page: Page): Promise<number> {
  const decoded = decodePng(await page.screenshot({ scale: 'css' }));
  let max = 0;
  for (let i = 0; i < decoded.rgba.length; i += 4)
    max = Math.max(max, decoded.rgba[i] ?? 0, decoded.rgba[i + 1] ?? 0, decoded.rgba[i + 2] ?? 0);
  return max;
}

/**
 * Every pixel of the warm-up's whole box against black alone, including its edges. A LIVE picture's rounded UI
 * border crosses that rectangle's corners, so its pixels must match the black-only frame too, rather than be
 * mistaken for the warm-up's drawing (X12 wide: 12 border pixels, maximum 191, while every interior pixel was 0).
 * Nothing else is ignored or allowed a colour difference. The whole audience output and every captured frame are still
 * checked against absolute zero below. Decode in Node, never on a show page (X17).
 * One allowance, the LIVE picture's only (a21, the owner's B): its box's own antialiased corner pixels, where the box
 * alone (the warm-up hidden) is neither black nor anything else of the warm-up's, may differ by 2 levels at most. On
 * CI's Mac Chromium composes those pixels a level or two apart from frame to frame, in black frames too
 * (warm-up.spec:428's flaky failure, reports/a21-flaky-mac.md); a real leak there (the native copies': up to 30) fails.
 */
async function differenceFromBlack(page: Page, scope: string, exact = false): Promise<number> {
  const selector = `${scope} [data-warm-up]`;
  const clip = await page.locator(selector).first().boundingBox();
  if (!clip) throw new Error('the warm-up has no visible box');
  // The LIVE picture in twelve frames, each against the black (its corners varied from frame to frame on CI's Mac).
  const drawnPngs: Buffer[] = [];
  for (let frame = 0; frame < (scope === '[data-testid="live-preview"]' ? 12 : 1); frame++)
    drawnPngs.push(await page.screenshot({ scale: 'css', clip }));
  const opacity = await page.evaluate((scope) => {
    const tree = document.querySelector(scope)?.querySelector('[data-warm-up]')?.shadowRoot;
    const drawing = tree?.querySelector<HTMLElement>('[data-warm-drawing]');
    if (!drawing) throw new Error('no warm-up drawing for the black reference');
    // Preserve layout/layer geometry: display:none changes Windows' rounded-border sampling.
    const ui = [
      ...(document.querySelector(scope)?.querySelectorAll<HTMLElement>('[data-warm-ui-drawing]') ?? []),
    ];
    const before = { scene: drawing.style.opacity, ui: ui.map((el) => el.style.opacity) };
    drawing.style.opacity = '0';
    for (const el of ui) el.style.opacity = '0';
    if (getComputedStyle(drawing).opacity !== '0' || ui.some((el) => getComputedStyle(el).opacity !== '0'))
      throw new Error('the reference still draws a scene');
    return before;
  }, scope);
  let black: ReturnType<typeof decodePng>;
  let blackPng: Buffer;
  let corners: Set<number> | null = null;
  try {
    blackPng = await page.screenshot({ scale: 'css', clip });
    black = decodePng(blackPng);
    if (scope === '[data-testid="live-preview"]' && !exact) {
      // The box alone: the warm-up's black group and its final cover hidden too.
      const inner = await page.evaluate((scope) => {
        const box = document.querySelector<HTMLElement>(scope);
        const host = box?.querySelector<HTMLElement>('[data-warm-up]');
        const final = host?.parentElement?.querySelector<HTMLElement>('[data-warm-final-cover]');
        if (!box || !host || !final) throw new Error('no LIVE box, warm-up group or final cover');
        host.style.visibility = 'hidden';
        final.style.visibility = 'hidden';
        const css = getComputedStyle(box);
        return parseFloat(css.borderTopLeftRadius) - parseFloat(css.borderTopWidth);
      }, scope);
      const alone = decodePng(await page.screenshot({ scale: 'css', clip }));
      // Its antialiased corner pixels: in a square of the box's inner corner (and 2 px more) at each corner of the
      // warm-up's box, those the box alone draws neither black nor its border's or the page's full colour.
      const side = Math.ceil(inner) + 2;
      corners = new Set<number>();
      for (let y = 0; y < alone.height; y++)
        for (let x = 0; x < alone.width; x++) {
          const inCorner = (x < side || x >= alone.width - side) && (y < side || y >= alone.height - side);
          if (!inCorner) continue;
          const i = (y * alone.width + x) * 4;
          const value = [alone.rgba[i] ?? 0, alone.rgba[i + 1] ?? 0, alone.rgba[i + 2] ?? 0];
          const neighbours = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ].map(([nx, ny]) => alone.rgba[((ny ?? 0) * alone.width + (nx ?? 0)) * 4] ?? 0);
          // An edge pixel: not black, and not the same as every neighbour (the border's or the page's flat colour).
          if (value.some((v) => v !== 0) && neighbours.some((n) => n !== value[0])) corners.add(i / 4);
        }
    }
  } finally {
    if (scope === '[data-testid="live-preview"]')
      await page.evaluate((scope) => {
        const host = document.querySelector(scope)?.querySelector<HTMLElement>('[data-warm-up]');
        if (host) host.style.visibility = '';
        const final = host?.parentElement?.querySelector<HTMLElement>('[data-warm-final-cover]');
        if (final) final.style.visibility = '';
      }, scope);
    await page.evaluate(
      ({ scope, opacity }) => {
        const tree = document.querySelector(scope)?.querySelector('[data-warm-up]')?.shadowRoot;
        const drawing = tree?.querySelector<HTMLElement>('[data-warm-drawing]');
        if (!drawing) throw new Error('no warm-up drawing to restore');
        drawing.style.opacity = opacity.scene;
        const ui = [
          ...(document.querySelector(scope)?.querySelectorAll<HTMLElement>('[data-warm-ui-drawing]') ?? []),
        ];
        if (ui.length !== opacity.ui.length) throw new Error('the same UI warm-up drawing is restored');
        ui.forEach((el, i) => {
          el.style.opacity = opacity.ui[i] ?? '';
        });
      },
      { scope, opacity },
    );
  }
  if (exact) {
    let nonblack = 0;
    for (let i = 0; i < black.rgba.length; i += 4)
      if (
        black.rgba[i] !== 0 ||
        black.rgba[i + 1] !== 0 ||
        black.rgba[i + 2] !== 0 ||
        black.rgba[i + 3] !== 255
      )
        nonblack++;
    expect(nonblack, 'the entire neutral UI reference is opaque black, including every border pixel').toBe(0);
  }
  const center = (Math.floor(black.height / 2) * black.width + Math.floor(black.width / 2)) * 4;
  expect([...black.rgba.slice(center, center + 4)], 'the reference is opaque black').toEqual([0, 0, 0, 255]);
  let difference = 0;
  for (const [frame, drawnPng] of drawnPngs.entries()) {
    const drawn = decodePng(drawnPng);
    expect([drawn.width, drawn.height], 'the same entire warm-up box').toEqual([black.width, black.height]);
    let most = 0;
    let at = 0;
    let channels = 0;
    for (let i = 0; i < drawn.rgba.length; i++) {
      const raw = Math.abs((drawn.rgba[i] ?? 0) - (black.rgba[i] ?? 0));
      const delta = corners?.has(Math.floor(i / 4)) && raw <= 2 ? 0 : raw;
      if (delta !== 0) channels++;
      if (delta > most) {
        most = delta;
        at = i;
      }
    }
    if (most > difference) {
      difference = most;
      const pixel = Math.floor(at / 4);
      const first = pixel * 4;
      await test.info().attach('warm-up-drawn-pane', { body: drawnPng, contentType: 'image/png' });
      await test.info().attach('warm-up-black-reference', { body: blackPng, contentType: 'image/png' });
      await test.info().attach('warm-up-pane-difference', {
        body: JSON.stringify({
          frame,
          difference: most,
          channels,
          x: pixel % drawn.width,
          y: Math.floor(pixel / drawn.width),
          drawn: [...drawn.rgba.slice(first, first + 4)],
          black: [...black.rgba.slice(first, first + 4)],
        }),
        contentType: 'application/json',
      });
    }
  }
  return difference;
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
        deckEffect: layer?.dataset['deckEffect'] ?? '',
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
async function expectWarmUp(
  page: Page,
  scope: string,
  what: string,
  ticker = true,
  exact = false,
): Promise<void> {
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
  // A deck Drashti plays itself (Session 57, render/warm-up-deck.ts): each of its own transitions drawn as itself,
  // part-way (X15's EF-5: named by what it draws, not only by how far through).
  for (const effect of ['wipe', 'cover']) {
    const s = scenes.find((x) => x.key === `deck-${effect}/calm`);
    expect(s?.deckEffect, `${what}: a deck's own ${effect}`).toBe(effect);
    expect(s?.fade, `${what}: a deck's own ${effect} part-way`).toBeGreaterThan(0.3);
    expect(s?.fade, `${what}: a deck's own ${effect} part-way`).toBeLessThan(0.7);
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
  // The wide Cover's own shade must reach the compositor without the old outer brightness(0), which flattened
  // its RGBA pass and left a new pipeline for the first Cover on air (X12 wide). The cover stays above every scene.
  const hiding = await page.evaluate((scope) => {
    const host = document.querySelector(scope)?.querySelector<HTMLElement>('[data-warm-up]');
    const tree = host?.shadowRoot;
    const wide = tree?.querySelector<HTMLElement>('[data-warm-scene="deck-cover-wide/calm/off-grid"]');
    const cover = tree?.querySelector<HTMLElement>('[data-warm-cover]');
    const final = host?.parentElement?.querySelector<HTMLElement>('[data-warm-final-cover]');
    const drawing = tree?.querySelector<HTMLElement>('[data-warm-drawing]');
    const pulse = tree?.querySelector<HTMLElement>('[data-warm-pulse]');
    const filters: string[] = [];
    for (let el = wide?.parentElement; el; el = el.parentElement) filters.push(getComputedStyle(el).filter);
    if (host) filters.push(getComputedStyle(host).filter);
    return {
      wide: wide !== null && wide !== undefined,
      filters,
      isolation: host ? getComputedStyle(host).isolation : null,
      groupOpacity: host ? getComputedStyle(host).opacity : null,
      drawingClip: drawing ? getComputedStyle(drawing).overflow : null,
      drawingZ: drawing ? Number(getComputedStyle(drawing).zIndex) : Number.NaN,
      pulseZ: pulse ? Number(getComputedStyle(pulse).zIndex) : Number.NaN,
      coverZ: cover ? Number(getComputedStyle(cover).zIndex) : Number.NaN,
      opacity: cover ? getComputedStyle(cover).opacity : null,
      background: cover ? getComputedStyle(cover).backgroundColor : null,
      finalOpacity: final ? getComputedStyle(final).opacity : null,
      finalBackground: final ? getComputedStyle(final).backgroundColor : null,
      finalOutside: !!host && !!final && final.parentElement === host.parentElement,
      finalAbove:
        !!host && !!final && Number(getComputedStyle(final).zIndex) > Number(getComputedStyle(host).zIndex),
      coversEdges:
        !!host &&
        !!cover &&
        cover.getBoundingClientRect().left < host.getBoundingClientRect().left &&
        cover.getBoundingClientRect().top < host.getBoundingClientRect().top &&
        cover.getBoundingClientRect().right > host.getBoundingClientRect().right &&
        cover.getBoundingClientRect().bottom > host.getBoundingClientRect().bottom,
      above: !!wide && !!cover && !!(wide.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  }, scope);
  expect(hiding.wide, `${what}: a full-picture wide Cover`).toBe(true);
  expect(
    hiding.filters.every((filter) => filter === 'none'),
    `${what}: no outer filter`,
  ).toBe(true);
  expect(hiding.isolation, `${what}: the warm-up blends only with itself`).toBe('isolate');
  expect(hiding.groupOpacity, `${what}: drawing and cover compose before the page clips them`).toBe('0.999');
  expect(hiding.drawingClip, `${what}: only the placeholder drawing has the canvas clip`).toBe('hidden');
  expect(hiding.pulseZ, `${what}: the repaint marker is above every scene`).toBeGreaterThan(hiding.drawingZ);
  expect(
    hiding.coverZ,
    `${what}: the black cover is above every scene and its repaint marker`,
  ).toBeGreaterThan(hiding.pulseZ);
  expect(hiding.opacity, `${what}: the black cover keeps the GPU drawing underneath`).toBe('0.999');
  expect(hiding.background, `${what}: a black cover`).toBe('rgb(0, 0, 0)');
  expect(hiding.coversEdges, `${what}: the cover extends beyond every clipped edge`).toBe(true);
  expect(hiding.above, `${what}: the cover follows the drawing`).toBe(true);
  expect(hiding.finalOutside, `${what}: the final cover composes outside the drawing’s opacity group`).toBe(
    true,
  );
  expect(hiding.finalAbove, `${what}: the final cover is above that group`).toBe(true);
  expect(hiding.finalOpacity, `${what}: the final cover also keeps the GPU drawing underneath`).toBe('0.999');
  expect(hiding.finalBackground, `${what}: the final cover is black`).toBe('rgb(0, 0, 0)');
  // The audience sees none of it. Keep the geometry and the exact frame if the cover ever fails.
  const light = await differenceFromBlack(page, scope, exact);
  if (light !== 0) {
    const geometry = await page.evaluate((scope) => {
      const host = document.querySelector(scope)?.querySelector<HTMLElement>('[data-warm-up]');
      const tree = host?.shadowRoot;
      const box = (el: HTMLElement | null | undefined) => {
        if (!el) return null;
        const css = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          width: css.width,
          height: css.height,
          display: css.display,
          position: css.position,
          transform: css.transform,
          opacity: css.opacity,
          filter: css.filter,
          isolation: css.isolation,
          zIndex: css.zIndex,
          mixBlendMode: css.mixBlendMode,
          background: css.backgroundColor,
        };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
        host: box(host),
        parent: box(host?.parentElement),
        drawing: box(tree?.querySelector<HTMLElement>('[data-warm-drawing]')),
        pulse: box(tree?.querySelector<HTMLElement>('[data-warm-pulse]')),
        cover: box(tree?.querySelector<HTMLElement>('[data-warm-cover]')),
        scenes: [...(tree?.querySelectorAll<HTMLElement>('[data-warm-scene]') ?? [])]
          .slice(0, 4)
          .map((el) => ({ key: el.dataset['warmScene'], ...box(el) })),
      };
    }, scope);
    await test.info().attach('warm-up-cover-geometry', {
      body: JSON.stringify({ what, light, geometry }, null, 2),
      contentType: 'application/json',
    });
    await test.info().attach('warm-up-covered-frame', {
      body: await page.screenshot({ scale: 'css' }),
      contentType: 'image/png',
    });
  }
  expect(light, `${what}: every pixel matches black alone`).toBe(0);
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
  await expect(program.locator('[data-testid="program-root"] [data-warm-up="during"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  // Keep looking before the black-reference helper changes the drawing’s opacity: a rastered tile containing the
  // repaint marker can differ from the other, solid-colour tiles. Every sampled pixel must still be black.
  for (let frame = 0; frame < 24; frame++)
    expect(await brightest(program), `the stream’s page: black in frame ${String(frame)}`).toBe(0);
  await expectWarmUp(program, '[data-testid="program-root"]', 'the stream’s page', false);
  expect(Object.keys(await studioFonts(program)), 'the stream’s page’s start: the studio’s fonts').toEqual([
    'unloaded',
  ]);
  await app.close();
});

test('where Chromium draws with a graphics chip the LIVE picture’s warm-up is unseen to its rounded corners, its native Cover copies drawn', async () => {
  test.setTimeout(180_000);
  // The native copies of a deck's wide and 4:3 Cover (X12 wide) are drawn only where Chromium draws with a chip (a21:
  // on CI's Mac they showed at the LIVE box's four rounded corners, 42 pixels up to 30 levels, while the test above,
  // without a chip, never drew them).
  const { app } = await launchApp({ ...HOLD, ...WITH_A_CHIP, DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await expect(win.locator('[data-testid="live-preview"] [data-warm-ui-cover]')).toHaveCount(2, {
    timeout: 30_000,
  });
  // Keep every rounded clip, border width, transform and warm-up surface intact. Only the UI's colours change:
  // black against black has no antialiased border contribution that can vary between captures. The native copies'
  // blue leak still has its original geometry and must fail an EXACT comparison (no corner allowance).
  await win.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-testid="live-preview"]');
    if (!box) throw new Error('no LIVE picture');
    box.style.borderColor = '#000';
    for (let at: HTMLElement | null = box; at; at = at.parentElement) at.style.backgroundColor = '#000';
  });
  // Red: reproduce the original square native-copy container, without changing any other warm-up drawing.
  await win.addStyleTag({
    content: '[data-testid="live-preview"] [data-warm-ui-drawing] { border-radius: 0 !important; }',
  });
  await expectWarmUp(win, '[data-testid="live-preview"]', 'the LIVE picture with a chip', true, true);
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
  await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  await expect(out.locator('[data-warm-up]')).toHaveCount(1);
  await expect(out.locator('[data-warm-scene]')).toHaveCount(0);
  // Then the show draws as ever.
  await goLive(win, id, 0);
  await expect.poll(() => brightest(out), { timeout: 15_000 }).toBeGreaterThan(40);
  // And once it has drawn, every face of the Lower Thirds studio's fonts comes (Session 55), as in the LIVE picture.
  await expect.poll(async () => Object.keys(await studioFonts(out)), { timeout: 15_000 }).toEqual(['loaded']);
  await expect.poll(async () => Object.keys(await studioFonts(win)), { timeout: 15_000 }).toEqual(['loaded']);
  // The log says which Main chose for the output (Session 57), and how its warm-up ended, how long it took (Session 58).
  await expectSaid(
    userData,
    /^Warm-up: as before, a graphics chip \(gpu_compositing enabled\), for output ".+"$/u,
  );
  // Drawn to its end, or (a slow computer) at its longest.
  await expectEnded(
    userData,
    /^Warm-up of output ".+": (?:drew everything in|stopped at its longest,) \d+\.\d s$/u,
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
  await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
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

test('where Chromium draws without a graphics chip the LIVE picture draws the show without a warm-up, as the outputs do, and the log says so once (WU-1)', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp(WITHOUT_A_CHIP);
  const win = await operatorPage(app);
  await operatorReady(win);
  // Never warmed up to its end: not begun, or cut short as soon as Chromium said how it draws (a moment after the start).
  try {
    await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
      timeout: 30_000,
    });
  } catch (error) {
    // Keep the phase before another IPC read: a late GPU choice, a stuck hand-over and a pixel failure differ.
    const phases = await win
      .locator('[data-testid="live-preview"] [data-warm-up]')
      .evaluateAll((hosts) => hosts.map((host) => ({ phase: host.getAttribute('data-warm-up') })));
    const noGpu = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.noGpu());
    await test.info().attach('live-warm-up-still-mounted', {
      body: JSON.stringify({ phases, noGpu, marks: await warmUpMarks(win), lines: warmUpLines(userData) }),
      contentType: 'application/json',
    });
    throw error;
  }
  await expect
    .poll(() => warmUpLines(userData).filter((line) => line.endsWith('for the LIVE picture')))
    .toEqual([LIVE_SKIPPED]);
  expect(await warmUpMarks(win), 'the LIVE picture’s warm-up marks').not.toContain(
    'drashti-warm-up:live-end',
  );
  await app.close();
});

test('a LIVE warm-up cut between its before frames cannot be restarted by a frame the browser had already queued', async () => {
  const { app, userData } = await launchApp({ ...SAID_LATE, ...WITHOUT_A_CHIP });
  try {
    await app.context().addInitScript(() => {
      let queued: FrameRequestCallback | null = null;
      let delivered = false;
      document.addEventListener('drashti-test-warm-up-before-frame', (event) => {
        const request = event as CustomEvent<{ tick: FrameRequestCallback; drew: boolean }>;
        const host = event.target;
        if (
          queued ||
          !request.detail.drew ||
          !(host instanceof HTMLElement) ||
          !host.closest('[data-testid="live-preview"]')
        )
          return;
        queued = request.detail.tick;
        event.preventDefault();
        document.documentElement.dataset['testBeforeQueued'] = 'yes';
      });
      new MutationObserver(() => {
        if (!queued || delivered) return;
        const host = document.querySelector('[data-testid="live-preview"] [data-warm-up]');
        if (host?.getAttribute('data-warm-up') !== 'settle') return;
        // Deliver in the gap between the cut's commit and passive cleanup, as an already-dequeued frame can be.
        delivered = true;
        queued(performance.now());
        document.documentElement.dataset['testBeforeDelivered'] = 'yes';
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-warm-up'] });
    });
    const win = await operatorPage(app);
    // The listener must be installed before this document's warm-up begins; no condition is retried by this reload.
    await win.reload();
    await operatorReady(win);
    await expect(win.locator('html')).toHaveAttribute('data-test-before-queued', 'yes', { timeout: 30_000 });
    await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveAttribute(
      'data-warm-up',
      'before',
    );
    await app.evaluate(() => {
      const say = (globalThis as MainGlobals).drashtiTestGpuSaid;
      if (!say) throw new Error('Main has no late-GPU test hook');
      say();
    });
    await expect(win.locator('html')).toHaveAttribute('data-test-before-delivered', 'yes');
    await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(win.locator('[data-testid="live-preview"] [data-testid="scene"]')).toHaveCount(1);
    await expect
      .poll(() => warmUpLines(userData).filter((line) => line.endsWith('for the LIVE picture')))
      .toEqual([LIVE_SKIPPED]);
    const marks = await warmUpMarks(win);
    expect(marks).toContain('drashti-warm-up:live-cut');
    expect(marks).not.toContain('drashti-warm-up:live-end');
  } finally {
    await app.close();
  }
});

test('where Chromium draws without a graphics chip the stream’s page draws the show without a warm-up, as the outputs do, and the log says so once (WU-1)', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({ ...WITHOUT_A_CHIP, DRASHTI_TEST_FAKE_DEVICES: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  // Chromium has said how it draws (the LIVE picture's warm-up is over: it draws without a chip too, but warms up).
  await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await win.getByTestId('open-stream').click();
  const program = await streamPage(app);
  const root = program.getByTestId('program-root');
  await expect(root).toHaveAttribute('data-warm-up', 'skipped', { timeout: 30_000 });
  await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  // It never warmed up: no warm-up drawn, no mark of one.
  expect(await warmUpMarks(program), 'the stream’s page’s warm-up marks').toEqual([]);
  await expect
    .poll(() => warmUpLines(userData).filter((line) => line.endsWith('for the stream’s page')))
    .toEqual([
      'Warm-up: skipped, no graphics chip (gpu_compositing disabled_software), for the stream’s page',
    ]);
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
  // The LIVE picture's held warm-up ends there too (Session 58, WU-1).
  await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0);
  await expect.poll(() => warmUpMarks(win)).toContain('drashti-warm-up:live-cut');
  await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
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
  // How it ended, said once (Session 58, WU-2).
  await expectEnded(
    userData,
    /^Warm-up of output ".+": cut short after \d+\.\d s, told it draws without a graphics chip$/u,
  );
  await app.close();
});

/**
 * Every time a timer for the audience shows in `scope` (its `data-time`), from the first the page puts there: kept in
 * the page as it goes, before any frame of it is drawn.
 */
const watchTimesShown = (page: Page, scope: string) =>
  page.evaluate((scope) => {
    const shown: string[] = [];
    (globalThis as { drashtiTimesShown?: string[] }).drashtiTimesShown = shown;
    new MutationObserver(() => {
      const time = document
        .querySelector(`${scope} [data-testid="audience-timer-time"]`)
        ?.getAttribute('data-time');
      if (time && shown.at(-1) !== time) shown.push(time);
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  }, scope);

const timesShown = (page: Page) =>
  page.evaluate(() => (globalThis as { drashtiTimesShown?: string[] }).drashtiTimesShown ?? []);

/** Seconds left, as a timer shows them ("0:57", or "57"). */
const secondsShown = (text: string) =>
  text
    .split(':')
    .map(Number)
    .reduce((sum, part) => sum * 60 + part, 0);

/** A minute's countdown put up for the audience and started now: when, by the operator window's clock. */
const countdownUp = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.timers.create({
      name: 'Placeholder countdown',
      kind: 'countdown',
      durationMs: 60_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
    await d.engine.dispatch({ type: 'startTimer', timerId: made.id });
    await d.engine.dispatch({ type: 'showAudienceTimer', timerId: made.id });
    return Date.now();
  });

test('an output’s warm-up cut short never lends the show its paused clock: a timer for the audience shows its time left from its first frame (NG-1)', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...WITHOUT_A_CHIP, ...SAID_LATE, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const out = await outputPage(app);
  const root = out.getByTestId('output-root');
  // Warming up part-way, its clock paused there (held until Chromium says how it draws).
  await expect(out.locator('[data-testid="output-root"] [data-warm-up="during"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await watchTimesShown(out, '[data-testid="output-root"]');
  // A minute's countdown for the audience, started after the warm-up paused its clock, and 3 s gone by the clock.
  const startedAt = await countdownUp(win);
  await expect
    .poll(() => win.evaluate(() => Date.now()), { intervals: [250] })
    .toBeGreaterThan(startedAt + 3000);
  // Chromium says it draws without a graphics chip: the warm-up is cut there, the show drawn.
  await app.evaluate(() => {
    (globalThis as MainGlobals).drashtiTestGpuSaid?.();
  });
  await expect(root).toHaveAttribute('data-warm-up', 'skipped');
  await expect(out.getByTestId('audience-timer-time')).toHaveCount(1, { timeout: 20_000 });
  const shown = await timesShown(out);
  expect(shown.length, 'the timer shown at all').toBeGreaterThan(0);
  // The first time it showed is the clock's (3 s or more gone), never the paused moment's (the whole minute).
  expect(
    secondsShown(shown[0] ?? ''),
    `the first time it showed (all: ${shown.join(', ')})`,
  ).toBeLessThanOrEqual(57);
  await app.close();
});

test('the LIVE picture’s warm-up cut short as the first slide goes up never lends the show its paused clock: a timer for the audience shows its time left from its first frame (NG-1)', async () => {
  test.setTimeout(180_000);
  // The LIVE picture's warm-up kept drawn, its clock paused part-way, until something goes up and cuts it short.
  const { app } = await launchApp(HOLD);
  const win = await operatorPage(app);
  await operatorReady(win);
  const live = '[data-testid="live-preview"]';
  await expect(win.locator(`${live} [data-warm-up="during"]`)).toHaveCount(1, { timeout: 30_000 });
  const picture = win.locator(`${live} [data-box]`).first();
  const original = await picture.evaluateHandle((box) => box);
  const id = await makeSlides(
    win,
    'Placeholder slides cut in',
    [{ words: 'Placeholder words', background: '#3a6ea5' }],
    { kind: 'cut', durationMs: 0 },
  );
  await watchTimesShown(win, live);
  // A minute's countdown for the audience (it never cuts the warm-up short by itself), 3 s gone by the clock.
  const startedAt = await countdownUp(win);
  await expect
    .poll(() => win.evaluate(() => Date.now()), { intervals: [250] })
    .toBeGreaterThan(startedAt + 3000);
  expect(await timesShown(win), 'nothing of the show drawn in LIVE while it warms up').toEqual([]);
  // The first slide goes up: the warm-up ends there, cut, and LIVE draws the show with the timer over it.
  await goLive(win, id, 0);
  await expect(win.locator(`${live} [data-warm-up]`)).toHaveCount(0);
  await expect(win.locator(`${live} [data-testid="audience-timer-time"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  expect(await picture.evaluate((box, before) => box === before, original)).toBe(true);
  await original.dispose();
  const shown = await timesShown(win);
  expect(shown.length, 'the timer shown at all').toBeGreaterThan(0);
  // The first time it showed is the clock's (3 s or more gone), never the paused moment's (the whole minute).
  expect(
    secondsShown(shown[0] ?? ''),
    `the first time it showed (all: ${shown.join(', ')})`,
  ).toBeLessThanOrEqual(57);
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
