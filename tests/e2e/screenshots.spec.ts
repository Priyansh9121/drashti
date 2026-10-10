import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import {
  chooseMenuItem,
  dropFiles,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  QUIET,
  setUpScreen,
} from './helpers';
import { KIRTAN, NOTE_ONE, placeholderTalk, PLAYLIST, setUpPlaceholderShow, TALK } from './placeholder-show';
import { freePort, rtmpListener, TEST_KEY, testFfmpeg } from './stream-helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';
import { launchMain, launchNode, nodeCode, nodeView, pairNode, typePairing } from './nodes';
import { releaseServer } from './release-server';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';

/*
 * The screenshots in docs/screenshots/, with placeholder content only. Taken
 * on request, not in every CI run (the pictures depend on the computer's
 * fonts and displays): a manual CI run on a macOS runner keeps them as an
 * artifact,
 *
 *   gh workflow run CI --ref <branch> -f os=macos -f screenshots=true
 *
 * or, when whoever is at the computer agrees (they need real windows),
 *
 *   DRASHTI_E2E_LOUD=1 DRASHTI_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/screenshots.spec.ts
 *
 * (after pnpm build). They are kept at CSS pixel size.
 */

test.skip(!process.env['DRASHTI_SCREENSHOTS'], 'set DRASHTI_SCREENSHOTS=1 to take the screenshots');
test.skip(QUIET, 'Screenshots need real windows: take them on CI (or with DRASHTI_E2E_LOUD=1)');

const folder = join(__dirname, '..', '..', 'docs', 'screenshots');

/**
 * A picture of the page; `hide` covers parts that must not be kept (a pairing
 * code and its QR code); `whole` takes all of a page that scrolls.
 */
async function shot(page: Page, name: string, hide: Locator[] = [], whole = false) {
  mkdirSync(folder, { recursive: true });
  // Let thumbnails and still frames settle.
  await page.waitForTimeout(700);
  await page.screenshot({
    path: join(folder, `${name}.png`),
    scale: 'css',
    mask: hide,
    maskColor: '#2a2f3a',
    fullPage: whole,
  });
}

/** The placeholder sabha running: the kirtan's verse live, a message on the screens and a timer going. */
async function running(win: Page) {
  const show = await setUpPlaceholderShow(win);
  await win.evaluate(async (logoId) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.props.setLogo(logoId);
  }, show.logoPropId);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await win.getByTestId('slide-thumb').nth(1).click();
  await win.getByTestId('timers').getByRole('button', { name: 'Start' }).click();
  await win.getByTestId('messages').getByRole('textbox', { name: 'plate' }).fill('12');
  await win.getByTestId('messages').getByRole('button', { name: 'Show' }).click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  return show;
}

test('the operator window and its panels', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1920, height: 1080 });
  await running(win);
  // The live column from its top (starting the timer and showing the message scrolled it): the previews.
  const live = win.getByRole('complementary', { name: 'Live' });
  const toTop = () =>
    live.evaluate((el) => {
      el.scrollTop = 0;
    });
  await toTop();
  await shot(win, 'operator-1920x1080');

  await win.setViewportSize({ width: 1280, height: 720 });
  await toTop();
  await shot(win, 'operator-1280x720');

  await win.setViewportSize({ width: 1600, height: 900 });
  await win.getByRole('button', { name: 'Edit words' }).click();
  await expect(win.getByTestId('words-text')).not.toHaveValue('Loading…');
  await shot(win, 'edit-words');
  await win.getByTestId('words-editor').getByRole('button', { name: 'Cancel' }).click();

  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  await expect(win.getByTestId('theme-editor')).toBeVisible();
  await shot(win, 'themes');
  await win.getByRole('button', { name: 'Close themes' }).click();

  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('sound-output')).toBeVisible();
  await shot(win, 'screens');
  await win.getByRole('button', { name: 'Close screens' }).click();
  await app.close();
});

/** Click a point on the slide in the slide editor (slide pixels). */
async function clickSlide(win: Page, x: number, y: number) {
  const canvas = win.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (box) await win.mouse.click(box.x + x * scale, box.y + y * scale);
}

test('the slide editor', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await running(win);
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  // A band behind the words, to show a shape.
  await editor.getByTestId('add-shape').click();
  await win.getByRole('menuitem', { name: 'Rounded rectangle' }).click();
  await editor.getByTestId('field-y').fill('380');
  await editor.getByTestId('field-height').fill('320');
  await editor.getByTestId('field-width').fill('1400');
  await editor.getByTestId('field-x').fill('260');
  await editor.getByTestId('field-opacity').fill('60');
  await editor.getByRole('button', { name: 'Send to the back' }).click();
  // The words selected: their handles, and the inspector's words section.
  await clickSlide(win, 960, 420);
  await expect(editor.getByTestId('inspector-text')).toBeVisible();
  await shot(win, 'slide-editor');
  await win.keyboard.press('Escape');
  await expect(editor.getByTestId('slide-panel')).toBeVisible();
  await shot(win, 'slide-editor-slide');
  await win.setViewportSize({ width: 1280, height: 720 });
  await clickSlide(win, 960, 420);
  await shot(win, 'slide-editor-1280x720');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await win.getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' }).click();
  await app.close();
});

