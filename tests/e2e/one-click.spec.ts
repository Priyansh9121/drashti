import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
} from './helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * One click puts it live (Session 54, F2; Priyansh: "1 click means its live. only the pdf/pptx open into the
 * middle"): in Pro Mode's open playlist, one click on a video, a picture or a sound puts it on the screens at
 * once, and Enter on its card does the same; a double click puts it up once and never starts it again;
 * Cmd/Ctrl-click and Shift-click only mark, right-click opens the card's menu, and a PDF and a deck open their
 * slides in the middle. Simple Mode keeps its Next. In CI's window, 1024 × 645. Placeholder files only, made here.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const VIDEO = 'Placeholder clip';
const PICTURE = 'Placeholder backdrop';
const SOUND = 'Placeholder tone';
const PDF = 'Placeholder notices';
const DECK = 'Placeholder katha';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** What is up from the playlist, as the engine has it: the item, the background's file and start, the sound's. */
async function up(win: Page) {
  const s = await state(win);
  const bg = s.layers.background;
  return {
    item: s.live.playlist?.itemId ?? null,
    background: bg?.kind === 'media' ? bg.mediaId : null,
    startedAt: bg?.kind === 'media' ? bg.startedAt : null,
    sound: s.layers.audio?.mediaId ?? null,
  };
}

interface Show {
  app: ElectronApplication;
  win: Page;
  /** The playlist's items, by name, and the files and presentations they play. */
  items: Record<string, string>;
  ids: Record<string, string>;
}

/** A playlist of a video, a picture, a sound, a PDF and a deck, open in CI's window. */
async function start(): Promise<Show> {
  // The stand-in saves a .pptx as PDF, as PowerPoint would (CI's computers have no PowerPoint).
  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-one-click-'));
  const pdf = join(dir, `${PDF}.pdf`);
  writeFileSync(
    pdf,
    makeTestPdf([
      { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder page one' },
      { width: 960, height: 540, color: [20, 83, 45], text: 'Placeholder page two' },
    ]),
  );
  const deck = join(dir, `${DECK}.pptx`);
  writeFileSync(
    deck,
    makeTestPptx([
      { color: '581C87', text: 'Placeholder slide one' },
      { color: '7C2D12', text: 'Placeholder slide two' },
    ]),
  );
  const files = [
    await makeTestVideo(win, join(dir, `${VIDEO}.webm`), { seconds: 4 }),
    await makeTestImage(win, join(dir, `${PICTURE}.png`), { color: '#1e3a8a' }),
    // Longer than the test, so it plays throughout.
    makeTestTone(join(dir, `${SOUND}.wav`), { seconds: 30 }),
    pdf,
    deck,
  ];
  const [video = '', picture = '', sound = '', pdfId = '', deckId = ''] = await importAndGetIds(win, files);
  expect(
    [video, picture, sound, pdfId, deckId].every((id) => id !== ''),
    'every file imported',
  ).toBe(true);
  const made = await win.evaluate(
    async (adding) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create('Placeholder one click', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'media', mediaId: adding.video },
        { kind: 'media', mediaId: adding.picture },
        { kind: 'media', mediaId: adding.sound },
        { kind: 'presentation', presentationId: adding.pdfId },
        { kind: 'presentation', presentationId: adding.deckId },
      ]);
      if (!added.ok) throw new Error(added.message);
      return added.ids;
    },
    { video, picture, sound, pdfId, deckId },
  );
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder one click' }).click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(5);
  const [videoItem = '', pictureItem = '', soundItem = '', pdfItem = '', deckItem = ''] = made;
  return {
    app,
    win,
    items: {
      [VIDEO]: videoItem,
      [PICTURE]: pictureItem,
      [SOUND]: soundItem,
      [PDF]: pdfItem,
      [DECK]: deckItem,
    },
    ids: { [VIDEO]: video, [PICTURE]: picture, [SOUND]: sound, [PDF]: pdfId, [DECK]: deckId },
  };
}

const card = (win: Page, name: string) =>
  win.getByTestId('open-playlist').getByTestId('playlist-item').filter({ hasText: name });

