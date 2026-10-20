import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  type OutputGlobals,
  outputPages,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';

/*
 * What the audience sees, picture for picture against another build (Session 26g). The operator's
 * window changes its look; the screens must not: the hall's output, a stage screen, the stream's
 * picture, the stage display in a browser and the display numbers shown while setting up, frame
 * by frame through the seeded placeholder slides, a generated picture, a stage message and
 * black-out. Everything is done through the bridge, never the operator window's buttons, so the
 * same spec drives an earlier build (DRASHTI_E2E_APP_DIR) unchanged.
 *
 *   DRASHTI_PIXELS_OUT   where this run's pictures go (one PNG per screen and frame);
 *   DRASHTI_PIXELS_BASE  an earlier run's folder: every picture must match it.
 *
 * `node scripts/audience-pixels.mjs <ref>` builds the ref in a worktree and runs both. The clocks
 * and timers on the stage are masked (they tell the time); nothing else is. Skipped unless
 * DRASHTI_PIXELS_OUT is set.
 */

const OUT = process.env['DRASHTI_PIXELS_OUT'];
const BASE = process.env['DRASHTI_PIXELS_BASE'];

/**
 * What the hall's screens show differently from the build compared with, each on a frame of its own: these
 * frames may differ from the earlier build's, and each must on one screen at least, so the change is seen,
 * unless it says why its pixels may match. Every other frame must be the same.
 *
 * None since alpha.6 (Sessions 39–40, against Session 38's d032357, whose hall is alpha.6's): every frame
 * must be the same, the frames of alpha.6's four hall changes too. None against alpha.7 (9ed5d00) either
 * (Session 43, alpha.8): Session 42's appearances change only Drashti's own windows, never the hall's. Those four, which Sessions 31–36 decided
 * and the alpha.6 round measured against alpha.5 (9df47ac), were listed here until then (f9a2ab9). A session
 * that changes what the hall sees names its changes here, against its own base.
 */
const CHANGED: Readonly<Record<string, { what: string; mayMatch?: string }>> = {};

/** The moment the stage clock's frame is held at (any fixed moment: it is the same in both builds). */
const HELD_AT = Date.UTC(2026, 9, 18, 6, 30);

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** A picture with a gradient, colours and a hard edge: anything a filter or a scale would change shows. */
async function testPicture(page: Page, file: string): Promise<string> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const g = ctx.createLinearGradient(0, 0, 1280, 720);
    g.addColorStop(0, 'rgb(30,60,140)');
    g.addColorStop(1, 'rgb(220,150,40)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = 'rgb(250,250,250)';
    ctx.fillRect(560, 240, 160, 240);
    ctx.fillStyle = 'rgb(10,10,10)';
    for (let x = 0; x < 1280; x += 64) ctx.fillRect(x, 640, 32, 40);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/**
 * A screenshot once the page has settled: two in a row, 250 ms apart, the same (a dissolve or a
 * picture still loading never makes a frame).
 */
async function settled(page: Page, mask: Locator[] = []): Promise<Buffer> {
  let last: Buffer | null = null;
  for (let i = 0; i < 40; i++) {
    const shot = await page.screenshot({ mask, maskColor: '#ff00ff', animations: 'allow' });
    if (last?.equals(shot)) return shot;
    last = shot;
    await letTimePass(page, 250, 'the screen looked at again, to see it has settled');
  }
  throw new Error(`${page.url()} never settled`);
}

/** The engine's revision now; then wait until an output window has painted it. */
async function painted(win: Page, outputs: Page[]): Promise<void> {
  const rev = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev,
  );
  for (const out of outputs)
    await expect
      .poll(() =>
        out.evaluate(
          (r) => ((globalThis as OutputGlobals).drashtiPaintLog ?? []).some((p) => p.rev >= r),
          rev,
        ),
      )
      .toBe(true);
}

/** Decode a PNG to RGBA in Electron's main process (no PNG package in the tests). */
function decode(app: ElectronApplication, png: Buffer) {
  return app.evaluate(({ nativeImage }, b64) => {
    const image = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
    const { width, height } = image.getSize();
    return { width, height, pixels: image.toBitmap().toString('base64') };
  }, png.toString('base64'));
}