test('the kirtan library, screens’ languages, templates and the setup wizard', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();

  // The Kirtan dialog, with details filled in.
  await win.getByTestId('kirtan-button').click();
  const details = win.getByTestId('kirtan-details');
  await details.getByTestId('kirtan-kavi').fill('Placeholder Kavi');
  await details.getByTestId('kirtan-raag').fill('Placeholder Raag');
  await details.getByTestId('kirtan-occasion').fill('Diwali');
  await details.getByTestId('kirtan-occasion').press('Enter');
  await shot(win, 'kirtan-dialog');
  await win.getByTestId('kirtan-done').click();

  // Edit words, by language: every language side by side, one missing.
  await win.getByRole('button', { name: 'Edit words' }).click();
  const editor = win.getByTestId('words-editor');
  await editor.getByTestId('words-mode-tab-tracks').click();
  await editor.getByTestId('track-slide').nth(1).getByRole('textbox', { name: 'Slide 2, English' }).fill('');
  await shot(win, 'words-by-language');
  await editor.getByRole('button', { name: 'Cancel' }).click();

  // Screens: two groups, each with its own languages; and an output showing them.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    for (const [name, i, langs] of [
      ['Hall', 0, ['gu', 'translit']],
      ['Stream', 1, ['translit', 'en']],
    ] as const) {
      const created = await d.screens.createGroup(name);
      if (!created.ok) continue;
      const g = created.snapshot.groups.find((x) => x.name === name);
      await d.screens.assignDisplay(g?.id ?? '', created.snapshot.displays[i]?.id ?? -1, {
        coverOperator: true,
      });
      await d.screens.setGroupLanguages(g?.id ?? '', [...langs]);
    }
  });
  await win.getByTestId('slide-thumb').first().click();
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await shot(win, 'screens-languages');
  await win.getByRole('button', { name: 'Close screens' }).click();
  await shot(win, 'operator-kirtan-languages');

  // Templates, a playlist made from one, and filling a slot.
  await win.getByTestId('playlist-view-tab-templates').click();
  await shot(win, 'templates');
  await win.getByRole('button', { name: 'New playlist from Example: Ravi Sabha' }).click();
  await win.getByRole('textbox', { name: 'Playlist name' }).press('Enter');
  await win.getByTestId('playlist-item').nth(1).click();
  await expect(win.getByTestId('fill-slot')).toBeVisible();
  await shot(win, 'fill-slot');
  await win.getByTestId('fill-slot').getByRole('button', { name: 'Cancel' }).click();

  // The setup wizard's screens step.
  await chooseMenuItem(app, 'set-up-screens');
  await win.getByTestId('setup-wizard').getByTestId('setup-next').click();
  await shot(win, 'setup-wizard');
  await app.close();
});

test('Simple Mode', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('PageDown');
  await win.keyboard.press('PageDown');
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  await shot(win, 'simple-mode-1280x720');
  await win.keyboard.press('F1');
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await shot(win, 'simple-mode-put-it-back');
  await app.close();
});

test('the component gallery', async () => {
  const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
  await expect((await operatorPage(app)).getByTestId('live-status')).toBeVisible();
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
  await chooseMenuItem(app, 'component-gallery');
  const gallery = await opened;
  await gallery.setViewportSize({ width: 1440, height: 900 });
  await gallery.locator('#buttons').scrollIntoViewIfNeeded();
  await shot(gallery, 'component-gallery');
  await app.close();
});

test('the stream: the panel on air and recording, its settings, and the Program in both layouts', async () => {
  test.setTimeout(120_000);
  const ffmpeg = testFfmpeg();
  test.skip(!ffmpeg, 'FFmpeg is not fetched here');
  // Chromium's fake camera only, and FFmpeg on this computer in YouTube's place (a made-up key).
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-stream-'));
  const listener = rtmpListener(ffmpeg ?? '', port, join(dir, 'received.flv'));
  try {
    const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1' });
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1600, height: 900 });
    await running(win);
    await app.evaluate(({ dialog }, into) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
    }, dir);
    await win.getByTestId('open-stream').click();
    const isStream = (p: Page) => p.url().includes('stream.html');
    const program =
      app.windows().find(isStream) ?? (await app.waitForEvent('window', { predicate: isStream }));
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status())).inputs.cameras
            .length,
      )
      .toBeGreaterThan(0);
    await win.evaluate(
      async ({ port, key }) => {
        const d = (globalThis as PageGlobals).drashti;
        const s = await d.stream.status();
        const { profiles, activeId } = await d.stream.profiles();
        const p = profiles.find((x) => x.id === activeId);
        if (!p) return;
        await d.stream.saveProfile(p.id, {
          name: 'YouTube',
          url: `rtmp://127.0.0.1:${port}/live2`,
          preset: 'good',
          camera: s.inputs.cameras[0] ?? null,
          sound: s.inputs.microphones[0] ?? null,
          soundDelayMs: 120,
          mixOwnSound: false,
        });
        await d.stream.setKey(p.id, key);
        const group = (await d.screens.get()).groups.find((g) => g.role === 'stream');
        if (group) await d.screens.setGroupLanguages(group.id, ['translit', 'en']);
        await d.stream.pickFolder();
        await d.stream.startRecording();
        await d.stream.goLive({ confirmed: true });
      },
      { port, key: TEST_KEY },
    );
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status())).live.state,
        {
          timeout: 30_000,
        },
      )
      .toBe('live');
    await expect(win.getByTestId('stream-preview')).toBeVisible();
    await win.waitForTimeout(3000);
    await shot(win, 'stream-panel');
    await mkdirAndShot(program, 'stream-program-camera');
    await win.getByTestId('stream-layout-slides').click();
    await win.waitForTimeout(1000);
    await mkdirAndShot(program, 'stream-program-slides');
    await win.getByTestId('stream-layout-camera').click();
    await win.getByTestId('open-stream-settings').click();
    await expect(win.getByTestId('stream-key-saved')).toBeVisible();
    await shot(win, 'stream-settings');
    await win.getByRole('button', { name: 'Close stream settings' }).click();
    await win.getByRole('button', { name: 'Close stream' }).click();
    await win.setViewportSize({ width: 1280, height: 720 });
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('on-air')).toBeVisible();
    await shot(win, 'simple-mode-on-air');
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      await d.stream.end({ confirmed: true });
      await d.stream.stopRecording();
    });
    await app.close();
  } finally {
    listener.kill('SIGKILL');
  }
});

/** The Program's own picture (its offscreen page), at the stream's size. */
async function mkdirAndShot(page: Page, name: string) {
  mkdirSync(folder, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(folder, `${name}.png`), scale: 'css' });
}

test('converting media: the import report, then the media list while converting and after', async () => {
  test.setTimeout(180_000);
  const ffmpeg = testFfmpeg();
  test.skip(!ffmpeg, 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-shots-'));
  const make = (args: string[]) => {
    const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  };
  // Generated files only: a long old-style AVI (so it is still converting for the picture), a ProRes clip,
  // an AIFF and the tiny HEIC from the fixtures.
  const files = [
    'Placeholder welcome loop.avi',
    'Placeholder intro.mov',
    'Placeholder bell.aiff',
    'Placeholder photo.heic',
  ].map((n) => join(dir, n));
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1280x720:r=30',
    '-t',
    '90',
    '-c:v',
    'mpeg4',
    '-q:v',
    '6',
    files[0] ?? '',
  ]);
  make(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-t', '2', '-c:v', 'prores_ks', files[1] ?? '']);
  make(['-f', 'lavfi', '-i', 'sine=r=44100', '-t', '2', files[2] ?? '']);
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'media', 'placeholder.heic'), files[3] ?? '');

  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  await dropFiles(win, win.getByTestId('library-drop'), files);
  const report = win.getByTestId('import-report');
  await expect(report.getByTestId('report-convert-all')).toBeVisible({ timeout: 60_000 });
  await shot(win, 'convert-report');

  await report.getByTestId('report-convert-all').click();
  await report.getByRole('button', { name: 'Close' }).click();
  await win.getByRole('tab', { name: 'Media' }).click();
  await expect(win.getByTestId('convert-progress')).toBeVisible({ timeout: 60_000 });
  await shot(win, 'convert-media-list');
  await expect(win.getByTestId('convert-bar')).toBeHidden({ timeout: 150_000 });
  await shot(win, 'convert-media-list-done');
  await app.close();
});

