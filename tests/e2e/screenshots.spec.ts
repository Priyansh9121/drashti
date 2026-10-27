import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN } from '../../src/shared/appearance/appearances';
import { BUILTIN_THEMES } from '../../src/shared/builtin-themes';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import type { PageGlobals } from './helpers';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode, TABLET } from './devices';
import {
  chooseMenuItem,
  closeLibrary,
  dropFiles,
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  openMoreTools,
  operatorPage,
  operatorReady,
  outputPage,
  QUIET,
  setUpScreen,
  showExtras,
} from './helpers';
import { KIRTAN, NOTE_ONE, placeholderTalk, PLAYLIST, setUpPlaceholderShow, TALK } from './placeholder-show';
import { freePort, rtmpListener, TEST_KEY, testFfmpeg } from './stream-helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';
import { launchMain, launchNode, nodeCode, nodeView, pairNode, typePairing } from './nodes';
import { releaseServer } from './release-server';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { makeZip } from '../../src/main/import/testing/zip-writer';
import { dropboxStandIn, folderLink } from './dropbox-stand-in';

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

// The guides' pictures are in Black (Sessions 39–40), whatever the computer taking them is set to: every Drashti
// this file starts begins in it (a test switch, ignored when packaged). Its outputs are windows of their own
// (Session 45): no picture is taken while an output covers a display, as a full-screen one would on the computer
// taking them (the operator window's display, or a real second one). Set only while this file's tests run:
// loading the file to list its tests, as every run does, must change nothing, and the worker goes on to the
// other files (where it would hide the appearance a test chose).
const appearanceBefore = process.env['DRASHTI_TEST_APPEARANCE'];
const windowedBefore = process.env['DRASHTI_WINDOWED_OUTPUTS'];
test.beforeAll(() => {
  process.env['DRASHTI_TEST_APPEARANCE'] = 'black';
  process.env['DRASHTI_WINDOWED_OUTPUTS'] = '1';
});
test.afterAll(() => {
  if (appearanceBefore === undefined) delete process.env['DRASHTI_TEST_APPEARANCE'];
  else process.env['DRASHTI_TEST_APPEARANCE'] = appearanceBefore;
  if (windowedBefore === undefined) delete process.env['DRASHTI_WINDOWED_OUTPUTS'];
  else process.env['DRASHTI_WINDOWED_OUTPUTS'] = windowedBefore;
});

/**
 * A picture of the page; `hide` covers parts that must not be kept (a pairing
 * code and its QR code); `whole` takes all of a page that scrolls.
 */
async function shot(page: Page, name: string, hide: Locator[] = [], whole = false) {
  mkdirSync(folder, { recursive: true });
  await letTimePass(page, 700, 'the docs’ picture: thumbnails and still frames settle');
  await page.screenshot({
    path: join(folder, `${name}.png`),
    scale: 'css',
    mask: hide,
    maskColor: '#2a2f3a',
    fullPage: whole,
    // Settled (Session 26g): anything still arriving is shown in its place.
    animations: 'disabled',
  });
}