test('the audience screens show exactly what the earlier build showed, frame by frame', async () => {
  test.skip(!OUT, 'Set DRASHTI_PIXELS_OUT (scripts/audience-pixels.mjs runs this against an earlier build)');
  test.setTimeout(600_000);
  const out = OUT ?? '';
  mkdirSync(out, { recursive: true });
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
    DRASHTI_TEST_FAKE_DEVICES: '1',
    // Main in another time zone and locale than the computer's (an earlier build has no such switch), and the
    // screens' clock held for the stage clock's frame.
    DRASHTI_TEST_CLOCK_STYLE: 'en-GB Pacific/Chatham',
    DRASHTI_TEST_CLOCK_HOLD: '1',
    ...NETWORK_ENV,
  });
  const frames: { name: string; png: Buffer }[] = [];
  const keep = (name: string, png: Buffer) => {
    frames.push({ name, png });
    writeFileSync(join(out, `${name}.png`), png);
  };
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-audience-pixels-'));
    const [pictureId = ''] = await importAndGetIds(win, [
      await testPicture(win, join(dir, 'Placeholder picture.png')),
    ]);

    // The display numbers shown while setting up, on two pretend displays. Each window goes 5 s after it is
    // made, the product's own time. Loading and settling three side by side took CI's Mac longer than that
    // (runs 39065876630, twice, and 39072928723), so the numbers are shown again, as a person would press
    // Identify again, until all three settle before they go: at most three times, and each time they must
    // have stayed their 5 s.
    const identifying = () => app.windows().filter((p) => p.url().includes('identify='));
    let identified: Buffer[] = [];
    for (let time = 1; identified.length === 0; time++) {
      const madeBy = Date.now();
      const { shown } = await win.evaluate(() =>
        (globalThis as PageGlobals).drashti.setup.identifyDisplays(),
      );
      expect(shown).toBeGreaterThan(0);
      // Every one of them open before any is taken (they come up one by one).
      await expect.poll(() => identifying().length).toBe(shown);
      const identify = identifying().sort((a, b) => a.url().localeCompare(b.url()));
      try {
        identified = await Promise.all(identify.map((page) => settled(page)));
      } catch (error) {
        // Only a window that went before it settled is shown again.
        if (time >= 3 || !(error instanceof Error && error.message.includes('has been closed'))) throw error;
      }
      await expect.poll(() => identifying().length).toBe(0);
      expect(Date.now() - madeBy, 'the display numbers stayed their 5 s').toBeGreaterThanOrEqual(5000);
    }
    for (const [i, shot] of identified.entries()) keep(`identify-${String(i + 1)}`, shot);

    // The hall and a stage screen, then the stream's picture (no camera chosen: the slides as the hall has them).
    await setUpScreen(win, 'Main Hall', 0);
    await setUpScreen(win, 'Stage', 1);
    await expect.poll(() => outputPages(app).length).toBe(2);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
      if (!group) throw new Error('no stage group');
      const set = await d.screens.setGroupRole(group.id, 'stage');
      if (!set.ok) throw new Error(set.message);
    });
    const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
    await expect
      .poll(async () => (await Promise.all(outputPages(app).map(roleOf))).sort())
      .toEqual(['audience', 'stage']);
    const [first, second] = outputPages(app);
    if (!first || !second) throw new Error('two screens expected');
    const [hall, stage] = (await roleOf(first)) === 'audience' ? [first, second] : [second, first];
    await win.getByTestId('open-stream').click();
    const isStream = (p: Page) => p.url().includes('stream.html');
    const program = await windowShowing(app, isStream, 'stream');
    await expect(program.getByTestId('program-root')).toBeVisible();
    // Ready to draw the show: until its fonts load and its GPU warms up the stream's picture is black, as both
    // builds make it (Session 27). CI's Windows, drawing without a GPU, was still warming up when its first
    // slide was taken (run 39074386719: "stream-p1-s1: 36465 pixels changed", a black frame against the
    // slide, which lights 34,646 pixels on a Mac).
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 60_000,
    });

    // The stage display on a tablet (Safari's engine).
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'stage', 'Placeholder stage tablet');
    const tablet = await device('webkit', TABLET);
    try {
      await pairByQr(tablet.page, base, code, '/stage');
      await expect(tablet.page.getByTestId('stage-view')).toBeVisible();
      const clocks = (p: Page) => [p.getByTestId('stage-clock'), p.getByTestId('stage-timer')];
      const shoot = async (frame: string, stageClock = false) => {
        await painted(win, [hall, stage]);
        keep(`hall-${frame}`, await settled(hall));
        keep(
          `stage-${frame}`,
          await settled(stage, stageClock ? [stage.getByTestId('stage-timer')] : clocks(stage)),
        );
        keep(`stream-${frame}`, await settled(program));
        keep(`tablet-${frame}`, await settled(tablet.page, clocks(tablet.page)));
      };

      // Every slide of the seeded placeholder presentations, in name order.
      const presentations = await win.evaluate(async () =>
        (await (globalThis as PageGlobals).drashti.library.listPresentations())
          .map((p) => ({ id: p.id, name: p.name, slides: p.slideCount }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      expect(presentations.length).toBeGreaterThan(0);
      for (const [p, presentation] of presentations.entries())
        for (let s = 0; s < presentation.slides; s++) {
          await dispatch(win, { type: 'goLive', presentationId: presentation.id, slideIndex: s });
          await shoot(`p${String(p + 1)}-s${String(s + 1)}`);
        }
      await dispatch(win, { type: 'setStageMessage', text: 'Placeholder: two minutes left' });
      await shoot('stage-message');
      await dispatch(win, { type: 'clearStageMessage' });
      // A message in Gujarati and English (Sessions 31–36, I18N-4: a message now says its language).
      await dispatch(win, {
        type: 'showMessage',
        message: { id: 'placeholder-message', text: 'નમૂના સંદેશ · Placeholder message' },
      });
      await shoot('message');
      await dispatch(win, { type: 'hideMessage', messageId: 'placeholder-message' });
      // Words made smaller to fit their box, and words that run past theirs (Sessions 31–36, SLD-1: each box
      // is now measured and marked, and the screens must look exactly as before).
      const words = Array.from({ length: 40 }, (_, i) => `Placeholder word ${String(i + 1)}`).join(' ');
      const look = {
        fontFamily: null,
        fontWeight: 700,
        color: '#ffffff',
        align: 'center' as const,
        verticalAlign: 'middle' as const,
        lineHeight: 1.2,
        shadow: false,
      };
      await dispatch(win, {
        type: 'showProp',
        prop: {
          id: 'placeholder-fit',
          name: 'Placeholder fit',
          width: 1920,
          height: 1080,
          elements: [
            {
              id: 'fitted',
              kind: 'text',
              frame: { x: 160, y: 120, width: 1600, height: 380 },
              text: words,
              lang: 'en',
              style: { ...look, fontSize: 90, shrinkToFit: true },
            },
            {
              id: 'overflowing',
              kind: 'text',
              frame: { x: 160, y: 700, width: 800, height: 120 },
              text: words,
              lang: 'en',
              style: { ...look, fontSize: 40, verticalAlign: 'top' },
            },
          ],
        },
      });
      await shoot('shrink-to-fit');
      await dispatch(win, { type: 'hideProp', propId: 'placeholder-fit' });

      // The slides for alpha.6's four hall changes (Sessions 31–36), as a file brings them: placeholder
      // words only.
      const white: [number, number, number] = [255, 255, 255];
      const slanted = cocoaRtf([
        ['નમૂનાની પંક્તિ', 72, white],
        ['Namūnānī paṅkti', 48, white],
      ]).replace(/\\f0\\fs/gu, '\\f0\\i\\expnd60\\expndtw300\\fs');
      const longLines = Array.from({ length: 24 }, (_, i): [string, number, [number, number, number]] => [
        `નમૂના પંક્તિ ${String(i + 1)} નમૂના શબ્દો`,
        80,
        white,
      ]);
      const changesFile = join(dir, 'Placeholder changes.pro6');
      writeFileSync(
        changesFile,
        pp6Presentation({
          uuid: 'PIXELS-CHANGES',
          groups: [
            {
              name: 'Verse',
              uuid: 'PIXELS-CHANGES-G',
              slides: [
                { text: [{ rtf: slanted }] },
                { text: [{ rtf: cocoaRtf(longLines) }] },
                { text: [{ rtf: cocoaRtf([['નમૂનાની પંક્તિ नमूना', 80, white]]) }] },
              ],
            },
          ],
        }),
      );
      const [changes = ''] = await importAndGetIds(win, [changesFile]);
      // alpha.6's four hall changes, each on its own frame, from a file as a mandir's come (its own spacing
      // kept by both builds, so only a change shows). Gujarati set italic and letter-spaced, with its
      // transliteration (I18N-2).
      await dispatch(win, { type: 'goLive', presentationId: changes, slideIndex: 0 });
      await shoot('upright-indic');
      // Hindi inside a Gujarati line, and in a message (I18N-7).
      await dispatch(win, { type: 'goLive', presentationId: changes, slideIndex: 2 });
      await dispatch(win, {
        type: 'showMessage',
        message: { id: 'placeholder-hindi', text: 'नमूना संदेश · Placeholder message' },
      });
      await shoot('hindi-devanagari');
      await dispatch(win, { type: 'hideMessage', messageId: 'placeholder-hindi' });
      // A slide too long for the Standard stage: 24 lines (SLD-7).
      await dispatch(win, { type: 'goLive', presentationId: changes, slideIndex: 1 });
      await shoot('stage-long-slide');
      // The stage clock, held at one moment and not masked on the stage screen (the tablet keeps its own),
      // over nothing else.
      await dispatch(win, { type: 'clearLayer', layer: 'slide' });
      await app.evaluate((_electron, at) => {
        (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock?.(at);
      }, HELD_AT);
      await shoot('stage-clock', true);
      await app.evaluate(() => {
        (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock?.(null);
      });
      // The picture, as a playlist item.
      await win.evaluate(async (mediaId) => {
        const d = (globalThis as PageGlobals).drashti;
        const made = await d.playlists.create('Placeholder pixels', null, false);
        if (!made.ok) throw new Error(made.message);
        const id = made.ids[0] ?? '';
        const added = await d.playlists.addItems(id, null, [{ kind: 'media', mediaId }]);
        if (!added.ok) throw new Error(added.message);
        const [item] = await d.playlists.items(id);
        await d.engine.dispatch({ type: 'playItem', playlistId: id, itemId: item?.id ?? '' });
      }, pictureId);
      await shoot('picture');
      await dispatch(win, { type: 'setBlackout', on: true });
      await shoot('blackout');
    } finally {
      await tablet.close();
    }

    // Against the earlier build's pictures, when given: the same size, and every pixel within 2; the intended
    // changes' frames (CHANGED) are said, and each must differ on one screen at least.
    if (BASE) {
      const differ: string[] = [];
      const intended: string[] = [];
      const shown = new Set<string>();
      const changeOf = (name: string) => Object.keys(CHANGED).find((key) => name.endsWith(`-${key}`));
      for (const { name, png } of frames) {
        let before: Buffer;
        try {
          before = readFileSync(join(BASE, `${name}.png`));
        } catch {
          differ.push(`${name}: not in the earlier build's pictures`);
          continue;
        }
        if (before.equals(png)) continue;
        const [a, b] = [await decode(app, before), await decode(app, png)];
        if (a.width !== b.width || a.height !== b.height) {
          differ.push(
            `${name}: ${String(a.width)}x${String(a.height)} before, ${String(b.width)}x${String(b.height)} now`,
          );
          continue;
        }
        const [pa, pb] = [Buffer.from(a.pixels, 'base64'), Buffer.from(b.pixels, 'base64')];
        let changed = 0;
        let most = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(
            Math.abs((pa[i] ?? 0) - (pb[i] ?? 0)),
            Math.abs((pa[i + 1] ?? 0) - (pb[i + 1] ?? 0)),
            Math.abs((pa[i + 2] ?? 0) - (pb[i + 2] ?? 0)),
          );
          most = Math.max(most, d);
          if (d > 2) changed++;
        }
        if (changed === 0) continue;
        const line = `${name}: ${String(changed)} pixels changed (by up to ${String(most)})`;
        const change = changeOf(name);
        if (change) {
          intended.push(`${line}: ${CHANGED[change]?.what ?? ''}`);
          shown.add(change);
        } else differ.push(line);
      }
      const matched = Object.entries(CHANGED)
        .filter(([key, change]) => !shown.has(key) && change.mayMatch)
        .map(([key, change]) => `${key}: no pixel changed on any screen (${change.mayMatch ?? ''})`);
      const notShown = Object.keys(CHANGED).filter((key) => !shown.has(key) && !CHANGED[key]?.mayMatch);
      console.log(
        `Audience pictures compared with the earlier build: ${String(frames.length)}, differing ${String(differ.length + intended.length)}, of which the intended changes ${String(intended.length)}:\n${[...intended, ...matched].join('\n')}`,
      );
      expect(differ).toEqual([]);
      expect(notShown, 'each intended change shows on one screen at least').toEqual([]);
    } else {
      console.log(`Audience pictures kept: ${String(frames.length)} in ${out}`);
    }
  } finally {
    await app.close();
  }
});