test('the local network: the Phones panel, announcements, the ticker, and the pages on a phone and a tablet', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await running(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const tablet = await device('webkit', TABLET);
  const stage = await device('webkit', TABLET);
  const sender = await device('webkit');
  const fresh = await device('webkit');
  try {
    await pairByQr(phone.page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await pairByQr(tablet.page, base, await pairingCode(win, 'remote', 'Placeholder tablet'), '/remote');
    await pairByQr(stage.page, base, await pairingCode(win, 'stage', 'Placeholder stage tablet'), '/stage');
    const key = await win.evaluate(async () => {
      const r = await (globalThis as PageGlobals).drashti.network.makePoster();
      return r.ok && r.status.poster ? (r.status.poster.url.split('#k=')[1] ?? '') : '';
    });
    await sender.page.goto(`${base}/announce#k=${key}`);
    const send = async (text: string) => {
      await sender.page.getByTestId('announce-text').fill(text);
      await sender.page.getByTestId('announce-from').fill('Placeholder name');
      await sender.page.getByTestId('announce-send').click();
      await expect(sender.page.getByRole('status')).toContainText('waiting for the operator');
    };
    await send('Placeholder: prasad is in the hall after arti');
    await send('Placeholder: car 12 please move');
    await send('Placeholder: lost and found is at the front desk');
    // The first in the ticker; the others wait.
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const [first] = (await d.announcements.list()).waiting;
      if (first) await d.announcements.approve({ id: first.id, as: 'ticker' });
    });
    await expect(output.getByTestId('ticker')).toBeVisible();

    // The Phones panel, offering a code (covered in the picture), with the devices paired.
    await win.getByTestId('open-network').click();
    const panel = win.getByTestId('network-panel');
    await panel.getByTestId('pair-name').fill('Placeholder remote');
    await panel.getByTestId('pair-remote').click();
    await expect(panel.getByTestId('pairing-offer')).toBeVisible();
    // The pairing code, its QR code and the poster's QR code (its key) are covered in the picture.
    await shot(win, 'phones-panel', [panel.getByTestId('qr-code'), panel.getByTestId('pairing-code')]);
    await win.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // The announcements queue.
    await win.getByTestId('open-announcements').click();
    await expect(win.getByTestId('announcement-waiting')).toHaveCount(2);
    await shot(win, 'announcements-queue');
    await win.keyboard.press('Escape');

    // An audience screen with the ticker; the pages.
    await shot(output, 'output-ticker');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await shot(phone.page, 'phone-remote');
    await phone.page.getByTestId('remote-tab-playlist').click();
    await shot(phone.page, 'phone-remote-playlist');
    await expect(tablet.page.getByTestId('remote-items')).toBeVisible();
    await shot(tablet.page, 'tablet-remote');
    await expect(stage.page.getByTestId('stage-view')).toBeVisible();
    await shot(stage.page, 'tablet-stage-display');
    await sender.page.reload();
    await expect(sender.page.getByTestId('announce-sent')).toHaveCount(3);
    await shot(sender.page, 'phone-announce', [], true);
    await fresh.page.goto(`${base}/pair`);
    await expect(fresh.page.getByTestId('pair-code')).toBeVisible();
    await shot(fresh.page, 'phone-pair');
  } finally {
    for (const d of [phone, tablet, stage, sender, fresh]) await d.close();
  }
  await app.close();
});

test('the presenter’s remote: the library and the notes on an iPhone, and an iPad held sideways (Session 18)', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  const talkId = await placeholderTalk(win);
  await setUpScreen(win);
  await outputPage(app);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    talkId,
  );
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const sideways = await device('webkit', 'iPad (gen 7) landscape');
  const upright = await device('webkit', TABLET);
  try {
    await pairByQr(
      phone.page,
      base,
      await pairingCode(win, 'remote', 'Placeholder presenter phone'),
      '/remote',
    );
    await pairByQr(
      sideways.page,
      base,
      await pairingCode(win, 'remote', 'Placeholder presenter iPad'),
      '/remote',
    );
    await pairByQr(upright.page, base, await pairingCode(win, 'remote', 'Placeholder tablet'), '/remote');
    const p = phone.page;
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // The live slide's notes and the next one's, under the live picture.
    await expect(p.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
    await shot(p, 'phone-remote-notes');
    // The whole library, by name, then searched by words on a slide.
    await p.getByTestId('remote-tab-library').click();
    await expect(p.getByTestId('remote-library-item').filter({ hasText: TALK })).toBeVisible();
    await shot(p, 'phone-remote-library');
    await p.getByTestId('remote-library-search').fill('talk point two');
    await expect(
      p.getByTestId('remote-library-item').filter({ hasText: 'Placeholder talk point two' }),
    ).toBeVisible();
    await shot(p, 'phone-remote-search');
    // Held sideways: the live picture, the notes and Next beside the slides.
    const t = sideways.page;
    await expect(t.getByTestId('remote')).toHaveAttribute('data-layout', 'landscape');
    await expect(t.getByTestId('remote-notes-live')).toHaveText(NOTE_ONE);
    await expect(t.getByTestId('remote-slide').first()).toHaveAttribute('data-live', 'true');
    await shot(t, 'tablet-remote-sideways');
    // Held upright: the library beside the show.
    const u = upright.page;
    await u.getByTestId('remote-side-library').click();
    await expect(u.getByTestId('remote-library-item').filter({ hasText: TALK })).toBeVisible();
    await shot(u, 'tablet-remote-library');
  } finally {
    for (const d of [phone, sideways, upright]) await d.close();
  }
  await app.close();
});