/** A picture of part of the page: the box around these parts (Session 25's close-ups for the guides). */
async function part(page: Page, name: string, parts: Locator[]) {
  mkdirSync(folder, { recursive: true });
  await letTimePass(page, 700, 'the docs’ picture: thumbnails and still frames settle');
  const boxes = (await Promise.all(parts.map((p) => p.boundingBox()))).filter((b) => b !== null);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const clip = {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
  await page.screenshot({ path: join(folder, `${name}.png`), scale: 'css', clip, animations: 'disabled' });
}

/**
 * The bottom of a 1280 x 720 window: the layer bar whole and the status bar under it (Session 51: since the
 * bar's keys sit under its words, a fixed 64 px cut its words in half).
 */
async function barAndStatus(page: Page, name: string) {
  const bar = await page.getByTestId('layer-bar').boundingBox();
  const top = Math.floor(bar?.y ?? 720 - 64);
  await page.screenshot({
    path: join(folder, `${name}.png`),
    scale: 'css',
    clip: { x: 0, y: top, width: 1280, height: 720 - top },
    animations: 'disabled',
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

test('the first start: the welcome, the practice show and the three steps (Session 26g)', async () => {
  // As a person meets it (Session 50): a new library without the tests' placeholder presentations, so the
  // middle behind the welcome has nothing chosen.
  const { app } = await launchApp({ DRASHTI_TEST_NO_WIZARD: '0', DRASHTI_TEST_SEED_PLACEHOLDERS: '' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  const welcome = win.getByTestId('welcome');
  await expect(welcome).toBeVisible();
  await letTimePass(win, 2000, 'the docs’ picture: the lamp lit and the words in their places');
  await shot(win, 'first-start-welcome');
  await welcome.getByRole('button', { name: 'Try a practice show first' }).click();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await expect(win.getByTestId('practice-thumb').nth(1)).toHaveAttribute('aria-current', 'true');
  await shot(win, 'practice-show');
  await win.getByTestId('practice-leave').click();
  await win.getByTestId('welcome').getByRole('button', { name: 'Skip for now' }).click();
  await expect(win.getByTestId('start-here')).toBeVisible();
  await shot(win, 'start-here');
  await app.close();
});

/*
 * Every appearance in Pro Mode in a show, side by side in one folder (Session 40), for Priyansh to compare and
 * choose from: docs/screenshots/appearances/ (never committed: .gitignore), numbered in the menu's order; and the
 * Appearance window itself, for the guides.
 */
test('every appearance in Pro Mode in a show, and the Appearance window (Session 40)', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1440, height: 900 });
  await running(win);
  const live = win.getByRole('complementary', { name: 'Live' });
  await live.evaluate((el) => {
    el.scrollTop = 0;
  });
  mkdirSync(join(folder, 'appearances'), { recursive: true });
  for (const [i, a] of BUILT_IN.entries()) {
    await chooseMenuItem(app, `appearance-${a.id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    await shot(win, join('appearances', `${String(i + 1).padStart(2, '0')}-${a.id}`));
  }
  await chooseMenuItem(app, 'appearance-black');
  await chooseMenuItem(app, 'appearance-window');
  await expect(win.getByTestId('appearance-dialog')).toBeVisible();
  await shot(win, 'appearance-window');
  await app.close();
});

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
  // Closing with the words changed asks first; the kirtan is on the screens, and the question says
  // saving changes them at once (Session 25).
  const words = win.getByTestId('words-text');
  await words.fill(`${await words.inputValue()}\nPlaceholder line added`);
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('keep-changes')).toBeVisible();
  await shot(win, 'keep-changes');
  await win.getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' }).click();

  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  await expect(win.getByTestId('theme-editor')).toBeVisible();
  await shot(win, 'themes');
  await win.getByRole('button', { name: 'Close themes' }).click();

  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('sound-output')).toBeVisible();
  await shot(win, 'screens');
  await win.getByRole('button', { name: 'Close screens' }).click();

  // The keys sheet (Help > Keyboard Shortcuts…, or ?; Session 25).
  await win.setViewportSize({ width: 1280, height: 720 });
  await chooseMenuItem(app, 'keyboard-shortcuts');
  await expect(win.getByTestId('keys-sheet')).toBeVisible();
  await shot(win, 'keys-sheet');
  await win.keyboard.press('Escape');

  // What is this? on the Looks panel: its words under the heading, in the live column.
  await toTop();
  await win.getByTestId('what-is-this-looks').click();
  await expect(win.getByTestId('what-is-this')).toBeVisible();
  await part(win, 'what-is-this', [win.getByRole('complementary', { name: 'Live' })]);
  await win.getByRole('button', { name: 'Got it' }).click();

  // The playlist without dragging: the chosen item's Up and Down, and Add to playlist on the
  // library's chosen row.
  await openLibrary(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await expect(win.getByTestId('playlist-item-moves')).toBeVisible();
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await expect(win.getByTestId('add-to-playlist')).toBeVisible();
  await expect(win.getByTestId('playlist-item-moves')).toBeVisible();
  // The library on the left and the open playlist in the middle (Session 26b).
  await part(win, 'playlist-up-down', [win.getByTestId('column-left'), win.getByTestId('centre-playlist')]);
  await app.close();
});

test('the open playlist in the middle, its items as cards of every kind (Session 26b)', async () => {
  // The stand-in saves a .pptx as PDF, as PowerPoint would (CI's runners have no PowerPoint).
  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1600, height: 900 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-cards-'));
  const words = join(dir, 'Placeholder Dhun.txt');
  writeFileSync(words, 'Placeholder dhun line one\nનમૂના ધૂન\n\nPlaceholder dhun line two\n');
  const deck = join(dir, 'Placeholder Katha.pptx');
  writeFileSync(
    deck,
    makeTestPptx([
      { color: '7C2D12', text: 'Placeholder katha', notes: '' },
      { color: '14532D', text: 'Placeholder katha, part two', notes: '' },
      { color: '1E3A8A', text: 'Placeholder katha, part three', notes: '' },
    ]),
  );
  const picture = await makeTestImage(win, join(dir, 'Placeholder darshan.png'), { color: '#1d4e89' });
  const clip = await makeTestVideo(win, join(dir, 'Placeholder opening video.webm'), {
    seconds: 2,
    width: 320,
    height: 180,
    hue: 200,
  });
  const tone = makeTestTone(join(dir, 'Placeholder arti tune.wav'), { seconds: 3, hz: 440 });
  const [wordsId, deckId, pictureId, clipId, toneId] = await importAndGetIds(win, [
    words,
    deck,
    picture,
    clip,
    tone,
  ]);
  await win.evaluate(
    async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder Ravi Sabha', null, false);
      const id = made.ok ? (made.ids[0] ?? '') : '';
      await d.playlists.addItems(id, null, [
        { kind: 'header', label: 'Welcome' },
        { kind: 'media', mediaId: ids.clipId },
        { kind: 'presentation', presentationId: ids.wordsId },
        { kind: 'header', label: 'Katha' },
        { kind: 'presentation', presentationId: ids.deckId },
        { kind: 'media', mediaId: ids.pictureId },
        { kind: 'media', mediaId: ids.toneId },
      ]);
      await d.playlists.create('Placeholder Youth Sabha', null, false);
    },
    {
      wordsId: wordsId ?? '',
      deckId: deckId ?? '',
      pictureId: pictureId ?? '',
      clipId: clipId ?? '',
      toneId: toneId ?? '',
    },
  );
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Ravi Sabha' }).click();
  await win.getByTestId('playlist-item').filter({ hasText: 'Placeholder Katha' }).click();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(3);
  // The playlist as tall as it goes, so every card shows.
  await win.getByRole('separator', { name: 'Resize the playlist and the slides' }).press('End');
  await win.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await part(win, 'playlist-cards', [win.getByTestId('centre-playlist')]);
  await shot(win, 'operator-playlist-1600x900');
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
  await operatorReady(win);
  await showExtras(win);
  await win.setViewportSize({ width: 1600, height: 900 });
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Sample kirtan/ })
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
  // A line was emptied: closing asks first (Session 25).
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await win.getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' }).click();

  // Screens: two groups, each with its own languages; and an output showing them.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    for (const [name, i, langs] of [
      ['Hall', 0, ['gu', 'translit']],
      ['Lobby', 1, ['translit', 'en']],
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
  // The groups' own settings, below the three cards (Session 26).
  await win
    .getByTestId('screen-group')
    .first()
    .evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
    });
  await shot(win, 'screens-languages');
  await win.getByRole('button', { name: 'Close screens' }).click();
  await shot(win, 'operator-kirtan-languages');

  // Templates, a playlist made from one, and filling a slot: in the playlists' column, under the library's
  // sheet (Session 44), shut first.
  await closeLibrary(win);
  await win.getByTestId('playlist-view-tab-templates').click();
  await shot(win, 'templates');
  await win.getByRole('button', { name: 'New playlist from Example: Ravi Sabha' }).click();
  await win.getByRole('textbox', { name: 'Playlist name' }).press('Enter');
  await win.getByTestId('playlist-item').nth(1).click();
  await expect(win.getByTestId('fill-slot')).toBeVisible();
  await shot(win, 'fill-slot');
  await win.getByTestId('fill-slot').getByRole('button', { name: 'Cancel' }).click();

  // The setup wizard's screens step: where it opens (Session 44).
  await chooseMenuItem(app, 'set-up-screens');
  await expect(win.getByTestId('setup-wizard').getByTestId('setup-step')).toHaveText('Screens');
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
    await letTimePass(win, 3000, 'the docs’ picture: the preview shows the camera');
    await shot(win, 'stream-panel');
    await mkdirAndShot(program, 'stream-program-camera');
    await win.getByTestId('stream-layout-slides').click();
    await letTimePass(win, 1000, 'the docs’ picture: the preview shows the slides');
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
  await letTimePass(page, 700, 'the docs’ picture: the stream’s page settles');
  await page.screenshot({ path: join(folder, `${name}.png`), scale: 'css', animations: 'disabled' });
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
  await openLibrary(win);
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

test('Looks, stage layouts, masks, key and fill, MIDI and the slide editor (Session 11)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '3',
    ...NETWORK_ENV,
  });
  const win = await operatorPage(app);
  await openMoreTools(win);
  await operatorReady(win);
  await win.setViewportSize({ width: 1600, height: 900 });
  await running(win);
  // A hall, a stage, and a key and fill pair; a second Look with the hall's words as a lower third over
  // its background; a mask and a stage layout.
  await win.evaluate(async () => {
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
    await d.engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: two minutes' });
    // A coloured background, so the hall's mask shows (what it hides is black).
    await d.engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#1f3a5f' } });
  });
  // The right column from its top: the Looks, and More tools (its file keeps its name from Session 11).
  await win.getByTestId('looks-panel').evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  await shot(win, 'operator-looks-macros-masks');

  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  await expect(win.getByTestId('looks-section')).toBeVisible();
  // The Looks, below the three cards and the displays (Session 26).
  await win.getByTestId('looks-section').evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
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
  await win.getByTestId('more-tools').getByTestId('open-midi').click();
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

  // The phone remote's More tab: the Looks.
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, code, '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await phone.page.getByTestId('remote-tab-more').click();
    await expect(phone.page.getByTestId('remote-tab-more')).toHaveAttribute('aria-selected', 'true');
    await shot(phone.page, 'phone-remote-more');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('Shastra, timers in the running order, Samvat and tithi, and the idle rotation (Session 12)', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await openMoreTools(win);
  await operatorReady(win);
  await showExtras(win);
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
  await openLibrary(win);
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
  await letTimePass(hall, 500, 'the docs’ picture: the first picture has faded in');
  await shot(hall, 'output-idle-picture');
  await expect(hall.locator('[data-layer="idle"][data-idle-index="3"]')).toBeVisible({ timeout: 20_000 });
  await expect(hall.locator(`[data-idle-item="${quoteId}"]`).first()).toBeVisible();
  await letTimePass(hall, 500, 'the docs’ picture: the quote has faded in');
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

test('music, markers, scheduled backups, and Simple Mode with music (Session 14)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await openMoreTools(win);
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
  await openLibrary(win);
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

  // Simple Mode with the music (roles and their PINs, pictured here until Session 54, are gone: E5).
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-music')).toContainText('Placeholder before sabha');
  await shot(win, 'simple-mode-music');
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
  await openLibrary(win);
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
  await letTimePass(win, 500, 'the docs’ picture: the status bar settles');
  await barAndStatus(win, 'import-problem-status');
  await win.getByTestId('slide-thumb').nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 3');
  await shot(win, 'pictures-slides');
  await shot(output, 'output-pictures-page');
  await app.close();
});

test('Import from a Link: each state of the dialog, the status bar and the report (Session 25b)', async () => {
  test.setTimeout(300_000);
  const ffmpeg = testFfmpeg();
  test.skip(!ffmpeg, 'FFmpeg is not fetched here');
  const work = mkdtempSync(join(tmpdir(), 'drashti-shots-link-'));
  const video = join(work, 'big.mp4');
  const made = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=3840x2160:r=25',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    video,
  ]);
  expect(made.status, made.stderr.toString()).toBe(0);
  const zip = makeZip([
    {
      name: 'Placeholder deck.pptx',
      data: makeTestPptx([{ color: '1E3A8A', text: 'Placeholder slide', notes: 'Placeholder note' }]),
    },
    { name: 'Videos/Placeholder 2160p.mp4', data: readFileSync(video) },
    { name: 'Read me.txt', data: 'placeholder words' },
  ]);
  const standIn = await dropboxStandIn(
    {},
    { shotAAAAAAAAAAA: { name: 'Placeholder sabha folder.zip', body: zip, type: 'application/zip' } },
  );
  try {
    const chosen = join(work, 'Sabha downloads');
    const { app } = await launchApp({
      DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
      DRASHTI_TEST_ON_AIR_HOOK: '1',
      DRASHTI_TEST_NO_CONVERTER: '1',
    });
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1280, height: 720 });
    await operatorReady(win);
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
      shell.showItemInFolder = () => undefined;
    }, chosen);
    await chooseMenuItem(app, 'import-from-link');
    const dialog = win.getByTestId('link-dialog');
    await expect(dialog).toBeVisible();
    await shot(win, 'import-link-kind');
    await win.getByTestId('link-kind-dropbox').click();
    await win.getByTestId('link-text').fill('https://example.net/placeholder/clip.mp4');
    await expect(dialog).toContainText('not a Dropbox link');
    await shot(win, 'import-link-refused');
    await win.getByTestId('link-text').fill(folderLink('shotAAAAAAAAAAA'));
    await expect(win.getByTestId('link-name')).toHaveText('Placeholder sabha folder');
    await win.getByTestId('link-choose-folder').click();
    await expect(win.getByTestId('link-folder')).toHaveText(chosen);
    await shot(win, 'import-link-dropbox');
    // On air: it waits, and the status bar shows it.
    await app.evaluate(() => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
    });
    await win.getByTestId('link-download').click();
    await expect(win.getByTestId('link-going')).toHaveAttribute('data-phase', 'waiting');
    await shot(win, 'import-link-waiting');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(win.getByTestId('link-status')).toBeVisible();
    await letTimePass(win, 500, 'the docs’ picture: the status bar settles');
    await barAndStatus(win, 'import-link-status');
    await win.getByTestId('link-status').click();
    await app.evaluate(() => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
    });
    // Saved, a video made 1080p, the .txt not taken; then the report says where they were saved (with the
    // dialog open, the report waits for See the import report).
    const report = win.getByTestId('import-report');
    await win.getByTestId('link-open-report').click({ timeout: 180_000 });
    await expect(report).toBeVisible();
    await expect(report.getByTestId('report-saved-in')).toBeVisible();
    await shot(win, 'import-link-report');
    await report.getByRole('button', { name: 'Close', exact: true }).first().click();
    await chooseMenuItem(app, 'import-from-link');
    await expect(win.getByTestId('link-fitted-item')).toBeVisible();
    await expect(win.getByTestId('link-not-taken-item')).toBeVisible();
    await shot(win, 'import-link-saved');
    await app.close();
  } finally {
    await standIn.close();
  }
});

test('Import from a Link, YouTube: the choices, the tick, downloading and a refusal (Session 25c)', async () => {
  test.setTimeout(300_000);
  test.skip(!testFfmpeg(), 'FFmpeg is not fetched here');
  const work = mkdtempSync(join(tmpdir(), 'drashti-shots-youtube-'));
  const chosen = join(work, 'Sabha downloads');
  const fake = join(__dirname, 'fake-yt-dlp.cjs');
  const link = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';
  const launch = async (config: Record<string, unknown>) => {
    const { app } = await launchApp({
      DRASHTI_TEST_FAKE_YT_DLP: fake,
      DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
        title: 'Placeholder sabha video',
        duration: 3725,
        ...config,
      }),
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    });
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1280, height: 720 });
    await operatorReady(win);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, chosen);
    await chooseMenuItem(app, 'import-from-link');
    await win.getByTestId('link-kind-youtube').click();
    return { app, win };
  };
  // The choices: MP4 at the qualities the video offers, those above the admin's 1080p not to be picked.
  const first = await launch({ steps: 400, stepMs: 200 });
  await first.win.getByTestId('link-text').fill(link);
  await expect(first.win.getByTestId('link-name')).toHaveText('Placeholder sabha video', { timeout: 60_000 });
  await first.win.getByTestId('link-choose-folder').click();
  await expect(first.win.getByTestId('link-folder')).toHaveText(chosen);
  await shot(first.win, 'import-link-youtube');
  // The tick, and Download wakes; then downloading.
  await first.win.getByTestId('link-permission').check();
  await expect(first.win.getByTestId('link-download')).toBeEnabled();
  await shot(first.win, 'import-link-youtube-ticked');
  await first.win.getByTestId('link-download').click();
  await expect(first.win.getByTestId('link-going-words')).toContainText('Downloading the MP4, 1080p', {
    timeout: 60_000,
  });
  await letTimePass(first.win, 1500, 'the docs’ picture: the download has made some progress');
  await shot(first.win, 'import-link-youtube-going');
  await first.win.getByTestId('link-stop').click();
  // MP3: the best sound, no quality to choose.
  await expect(first.win.getByTestId('link-message')).toContainText('Stopped. Nothing was kept.');
  await first.win.getByTestId('link-type-mp3').click();
  await expect(first.win.getByTestId('link-mp3-words')).toBeVisible();
  await shot(first.win, 'import-link-youtube-mp3');
  // The admin's setting at 2160p (4K): 2160p can be picked, 4320p (8K) still cannot.
  await first.win.getByTestId('link-type-mp4').click();
  await first.win.getByTestId('link-max-height').selectOption('2160');
  await expect(first.win.getByTestId('link-quality-2160')).toBeEnabled();
  await first.win.getByTestId('link-quality-2160').click();
  await shot(first.win, 'import-link-youtube-2160');
  await first.app.close();
  // A video that needs signing in: plain words, and the YouTube Studio way.
  const refused = await launch({
    failWith: 'ERROR: [youtube] AAAAAAAAAAA: Private video. Sign in if you have been granted access',
  });
  await refused.win.getByTestId('link-text').fill(link);
  await expect(refused.win.getByTestId('link-dialog')).toContainText('Drashti never signs in to YouTube', {
    timeout: 60_000,
  });
  await shot(refused.win, 'import-link-youtube-refused');
  await refused.app.close();
});

test('this session’s playlists: a Dropbox folder as one playlist a folder at a time, a smart playlist, and Repeat Slides going round (Session 26c–d)', async () => {
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-shots-26-'));
  const media = join(work, 'made');
  mkdirSync(media);
  const ffmpeg = testFfmpeg();
  const video = (name: string, size: string): Buffer => {
    const path = join(media, name);
    const r = spawnSync(ffmpeg ?? '', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=s=${size}:r=25`,
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
    return readFileSync(path);
  };
  const deck = (text: string, color: string) => makeTestPptx([{ color, text, notes: '' }]);
  const folders: Record<string, { name: string; body: Buffer; type: string }> = {};
  const standIn = await dropboxStandIn({}, folders);
  try {
    const { app } = await launchApp({
      DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
      DRASHTI_TEST_DECK_CONVERTER: '1',
      DRASHTI_TEST_SMART_SCAN_MS: '1000',
      DRASHTI_TEST_SMART_SETTLE_MS: '500',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.setViewportSize({ width: 1280, height: 720 });
    const { makeDropboxLikeZip } = await import('../../src/main/import/testing/zip-writer');
    folders['foldSHOTSSHOTSSS'] = {
      name: 'Placeholder Sabha folder.zip',
      type: 'application/zip',
      body: makeDropboxLikeZip([
        { path: 'Opening video.mp4', data: video('a.mp4', '320x180') },
        { path: 'Welcome.pptx', data: deck('Placeholder welcome', '1E3A8A') },
        { path: 'Week 1/Katha 2.pptx', data: deck('Placeholder katha two', '7C2D12') },
        { path: 'Week 1/Katha 10.pptx', data: deck('Placeholder katha ten', '14532D') },
        { path: 'Week 1/Videos/Clip A.mp4', data: video('b.mp4', '352x198') },
      ]),
    };
    await app.evaluate(
      ({ dialog }, folder) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
      },
      join(work, 'Chosen'),
    );
    await chooseMenuItem(app, 'import-from-link');
    await win.getByTestId('link-kind-dropbox').click();
    await win.getByTestId('link-text').fill(folderLink('foldSHOTSSHOTSSS'));
    await expect(win.getByTestId('link-holds')).toContainText('A folder');
    await win.getByTestId('link-choose-folder').click();
    await win.getByTestId('link-download').click();
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-title')).toHaveText(
      'Placeholder Sabha folder',
      { timeout: 180_000 },
    );
    await win.keyboard.press('Escape');
    // A folder at a time (Session 44): the top folder's own two items in the middle and Week 1 at the bottom
    // left; then Week 1, chosen there: its own two decks, its Videos folder below, the way back up above them.
    const items = win.getByTestId('open-playlist').getByTestId('playlist-item');
    const folderRows = win.getByTestId('playlist-folders').getByTestId('playlist-folder');
    await expect(items).toHaveCount(2, { timeout: 60_000 });
    await folderRows.filter({ hasText: 'Week 1' }).click();
    await expect(win.getByTestId('playlist-items')).toHaveAttribute('data-folder', 'Week 1');
    await expect(items).toHaveCount(2, { timeout: 60_000 });
    await expect(folderRows).toHaveCount(1, { timeout: 60_000 });
    await expect(folderRows).toHaveAttribute('data-path', 'Week 1 › Videos');
    // Its first deck chosen, as an operator would: its slide in the grid below.
    await items.first().click();
    await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toContainText('Katha 2');
    await part(win, 'dropbox-playlist', [win.getByTestId('column-left'), win.getByTestId('centre-playlist')]);

    // A smart playlist following a folder of placeholder pictures.
    const smart = join(work, 'Placeholder Lobby folder');
    mkdirSync(join(smart, 'Morning'), { recursive: true });
    await makeTestImage(win, join(smart, 'Placeholder welcome.png'), { color: '#1d4e89' });
    await makeTestImage(win, join(smart, 'Morning', 'Placeholder darshan.png'), { color: '#7c2d12' });
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, smart);
    await win.getByRole('button', { name: 'New playlist or folder' }).click();
    await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
    // Its top folder's own picture in the middle, the Morning folder at the bottom left.
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-title')).toHaveText(
      'Placeholder Lobby folder',
    );
    await expect(items).toHaveCount(1, { timeout: 60_000 });
    await expect(folderRows).toHaveCount(1, { timeout: 60_000 });
    await expect(folderRows).toHaveAttribute('data-path', 'Morning');
    // One click on it puts it up too (Session 54): its card LIVE, as an operator's click leaves it.
    await items.first().click();
    await expect(win.getByTestId('item-view')).toContainText('Placeholder welcome');
    await expect(items.first()).toHaveAttribute('data-live', 'true');
    await part(win, 'smart-playlist', [win.getByTestId('column-left'), win.getByTestId('centre-playlist')]);

    // Repeat Slides going round: LIVE says so, with Stop (Esc).
    await win.getByRole('button', { name: 'New playlist or folder' }).click();
    await win.getByRole('menuitem', { name: 'Repeat Slides' }).click();
    await win.getByRole('textbox', { name: 'Playlist name' }).fill('Placeholder Lobby pictures');
    await win.keyboard.press('Enter');
    const repeatId =
      (await win
        .getByTestId('playlist-node')
        .filter({ hasText: 'Placeholder Lobby pictures' })
        .getAttribute('data-node-id')) ?? '';
    await win.evaluate(async (id) => {
      const d = (globalThis as PageGlobals).drashti;
      const pictures = (await d.library.listMedia()).filter((m) => m.kind === 'image');
      await d.playlists.addItems(
        id,
        null,
        pictures.map((m) => ({ kind: 'media' as const, mediaId: m.id })),
      );
    }, repeatId);
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Lobby pictures' }).click();
    await win.getByTestId('repeat-start').click();
    await expect(win.getByTestId('live-repeating')).toBeVisible();
    // Its card chosen: the slide grid shows every step.
    await win.getByTestId('open-playlist').getByTestId('playlist-item').first().click();
    await expect(win.getByTestId('repeat-note')).toBeVisible();
    await shot(win, 'repeat-slides-1280x720');
    await part(win, 'repeat-slides-live', [
      win.getByTestId('live-repeating'),
      win.getByTestId('live-preview'),
    ]);
    await win.getByTestId('live-repeat-stop').click();
    await app.close();
  } finally {
    await standIn.close();
  }
});

test('this session’s videos and pictures: the timeline with Save as MP4, the Picture editor, and the live zoom (Session 26e)', async () => {
  test.setTimeout(240_000);
  const ffmpeg = testFfmpeg();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-shots-26e-'));
  const clip = join(dir, 'Placeholder Katha video.mp4');
  const made = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=640x360:r=25',
    '-t',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '50',
    '-pix_fmt',
    'yuv420p',
    clip,
  ]);
  if (made.status !== 0) throw new Error(made.stderr.toString());
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  // A generated picture with something in it to zoom into: FFmpeg's test pattern, one frame.
  const picture = join(dir, 'Placeholder darshan.png');
  const still = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1280x720',
    '-frames:v',
    '1',
    picture,
  ]);
  if (still.status !== 0) throw new Error(still.stderr.toString());
  const [, pictureId = ''] = await importAndGetIds(win, [clip, picture]);
  await openLibrary(win);
  await win.getByRole('tab', { name: 'Media' }).click();
  await win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder Katha video' })
    .getByTestId('media-markers')
    .click();
  const markers = win.getByTestId('markers-dialog');
  await expect(markers.getByTestId('timeline').locator('img[data-still]')).toHaveCount(10, {
    timeout: 60_000,
  });
  await markers.getByTestId('markers-start').fill('0:07.4');
  await markers.getByTestId('markers-end').fill('0:22.0');
  await win.setViewportSize({ width: 1280, height: 1150 });
  await expect(markers.getByTestId('markers-keyframe')).toContainText('the nearest clean frame', {
    timeout: 20_000,
  });
  await markers.getByTestId('markers-keyframe').scrollIntoViewIfNeeded();
  await shot(win, 'video-timeline');
  await win.setViewportSize({ width: 1280, height: 720 });
  // Closing asks about the changed start and end first: they are thrown away.
  await win.keyboard.press('Escape');
  await win.getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' }).click();
  await expect(markers).toHaveCount(0);
  await win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder darshan' })
    .getByTestId('media-picture')
    .click();
  const editor = win.getByTestId('picture-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('pe-zoom').evaluate((el) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '160');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await editor.getByTestId('pe-auto').click();
  await shot(win, 'picture-editor');
  await editor.getByTestId('pe-save').click();
  // The live zoom, under LIVE.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'image', fit: 'fit', loop: false },
      }),
    pictureId,
  );
  await win.getByTestId('live-zoom-in').click();
  await expect(win.getByTestId('live-zoom-keep')).toBeVisible();
  await part(win, 'live-zoom', [win.getByTestId('live-preview'), win.getByTestId('live-zoom')]);
  await app.close();
});