test('one click on a playlist’s video, picture or sound puts it up at once; a double click once, never from the start again; Enter the same', async () => {
  test.setTimeout(180_000);
  const { app, win, items, ids } = await start();
  expect((await up(win)).item).toBeNull();

  // One click on the video: up at once as the background, its card LIVE, and the middle shows it.
  await card(win, VIDEO).click();
  await expect.poll(async () => (await up(win)).item).toBe(items[VIDEO]);
  expect((await up(win)).background).toBe(ids[VIDEO]);
  await expect(card(win, VIDEO)).toHaveAttribute('data-live', 'true');
  await expect(win.getByTestId('item-media')).toHaveAttribute('aria-current', 'true');

  // A double click on it as it plays: it carries on, never from the start again.
  const playing = (await up(win)).startedAt;
  expect(playing).not.toBeNull();
  await letTimePass(win, 600, 'the video plays a moment before the double click');
  await card(win, VIDEO).dblclick();
  await holdStill(
    async () => {
      const now = await up(win);
      return now.item === items[VIDEO] && now.startedAt === playing;
    },
    1500,
    'a double click on the video up never puts it up again or starts it again',
  );

  // A double click on the picture: up once, in the video's place.
  await card(win, PICTURE).dblclick();
  await expect.poll(async () => (await up(win)).background).toBe(ids[PICTURE]);
  const shown = await up(win);
  expect(shown.item).toBe(items[PICTURE]);
  await holdStill(
    async () => (await up(win)).startedAt === shown.startedAt,
    1500,
    'the second click of the double click puts nothing up again',
  );

  // Enter on the sound's card: it plays, and the picture stays up.
  await card(win, SOUND).focus();
  await win.keyboard.press('Enter');
  await expect.poll(async () => (await up(win)).sound).toBe(ids[SOUND]);
  expect(await up(win)).toMatchObject({ item: items[SOUND], background: ids[PICTURE] });
  await expectNoSeriousA11yIssues(win, 'the open playlist, a sound and a picture put up with one click');
  const before = await up(win);
  const unchanged = async () => JSON.stringify(await up(win)) === JSON.stringify(before);

  // Cmd-click (Ctrl-click on Windows) and Shift-click only mark: nothing else goes up.
  await card(win, VIDEO).click({ modifiers: [mod] });
  await expect(card(win, VIDEO)).toHaveAttribute('data-marked', 'true');
  await card(win, PICTURE).click({ modifiers: ['Shift'] });
  await expect(card(win, PICTURE)).toHaveAttribute('data-marked', 'true');
  await expect(card(win, VIDEO)).toHaveAttribute('data-marked', 'true');
  await holdStill(unchanged, 1000, 'a Cmd/Ctrl-click and a Shift-click put nothing up');

  // Right-click opens the card's menu, putting nothing up.
  await card(win, VIDEO).click({ button: 'right' });
  await expect(win.getByRole('menuitem', { name: 'Start, end and markers…' })).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menuitem', { name: 'Start, end and markers…' })).toHaveCount(0);
  await holdStill(unchanged, 1000, 'a right-click puts nothing up');

  // A PDF and a deck open their slides in the middle, by a click and by Enter: nothing else goes up.
  await card(win, PDF).click();
  await expect(win.getByTestId('slide-grid')).toHaveAttribute('data-presentation-id', ids[PDF] ?? '');
  await card(win, DECK).focus();
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('slide-grid')).toHaveAttribute('data-presentation-id', ids[DECK] ?? '');
  await expect(win.getByTestId('slide-thumb')).toHaveCount(2);
  await holdStill(unchanged, 1000, 'a PDF and a deck open in the middle and put nothing up');
  await app.close();
});

test('Simple Mode keeps its Next: it starts the playlist and goes on through it, the video, then the picture', async () => {
  test.setTimeout(180_000);
  const { app, win, items } = await start();
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('simple-items').getByTestId('simple-item')).toHaveCount(5);
  await win.keyboard.press('ArrowRight');
  await expect.poll(async () => (await up(win)).item).toBe(items[VIDEO]);
  await win.keyboard.press('ArrowRight');
  await expect.poll(async () => (await up(win)).item).toBe(items[PICTURE]);
  await expectNoSeriousA11yIssues(win, 'Simple Mode, a picture up from the playlist');
  await app.close();
});