test('Looks, stage layouts, masks, key and fill, macros, MIDI and the slide editor (Session 11)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '3',
    ...NETWORK_ENV,
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1600, height: 900 });
  const show = await running(win);
  // A hall, a stage, and a key and fill pair; a second Look with the hall's words as a lower third over
  // its background; a mask, a stage layout and macros.
  await win.evaluate(async (logoId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = async (name: string, role: 'audience' | 'stage' | 'keyfill', displays: number[]) => {
      const g = await d.screens.createGroup(name);
      if (!g.ok) throw new Error(g.message);
      const id = g.snapshot.groups.find((x) => x.name === name)?.id ?? '';
      if (role !== 'audience') await d.screens.setGroupRole(id, role);
      for (const i of displays)
        await d.screens.assignDisplay(id, g.snapshot.displays[i]?.id ?? -1, { coverOperator: true });
      return id;
    };
    const hall = await group('Placeholder hall', 'audience', [0]);
    const stage = await group('Placeholder stage', 'stage', [1]);
    await group('Placeholder switcher', 'keyfill', [2, 3]);
    const mask = await d.masks.save(null, {
      name: 'Placeholder LED wall',
      width: 1920,
      height: 1080,
      mode: 'hide',
      shapes: [
        { id: 'l', kind: 'rectangle', frame: { x: 0, y: 0, width: 160, height: 1080 } },
        { id: 'r', kind: 'ellipse', frame: { x: 1620, y: -200, width: 600, height: 600 } },
      ],
    });
    const layout = await d.stageLayouts.save(null, {
      name: 'Placeholder band layout',
      background: '#0b0d11',
      boxes: [
        {
          id: 'm',
          kind: 'stageMessage',
          frame: { x: 48, y: 40, width: 1824, height: 110 },
          size: 64,
          color: '#000000',
          align: 'left',
          label: '',
        },
        {
          id: 'c',
          kind: 'current',
          frame: { x: 48, y: 180, width: 1180, height: 560 },
          size: 'fit',
          color: '#ffffff',
          align: 'left',
          label: 'NOW',
        },
        {
          id: 'k',
          kind: 'clock',
          frame: { x: 1280, y: 180, width: 592, height: 140 },
          size: 'fit',
          color: '#ffffff',
          align: 'right',
          label: '',
        },
        {
          id: 't',
          kind: 'timer',
          frame: { x: 1280, y: 340, width: 592, height: 200 },
          size: 80,
          color: '#fde68a',
          align: 'right',
          label: '',
          timerId: null,
        },
        {
          id: 'u',
          kind: 'upcoming',
          frame: { x: 1280, y: 560, width: 592, height: 480 },
          size: 44,
          color: '#c9ced8',
          align: 'left',
          label: 'COMING UP',
          count: 5,
        },
        {
          id: 'n',
          kind: 'next',
          frame: { x: 48, y: 780, width: 1180, height: 260 },
          size: 48,
          color: '#c9ced8',
          align: 'left',
          label: 'NEXT',
        },
      ],
    });
    if (!mask.ok || !layout.ok) throw new Error('could not make the mask or the layout');
    const looks = await d.looks.list();
    const standard = looks.liveId;
    await d.looks.setGroup(standard, hall, { maskId: mask.id });
    await d.looks.setGroup(standard, stage, { stageLayoutId: layout.id });
    const lower = await d.looks.create('Placeholder lower thirds', standard);
    const lowerId = lower.ok
      ? (lower.view.looks.find((l) => l.name === 'Placeholder lower thirds')?.id ?? '')
      : '';
    await d.looks.setGroup(lowerId, hall, {
      slides: 'lowerThird',
      layers: ['background', 'slide', 'props', 'messages'],
    });
    await d.macros.save(null, {
      name: 'Placeholder arti',
      color: '#e8590c',
      actions: [
        { kind: 'clearAll' },
        { kind: 'showProp', propId: logoId },
        { kind: 'stageMessage', text: 'Placeholder: arti now' },
        { kind: 'blackout', to: 'off' },
      ],
    });
    await d.macros.save(null, {
      name: 'Placeholder lower thirds on',
      color: '#3e63dd',
      actions: [{ kind: 'look', lookId: lowerId }],
    });
    await d.macros.save(null, {
      name: 'Placeholder Standard',
      color: '#868e96',
      actions: [{ kind: 'look', lookId: standard }],
    });
    await d.engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: two minutes' });
    // A coloured background, so the hall's mask shows (what it hides is black).
    await d.engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#1f3a5f' } });
  }, show.logoPropId);
  // The right column from its top: the Looks, Macros and Masks panels.
  await win.getByTestId('looks-panel').evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  await shot(win, 'operator-looks-macros-masks');

  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('looks-section')).toBeVisible();
  await shot(win, 'screens-looks', [], true);
  await win.getByTestId('edit-stage-layouts').click();
  const layouts = win.getByTestId('stage-layout-editor');
  await layouts.getByRole('button', { name: 'Placeholder band layout' }).click();
  await layouts.getByTestId('stage-box-list').getByRole('button').nth(1).click();
  await shot(win, 'stage-layout-editor');
  await layouts.getByRole('button', { name: 'Close stage layouts' }).click();
  await win.getByTestId('edit-masks').first().click();
  const masks = win.getByTestId('mask-editor');
  await masks.getByTestId('mask-shape-list').getByRole('button').nth(1).click();
  await shot(win, 'mask-editor');
  await masks.getByRole('button', { name: 'Close masks' }).click();
  await win.getByRole('button', { name: 'Close screens' }).click();

  // The outputs: the hall with its own mask, the stage's layout, the key and fill pair.
  const outputs = async (role: string, feed?: string) => {
    for (const p of app
      .windows()
      .filter((w) => w.url().includes('output.html') && !w.url().includes('identify=')))
      if (
        (await p.getByTestId('output-root').getAttribute('data-role')) === role &&
        (feed === undefined || (await p.getByTestId('output-root').getAttribute('data-feed')) === feed)
      )
        return p;
    throw new Error(`no ${role} output`);
  };
  await shot(await outputs('audience'), 'output-hall-mask');
  await shot(await outputs('stage'), 'output-stage-layout');
  await win.getByTestId('looks-panel').getByRole('button', { name: 'Placeholder lower thirds' }).click();
  await shot(await outputs('keyfill', 'fill'), 'output-fill');
  await shot(await outputs('keyfill', 'key'), 'output-key');
  await shot(await outputs('audience'), 'output-hall-lower-third');

  await win.getByTestId('macros-panel').getByRole('button', { name: 'Edit' }).click();
  await expect(win.getByTestId('macro-editor').getByTestId('macro-action')).toHaveCount(4);
  await shot(win, 'macro-editor');
  await win.getByRole('button', { name: 'Close macros' }).click();
  await win.evaluate(() => {
    const input = {
      id: 'pad',
      name: 'Placeholder pad',
      state: 'connected',
      type: 'input',
      onmidimessage: null,
    };
    const access = {
      inputs: new Map([['pad', input]]),
      outputs: new Map(),
      onstatechange: null,
      sysexEnabled: false,
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
    });
  });
  await win.getByTestId('macros-panel').getByTestId('open-midi').click();
  await win.getByTestId('midi-device').selectOption('Placeholder pad');
  await shot(win, 'midi-dialog');
  await win.getByRole('button', { name: 'Close MIDI' }).click();

  // The slide editor with two elements selected together.
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  await editor.getByTestId('add-shape').click();
  await win.getByRole('menuitem', { name: 'Rounded rectangle' }).click();
  // Below the words, so both show.
  await editor.getByTestId('field-y').fill('700');
  await editor.getByTestId('editor-canvas').focus();
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await expect(editor.getByTestId('group-box')).toBeVisible();
  await shot(win, 'slide-editor-together');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await win.getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' }).click();

  // The phone remote's More tab: Looks and macros.
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, code, '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await phone.page.getByTestId('remote-tab-more').click();
    await expect(phone.page.getByTestId('remote-macros')).toBeVisible();
    await shot(phone.page, 'phone-remote-more');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('Shastra, timers in the running order, the arti prompt, Samvat and tithi, and the idle rotation (Session 12)', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
    DRASHTI_TEST_ARTI_CLOCK: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1600, height: 900 });
  await running(win);
  // The made-up texts and a made-up calendar for today, generated pictures, placeholder quotes.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-12-'));
  const examples = join(__dirname, '..', '..', 'docs', 'examples');
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const calendar = join(dir, 'placeholder-calendar.json');
  writeFileSync(
    calendar,
    JSON.stringify({
      format: 'drashti-calendar',
      version: 1,
      name: 'Placeholder calendar',
      days: [
        {
          date: today,
          samvat: 1001,
          month: { gu: 'નમૂના માસ', en: 'Placeholder month' },
          paksha: { gu: 'પહેલો પક્ષ', en: 'First half' },
          tithi: { gu: 'નમૂના તિથિ ૩', en: 'Placeholder tithi 3' },
          festivals: [{ gu: 'નમૂના ઉત્સવ', en: 'Placeholder festival' }],
        },
      ],
    }),
  );
  const pictures: string[] = [];
  for (const [i, color] of ['#3a6ea5', '#a5563a', '#4a8f4a'].entries())
    pictures.push(
      await makeTestImage(win, join(dir, `placeholder-darshan-${String(i + 1)}.png`), {
        color,
        width: 1600,
        height: 900,
      }),
    );
  const files = [
    join(examples, 'placeholder-granth.json'),
    join(examples, 'placeholder-vachan.json'),
    calendar,
    ...pictures,
  ];
  const made = await win.evaluate(
    async ({ files, pictures }) => {
      const d = (globalThis as PageGlobals).drashti;
      const started = await d.library.importPaths(files);
      if (!started.ok) throw new Error(started.message);
      const report = await d.library.getImportReport(started.run.id);
      const ids = pictures.map((p) => report?.items.find((i) => i.sourcePath === p)?.target?.id ?? '');
      const screens: Record<string, string> = {};
      const group = async (name: string, role: 'audience' | 'stage', display: number) => {
        const g = await d.screens.createGroup(name);
        if (!g.ok) throw new Error(g.message);
        const id = g.snapshot.groups.find((x) => x.name === name)?.id ?? '';
        if (role !== 'audience') await d.screens.setGroupRole(id, role);
        const assigned = await d.screens.assignDisplay(id, g.snapshot.displays[display]?.id ?? -1, {
          coverOperator: true,
        });
        if (!assigned.ok) throw new Error(assigned.message);
        screens[name] = assigned.snapshot.groups.find((x) => x.id === id)?.screens[0]?.id ?? '';
        return id;
      };
      const hall = await group('Placeholder hall', 'audience', 0);
      const lobby = await group('Placeholder lobby', 'audience', 1);
      const stage = await group('Placeholder stage', 'stage', 2);
      const layout = await d.stageLayouts.save(null, {
        name: 'Placeholder day layout',
        background: '#0b0d11',
        boxes: [
          {
            id: 'c',
            kind: 'clock',
            frame: { x: 48, y: 40, width: 1824, height: 260 },
            size: 'fit',
            color: '#ffffff',
            align: 'right',
            label: '',
            calendar: true,
            lang: 'en',
          },
          {
            id: 's',
            kind: 'samvat',
            frame: { x: 48, y: 340, width: 1824, height: 220 },
            size: 64,
            color: '#fde68a',
            align: 'left',
            label: 'TODAY',
            lang: 'gu',
          },
          {
            id: 'q',
            kind: 'quote',
            frame: { x: 48, y: 620, width: 1824, height: 420 },
            size: 56,
            color: '#ffffff',
            align: 'left',
            label: 'QUOTE OF THE DAY',
          },
        ],
      });
      if (!layout.ok) throw new Error(layout.message);
      const live = (await d.looks.list()).liveId;
      await d.looks.setGroup(live, hall, { idle: 'started', languages: ['sa-gu', 'translit', 'gu'] });
      await d.looks.setGroup(live, lobby, { idle: 'always' });
      await d.looks.setGroup(live, stage, { stageLayoutId: layout.id });
      for (const words of [
        { gu: 'આ નમૂનાનું વાક્ય છે.', en: 'This is a placeholder quote.' },
        { en: 'A second placeholder quote.' },
      ])
        await d.idle.saveQuote(null, { words, attribution: 'Placeholder' });
      await d.idle.saveSettings({ pictures: ids, secondsEach: 4, quoteOfTheDay: true });
      const kirtan = (await d.library.listPresentations()).find((p) => p.kirtan !== null)?.id ?? '';
      await d.arti.save(null, {
        name: 'Placeholder evening arti',
        presentationId: kirtan,
        days: [0, 1, 2, 3, 4, 5, 6],
        date: null,
        time: '19:00',
        promptMinutes: 5,
        byItself: false,
        enabled: true,
      });
      await d.messages.create({
        name: 'Placeholder today',
        template: 'Today: {date}',
        fields: { date: { kind: 'samvat', lang: 'en' } },
      });
      return { quoteId: (await d.idle.view()).quoteOfTheDay?.id ?? '', screens };
    },
    { files, pictures },
  );
  const quoteId = made.quoteId;
  const outputs = async (name: string): Promise<Page> => {
    const screenId = made.screens[name] ?? '-';
    let found: Page | undefined;
    await expect
      .poll(async () => {
        for (const p of app.windows().filter((w) => w.url().includes('output.html')))
          if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
        return found !== undefined;
      })
      .toBe(true);
    if (!found) throw new Error(`no ${name} output`);
    return found;
  };

  // Shastra: a passage found by its reference, in the slide grid; the loaded texts.
  await win.getByRole('tab', { name: 'Shastra' }).click();
  const panel = win.getByTestId('shastra-panel');
  await panel.getByTestId('shastra-reference').fill('PG 14-15');
  await panel.getByTestId('shastra-reference').press('Enter');
  await expect(win.getByTestId('slide-grid')).toHaveAttribute('data-presentation-id', 'shastra:pg#14-15');
  await win.getByTestId('slide-thumb').first().click();
  await shot(win, 'shastra-tab');
  await panel.getByTestId('open-shastra-texts').click();
  await expect(win.getByTestId('shastra-texts-dialog')).toBeVisible();
  await shot(win, 'shastra-texts');
  await win.getByRole('button', { name: 'Close Shastra texts' }).click();
  await shot(await outputs('Placeholder hall'), 'output-shastra');

  // A playlist item's timers.
  await win.getByRole('tab', { name: 'Presentations' }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Timers when it goes up…' }).click();
  await win.getByTestId('timer-cues').getByTestId('add-timer-cue').click();
  await shot(win, 'timer-cues');
  await win.getByTestId('timer-cues').getByRole('button', { name: 'Cancel' }).click();

  // The arti: minutes before its time (tomorrow, on the schedules' test clock), and its schedule.
  const tomorrow = (h: number, m: number) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const clockTo = (ms: number) =>
    app.evaluate((_e, at) => {
      (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock?.(at);
    }, ms);
  await clockTo(tomorrow(18, 56));
  await expect(win.getByTestId('arti-prompt')).toBeVisible();
  await win.getByTestId('arti-panel').evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  await shot(win, 'arti-prompt');
  await win.getByTestId('arti-schedule').getByRole('button').first().click();
  await expect(win.getByTestId('arti-dialog')).toBeVisible();
  await shot(win, 'arti-dialog');
  await win.getByRole('button', { name: 'Close the arti time' }).click();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await clockTo(tomorrow(19, 0));
  await expect(win.getByTestId('simple-mode').getByTestId('arti-prompt')).toContainText('it is time');
  await shot(win, 'simple-mode-arti');
  await win.getByTestId('arti-not-now').click();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));

  // Samvat and tithi: the Calendar dialog, and the stage screen's clock, Samvat and quote boxes.
  await win.getByTestId('open-calendar').click();
  await expect(win.getByTestId('calendar-dialog')).toBeVisible();
  await shot(win, 'calendar-dialog');
  await win.getByRole('button', { name: 'Close the calendar' }).click();
  await shot(await outputs('Placeholder stage'), 'output-stage-samvat');

  // The idle rotation: its dialog; started, with nothing up, a picture and then the quote of the day.
  await win.getByTestId('idle-panel').getByTestId('open-idle').click();
  await expect(win.getByTestId('idle-dialog')).toBeVisible();
  await shot(win, 'idle-dialog');
  await win.getByRole('button', { name: 'Close the idle rotation' }).click();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
  await win.getByTestId('idle-panel').getByTestId('idle-start').click();
  const hall = await outputs('Placeholder hall');
  await expect(hall.locator('[data-layer="idle"][data-idle-index="0"]')).toBeVisible({ timeout: 20_000 });
  await hall.waitForTimeout(500);
  await shot(hall, 'output-idle-picture');
  await expect(hall.locator('[data-layer="idle"][data-idle-index="3"]')).toBeVisible({ timeout: 20_000 });
  await expect(hall.locator(`[data-idle-item="${quoteId}"]`).first()).toBeVisible();
  await hall.waitForTimeout(500);
  await shot(hall, 'output-idle-quote');
  await app.close();
});