test('Screens with its three cards: the projector, the stage screen and YouTube (Session 26 step 13)', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Placeholder hall', 0);
  await setUpScreen(win, 'Placeholder stage', 1);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const stage = (await d.screens.get()).groups.find((g) => g.name === 'Placeholder stage');
    if (stage) await d.screens.setGroupRole(stage.id, 'stage');
    const kirtan = (await d.library.listPresentations()).find((p) => p.name.startsWith('Sample kirtan'));
    if (kirtan) await d.engine.dispatch({ type: 'goLive', presentationId: kirtan.id, slideIndex: 0 });
  });
  await win.setViewportSize({ width: 1440, height: 1500 });
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const cards = win.getByTestId('screens-cards');
  await expect(cards.getByTestId('screens-card-stage').getByTestId('card-shows')).toBeVisible();
  await expect(cards.getByTestId('youtube-preview')).toHaveAttribute('data-kind', 'still');
  await part(win, 'screens-cards', [cards]);
  await win.setViewportSize({ width: 1280, height: 720 });
  await shot(win, 'screens-cards-1280x720');
  await app.close();
});

test('every built-in theme, and the Themes window with them (Session 26 step 14)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  const panel = win.getByTestId('themes-panel');
  const items = panel.getByTestId('theme-item');
  await expect(items).toHaveCount(BUILTIN_THEMES.length + 1);
  await items.filter({ hasText: 'Midnight' }).click();
  await shot(win, 'themes-builtin');
  for (const { key, fields } of BUILTIN_THEMES) {
    await items.filter({ hasText: fields.name }).first().click();
    await expect(panel.getByRole('textbox', { name: 'Theme name' })).toHaveValue(fields.name);
    await part(win, `theme-${key}`, [panel.getByTestId('theme-editor-preview')]);
  }
  await app.close();
});

