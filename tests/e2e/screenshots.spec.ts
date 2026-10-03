import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { dropFiles, launchApp, operatorPage, operatorReady, QUIET } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { freePort, rtmpListener, TEST_KEY, testFfmpeg } from './stream-helpers';

/*
 * The screenshots in docs/screenshots/, with placeholder content only. Taken
 * by hand, not in CI (the pictures depend on the computer's fonts and
 * displays):
 *
 *   DRASHTI_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/screenshots.spec.ts
 *
 * (after pnpm build). They are kept at CSS pixel size.
 */

test.skip(!process.env['DRASHTI_SCREENSHOTS'], 'set DRASHTI_SCREENSHOTS=1 to take the screenshots');
test.skip(QUIET, 'Screenshots need real windows: take them on CI (or with DRASHTI_E2E_LOUD=1)');

const folder = join(__dirname, '..', '..', 'docs', 'screenshots');

async function shot(page: Page, name: string) {
  mkdirSync(folder, { recursive: true });
  // Let thumbnails and still frames settle.
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(folder, `${name}.png`), scale: 'css' });
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
  await shot(win, 'operator-1920x1080');

  await win.setViewportSize({ width: 1280, height: 720 });
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
  await win.getByTestId('discard-confirm').getByRole('button', { name: 'Throw them away' }).click();
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
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('set-up-screens')?.click();
  });
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
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('component-gallery')?.click();
  });
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