test('output nodes: the node’s window, Screens with a node, pairing, the dashboard and its warning (Session 13)', async () => {
  test.setTimeout(240_000);
  const main = await launchMain({ DRASHTI_TEST_COMPUTER_NAME: 'Placeholder Mandir Mac' });
  const node = await launchNode({ DRASHTI_TEST_COMPUTER_NAME: 'Placeholder Lobby PC' });
  try {
    await node.page.setViewportSize({ width: 1280, height: 720 });
    await shot(node.page, 'node-window-unpaired');
    // Main offering a code (covered in the picture), then the node paired.
    await main.win.setViewportSize({ width: 1920, height: 1080 });
    await main.win.getByRole('button', { name: 'Screens', exact: true }).click();
    await nodeCode(main.win);
    await expect(main.win.getByTestId('node-pairing')).toBeVisible();
    await main.win.getByTestId('nodes-section').scrollIntoViewIfNeeded();
    await shot(main.win, 'screens-pair-node', [main.win.getByTestId('node-pairing-code')]);
    await main.win.getByRole('button', { name: 'Close screens' }).click();
    const nodeId = await pairNode(main, node);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-nodes-'));
    const words = join(dir, 'Placeholder Node Kirtan.txt');
    writeFileSync(words, '[Verse]\nPlaceholder line one on every screen\nPlaceholder line two\n');
    const backdrop = await makeTestImage(main.win, join(dir, 'Placeholder hall backdrop.png'), {
      width: 640,
      height: 360,
      color: '#203858',
    });
    const [id = ''] = await main.win.evaluate(
      async (files) => {
        const d = (globalThis as PageGlobals).drashti;
        const r = await d.library.importPaths(files);
        if (!r.ok) throw new Error(r.message);
        const report = await d.library.getImportReport(r.run.id);
        return files.map((f) => report?.items.find((i) => i.sourcePath === f)?.target?.id ?? '');
      },
      [words, backdrop],
    );
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    await expect
      .poll(async () =>
        main.win.evaluate(
          async (n) =>
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((x) => x.id === n)?.displays
              .length ?? 0,
          nodeId,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await main.win.evaluate(
      async ({ nodeId, id }) => {
        const d = (globalThis as PageGlobals).drashti;
        const s = await d.screens.get();
        const group = s.groups.find((g) => g.name === 'Placeholder Hall');
        const n = s.nodes.find((x) => x.id === nodeId);
        const r = await d.screens.assignNodeDisplay(group?.id ?? '', nodeId, n?.displays[1]?.id ?? -1);
        if (!r.ok) throw new Error(r.message);
        const media = await d.library.listMedia();
        const bg = media.find((m) => m.name.startsWith('Placeholder hall backdrop'));
        if (bg)
          await d.engine.dispatch({
            type: 'setBackground',
            background: { kind: 'media', mediaId: bg.id, media: 'image', fit: 'fill', loop: false },
          });
        await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
      },
      { nodeId, id },
    );
    await outputPage(node.app);
    await expect
      .poll(async () => (await nodeView(node.page)).displays.some((d) => d.screen?.showing))
      .toBe(true);
    await shot(node.page, 'node-window');
    // A node's Save Diagnostics (Session 17): its window says where the file went.
    const desktop = mkdtempSync(join(tmpdir(), 'drashti-shots-node-desktop-'));
    await node.app.evaluate(({ app }, folder) => {
      app.setPath('desktop', folder);
    }, desktop);
    await chooseMenuItem(node.app, 'save-diagnostics');
    await expect(node.page.getByTestId('node-notice')).toContainText('Diagnostics saved on the Desktop');
    await shot(node.page, 'node-diagnostics-saved');
    // Screens, with the node and its displays.
    await main.win.getByRole('button', { name: 'Screens', exact: true }).click();
    await main.win.getByTestId('nodes-section').scrollIntoViewIfNeeded();
    await shot(main.win, 'screens-with-node');
    await main.win.getByRole('button', { name: 'Close screens' }).click();
    // The dashboard, with both pictures.
    await main.win.getByTestId('screens-summary').click();
    const dashboard = main.win.getByTestId('screens-dashboard');
    await expect(dashboard.getByTestId('dashboard-thumb')).toHaveCount(2, { timeout: 20_000 });
    await shot(main.win, 'screens-dashboard');
    await main.win.setViewportSize({ width: 1280, height: 720 });
    await shot(main.win, 'screens-dashboard-1280x720');
    await dashboard.getByRole('button', { name: 'Close the dashboard' }).click();
    // The node goes: the status bar's warning.
    await node.app.close();
    await expect(main.win.getByTestId('node-warning')).toBeVisible({ timeout: 20_000 });
    await main.win.setViewportSize({ width: 1920, height: 1080 });
    await shot(main.win, 'operator-node-offline');
  } finally {
    await node.app.close().catch(() => undefined);
    await main.app.close();
  }
});

test('music, markers, macros at set times, scheduled backups, and roles and PINs (Session 14)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_TEST_ARTI_CLOCK: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1920, height: 1080 });
  await operatorReady(win);
  await running(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-14-'));
  const toneOne = makeTestTone(join(dir, 'Placeholder tone one.wav'), { seconds: 40, hz: 440 });
  const toneTwo = makeTestTone(join(dir, 'Placeholder tone two.wav'), { seconds: 50, hz: 330 });
  const clip = await makeTestVideo(win, join(dir, 'Placeholder marked clip.webm'), { seconds: 6, hue: 200 });
  await win.evaluate(
    async (files) => {
      const d = (globalThis as PageGlobals).drashti;
      const r = await d.library.importPaths(files);
      if (!r.ok) throw new Error(r.message);
      const media = await d.library.listMedia();
      const tones = media.filter((m) => m.name.startsWith('Placeholder tone')).map((m) => m.id);
      const list = await d.music.create('Placeholder before sabha');
      if (!list.ok || !list.id) throw new Error('not made');
      await d.music.addTracks(list.id, tones, null);
    },
    [toneOne, toneTwo, clip],
  );

  // The Music panel, playing.
  const music = win.getByTestId('music-panel');
  await music.scrollIntoViewIfNeeded();
  await music.getByTestId('music-play').click();
  await expect(music.getByTestId('music-now')).toContainText('Placeholder tone');
  await shot(win, 'music-panel');

  // Setting markers on a video, then its jumps under the live picture.
  await win.getByRole('tab', { name: 'Media' }).click();
  await win.getByTestId('media-markers').first().click();
  const markers = win.getByTestId('markers-dialog');
  await markers.getByTestId('markers-start').fill('0:01.0');
  await markers.getByTestId('markers-end').fill('0:05.0');
  const preview = markers.locator('video');
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  for (const [at, name] of [
    [2, 'Placeholder verse'],
    [3.5, 'Placeholder chorus'],
  ] as const) {
    await preview.evaluate((v: HTMLVideoElement, t) => {
      v.currentTime = t;
    }, at);
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(at, 1);
    await markers.getByTestId('marker-name').fill(name);
    await markers.getByTestId('marker-add').click();
  }
  await shot(win, 'markers-dialog');
  await markers.getByTestId('markers-save').click();
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const video = (await d.library.listMedia()).find((m) => m.kind === 'video');
    await d.engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: video?.id ?? '', media: 'video', fit: 'fill', loop: true },
    });
  });
  await expect(win.getByTestId('marker-jumps')).toContainText('Placeholder chorus');
  await shot(win, 'marker-jumps');

  // A macro at a set time: its editor, then the countdown.
  const made = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.macros.save(null, {
      name: 'Placeholder before sabha',
      color: '#2f9e44',
      actions: [{ kind: 'stageMessage', text: 'Placeholder: sabha soon' }],
      schedules: [{ id: 'weekdays', days: [1, 2, 3, 4, 5], date: null, time: '18:30', enabled: true }],
    }),
  );
  expect(made.ok).toBe(true);
  await win.getByTestId('macros-panel').scrollIntoViewIfNeeded();
  await win.getByTestId('macros-panel').getByRole('button', { name: 'Edit' }).click();
  const editor = win.getByTestId('macro-editor');
  await editor.getByTestId('macro-time').scrollIntoViewIfNeeded();
  await shot(win, 'macro-schedule');
  await editor.getByRole('button', { name: 'Close macros' }).click();
  const at = new Date();
  at.setHours(18, 30, 0, 0);
  while (at.getTime() <= Date.now() || at.getDay() === 0 || at.getDay() === 6) at.setDate(at.getDate() + 1);
  await app.evaluate((_electron, ms) => {
    (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock?.(ms);
  }, at.getTime() + 500);
  const countdown = win.getByTestId('macro-countdown');
  await expect(countdown).toContainText('runs by itself');
  await shot(win, 'macro-countdown');
  await countdown.getByTestId('macro-countdown-cancel').click();

  // Scheduled backups: a folder, weekdays at 03:00.
  const drive = mkdtempSync(join(tmpdir(), 'Placeholder backup drive-'));
  await win.evaluate(async (folder) => {
    const d = (globalThis as PageGlobals).drashti;
    const { schedule } = await d.backups.view();
    await d.backups.save({ ...schedule, folder, enabled: true, time: '03:00', keep: 5 });
  }, drive);
  await chooseMenuItem(app, 'scheduled-backups');
  const backups = win.getByTestId('backups-dialog');
  await expect(backups.getByTestId('backups-next')).toContainText('03:00');
  await shot(win, 'scheduled-backups', [backups.getByTestId('backups-folder')]);
  await backups.getByRole('button', { name: 'Close', exact: true }).click();

  // Roles and PINs (made-up PINs, shown as dots): turned on, the chips, the admin prompt, leaving Simple Mode.
  await win.setViewportSize({ width: 1280, height: 720 });
  await chooseMenuItem(app, 'roles-and-pins');
  const roles = win.getByTestId('roles-dialog');
  await roles.getByTestId('roles-admin-pin').fill('481526');
  await roles.getByTestId('roles-admin-again').fill('481526');
  await roles.getByTestId('roles-operator-pin').fill('937402');
  await roles.getByTestId('roles-operator-again').fill('937402');
  await shot(win, 'roles-dialog');
  await roles.getByTestId('roles-turn-on').click();
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'admin');
  await shot(win, 'role-chip-admin');
  await win.getByTestId('role-chip').click();
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'operator');
  const asked = win.evaluate(() => (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder B'));
  await expect(win.getByTestId('admin-pin')).toBeVisible();
  await shot(win, 'admin-pin');
  await win.getByTestId('admin-pin').getByRole('button', { name: 'Cancel' }).click();
  await asked;
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-music')).toContainText('Placeholder before sabha');
  await shot(win, 'simple-mode-music');
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('leave-simple')).toBeVisible();
  await shot(win, 'leave-simple-pin');
  await app.close();
});