test('a stopped screen’s notice at the top of the window (Session 26h)', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_GIVE_UP: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const screenId = await setUpScreen(win, 'Placeholder hall', 0);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });
  // As a screen that kept failing does: given up on, until Try again.
  await app.evaluate((_electron, id) => {
    (globalThis as unknown as { drashtiTestGiveUp?: (screenId: string) => void }).drashtiTestGiveUp?.(id);
  }, screenId);
  await expect(win.getByTestId('screen-stopped-notice')).toBeVisible();
  await shot(win, 'screen-stopped-notice');
  await app.close();
});

/*
 * Lower Thirds (Session 44, in Macros' place), for the operator's guide (Session 45): the panel open under More
 * tools with a placeholder lower third up over the kirtan (its button says Hide, and LIVE shows it), and its
 * editor in front, finding an animation by its words, the chosen one held in the small picture.
 */
test('Lower Thirds: the panel with one up, and its editor finding an animation (Session 44)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1920, height: 1080 });
  await operatorReady(win);
  await setUpPlaceholderShow(win);
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
  await win.getByTestId('slide-thumb').nth(1).click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  await win.evaluate(async (look) => {
    const made = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, {
      lines: ['Placeholder speaker', 'Placeholder title', 'Placeholder place'],
      look,
      where: 'both',
      animation: 'slide-left-steady',
    });
    if (!made.ok) throw new Error(made.message);
  }, DEFAULT_LOWER_THIRD_LOOK);
  await openMoreTools(win);
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  const row = panel.getByTestId('lower-third-row').filter({ hasText: 'Placeholder speaker' });
  await row.getByTestId('lower-third-show').click();
  await expect(row).toHaveAttribute('data-up', 'true');
  await expect(row.getByTestId('lower-third-show')).toHaveText('Hide');
  await expect(win.getByTestId('live-preview').getByTestId('lower-third-layer')).toHaveAttribute(
    'data-lt-phase',
    'still',
  );
  await row.getByTestId('lower-third-edit').click();
  const editor = win.getByTestId('lower-third-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('lower-third-search').fill('slide');
  await expect(editor.getByTestId('lower-third-animation').first()).toBeVisible();
  await expect(editor.getByTestId('lower-third-animation-chosen')).toHaveText('Slide in from left');
  await letTimePass(win, 700, 'the docs’ picture: the editor and the live picture settle');
  // The small picture plays it in, holds it 1.2 s, then takes it out: the picture is taken while it is held.
  const preview = editor.getByTestId('lower-third-preview').getByTestId('lower-third-layer');
  await editor.getByRole('button', { name: 'Play again' }).click();
  await expect(preview).toHaveAttribute('data-lt-phase', 'still');
  await win.screenshot({ path: join(folder, 'lower-thirds.png'), scale: 'css', animations: 'disabled' });
  await expect(preview, 'still held when the picture was taken').toHaveAttribute('data-lt-phase', 'still', {
    timeout: 1,
  });
  await app.close();
});

