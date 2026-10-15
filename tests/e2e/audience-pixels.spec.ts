import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type OutputGlobals,
  type PageGlobals,
  setUpScreen,
} from './helpers';

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
    await page.waitForTimeout(250);
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

    // The display numbers shown while setting up (5 s), on two pretend displays.
    const { shown } = await win.evaluate(() => (globalThis as PageGlobals).drashti.setup.identifyDisplays());
    expect(shown).toBeGreaterThan(0);
    // Every one of them open before any is taken (they come up one by one).
    await expect.poll(() => app.windows().filter((p) => p.url().includes('identify=')).length).toBe(shown);
    const identify = app
      .windows()
      .filter((p) => p.url().includes('identify='))
      .sort((a, b) => a.url().localeCompare(b.url()));
    for (const [i, page] of identify.entries()) keep(`identify-${String(i + 1)}`, await settled(page));
    await expect.poll(() => app.windows().filter((p) => p.url().includes('identify=')).length).toBe(0);

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
    const program =
      app.windows().find(isStream) ?? (await app.waitForEvent('window', { predicate: isStream }));
    await expect(program.getByTestId('program-root')).toBeVisible();

    // The stage display on a tablet (Safari's engine).
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'stage', 'Placeholder stage tablet');
    const tablet = await device('webkit', TABLET);
    try {
      await pairByQr(tablet.page, base, code, '/stage');
      await expect(tablet.page.getByTestId('stage-view')).toBeVisible();
      const clocks = (p: Page) => [p.getByTestId('stage-clock'), p.getByTestId('stage-timer')];
      const shoot = async (frame: string) => {
        await painted(win, [hall, stage]);
        keep(`hall-${frame}`, await settled(hall));
        keep(`stage-${frame}`, await settled(stage, clocks(stage)));
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

    // Against the earlier build's pictures, when given: the same size, and every pixel within 2.
    if (BASE) {
      const differ: string[] = [];
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
        if (changed > 0) differ.push(`${name}: ${String(changed)} pixels changed (by up to ${String(most)})`);
      }
      console.log(
        `Audience pictures compared with the earlier build: ${String(frames.length)}, differing ${String(differ.length)}`,
      );
      expect(differ).toEqual([]);
    } else {
      console.log(`Audience pictures kept: ${String(frames.length)} in ${out}`);
    }
  } finally {
    await app.close();
  }
});