test('updates: the Updates dialog, the status bar, and a node offering to match Main (Session 14)', async () => {
  test.setTimeout(240_000);
  const release = await releaseServer({ '9.9.9': randomBytes(1024 * 1024) }, '9.9.9');
  const installLog = join(mkdtempSync(join(tmpdir(), 'drashti-shots-update-')), 'install.json');
  try {
    const { app } = await launchApp({
      DRASHTI_UPDATE_URL: release.base,
      DRASHTI_TEST_UPDATE_INSTALL: installLog,
    });
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1280, height: 720 });
    await operatorReady(win);
    await chooseMenuItem(app, 'check-for-updates');
    const dialog = win.getByTestId('updates-dialog');
    await dialog.getByTestId('updates-check').click();
    await expect(dialog.getByTestId('updates-offer')).toContainText('Drashti 9.9.9');
    await shot(win, 'updates-offer');
    await dialog.getByTestId('updates-download').click();
    await expect(dialog.getByTestId('updates-ready')).toContainText('Downloaded and checked', {
      timeout: 30_000,
    });
    await dialog.getByTestId('updates-install-on-quit').click();
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.updates.view())).installOnQuit,
      )
      .toBe(true);
    await shot(win, 'updates-ready');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(win.getByTestId('update-status')).toContainText('installs when Drashti quits');
    await shot(win, 'update-status');
    await app.close();
  } finally {
    release.close();
  }
  const mains = await releaseServer({ '1.0.0-test.1': randomBytes(256 * 1024) }, '1.0.0-test.1');
  const main = await launchMain({
    DRASHTI_TEST_VERSION: '1.0.0-test.1',
    DRASHTI_TEST_COMPUTER_NAME: 'Placeholder Mandir Mac',
  });
  const node = await launchNode({
    DRASHTI_TEST_VERSION: '1.0.0-test.2',
    DRASHTI_TEST_COMPUTER_NAME: 'Placeholder Lobby PC',
    DRASHTI_UPDATE_URL: mains.base,
    DRASHTI_TEST_UPDATE_INSTALL: installLog,
  });
  try {
    await node.page.setViewportSize({ width: 1280, height: 720 });
    await typePairing(node.page, main.port, await nodeCode(main.win));
    const offer = node.page.getByTestId('node-update');
    await expect(offer).toContainText('Main runs Drashti 1.0.0-test.1');
    await offer.getByTestId('node-update-check').click();
    await expect(offer.getByTestId('node-update-download')).toBeVisible();
    await shot(node.page, 'node-update-offer', [node.page.getByTestId('node-pair-form').getByLabel('Code')]);
  } finally {
    await node.app.close().catch(() => undefined);
    await main.app.close();
    mains.close();
  }
});