test('Zoom, both ways: the window for Zoom with the stream’s picture, and Show a Window… with a placeholder (Session 48)', async () => {
  test.setTimeout(120_000);
  // Chromium's fake camera; a window this test opens, titled "Placeholder meeting", stands in for a meeting's.
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1', DRASHTI_TEST_WINDOW_STANDIN: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  await running(win);

  // The window for Zoom: the stream's picture (the camera with the verse's words as a lower third), nothing else.
  await chooseMenuItem(app, 'zoom-window');
  const isZoom = (p: Page) => p.url().includes('zoom.html');
  const zoom = app.windows().find(isZoom) ?? (await app.waitForEvent('window', { predicate: isZoom }));
  await expect(zoom.getByTestId('zoom-picture')).toHaveAttribute('data-program', '1920x1080', {
    timeout: 30_000,
  });
  await expect
    .poll(() => zoom.evaluate(() => document.querySelector('video')?.videoWidth ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
  // The stream's camera: Chromium's fake one (a moving test pattern), seen once the stream's page is open.
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status())).inputs.cameras.length,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const camera = (await d.stream.status()).inputs.cameras[0] ?? null;
    await d.stream.setInputs(camera, null);
  });
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status())).inputs.camera,
      {
        timeout: 30_000,
      },
    )
    .toBe('on');
  await letTimePass(zoom, 2000, 'the docs’ picture: the camera and the lower third settle');
  await mkdirAndShot(zoom, 'zoom-window');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('zoom.html'))
      ?.close();
  });

  // Show a Window…: the placeholder meeting offered, by name with its small picture, and chosen.
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      title: 'Placeholder meeting',
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Placeholder meeting</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#1d4ed8}#bar{position:absolute;top:35%;left:30%;width:20%;height:30%;background:#facc15}p{position:absolute;left:4%;bottom:4%;margin:0;font:32px sans-serif;color:#ffffff}</style></head><body><div id="bar"></div><p>Placeholder meeting</p></body></html>`;
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.showInactive();
  });
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  await win.getByTestId('show-a-window').click();
  const picker = win.getByTestId('window-picker');
  const choice = picker.getByTestId('window-choice').filter({ hasText: 'Placeholder meeting' });
  await expect(choice.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/u, {
    timeout: 15_000,
  });
  await choice.click();
  await expect(picker.getByTestId('window-show')).toBeEnabled();
  await shot(win, 'window-picker');
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await app.close();
});