test('PDF and PowerPoint as pictures: the import report and the slides (Session 15)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-pictures-'));
  const pdf = join(dir, 'Placeholder announcements.pdf');
  writeFileSync(
    pdf,
    makeTestPdf([
      {
        width: 960,
        height: 540,
        color: [30, 58, 138],
        text: 'Placeholder page one',
        note: 'Placeholder note, page one',
      },
      { width: 720, height: 540, color: [127, 29, 29], text: 'Placeholder page two' },
      { width: 960, height: 540, color: [20, 83, 45], text: 'Placeholder page three' },
    ]),
  );
  const deck = join(dir, 'Placeholder deck.pptx');
  writeFileSync(
    deck,
    makeTestPptx([{ color: '1E3A8A', text: 'Placeholder slide', notes: 'Placeholder note' }]),
  );
  await dropFiles(win, win.getByTestId('library-drop'), [pdf, deck]);
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report).toContainText('became a slide holding its picture');
  await shot(win, 'pictures-report');
  await report
    .getByTestId('report-item')
    .filter({ hasText: 'Placeholder announcements' })
    .first()
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(report).toHaveCount(0);
  // An import with a problem says so in the status bar, in the warning colour (Session 16).
  await expect(win.getByTestId('import-result').getByLabel('Problems')).toBeVisible();
  await win.waitForTimeout(500);
  await win.screenshot({
    path: join(folder, 'import-problem-status.png'),
    scale: 'css',
    clip: { x: 0, y: 720 - 64, width: 1280, height: 64 },
  });
  await win.getByTestId('slide-thumb').nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 3');
  await shot(win, 'pictures-slides');
  await shot(output, 'output-pictures-page');
  await app.close();
});
