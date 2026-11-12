import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink, type StandIn } from './dropbox-stand-in';
import { dropPaths } from './folder-drop';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  closeLibrary,
  dropFiles,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  setUpScreen,
} from './helpers';
import { pasteLink } from './paste-link';
import { makeTestImage } from './test-media';

/*
 * Session 26a step 6: the preview headed LIVE, with no Next under it (the
 * stage screen and the remote keep theirs); Edit layout… on the stage
 * screen's panel; and imports added to the open playlist, but for the
 * library's own drop place and Import…, which bring them into the library
 * only (Q57-11, the owner, 12 Nov 2026). Links use a Dropbox stand-in and a
 * fake yt-dlp. Placeholder files and made-up links only.
 */

const FAKE_YT_DLP = join(__dirname, 'fake-yt-dlp.cjs');
const YOUTUBE_LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

const labels = (win: Page) =>
  win
    .getByTestId('playlist-item')
    .evaluateAll((els) => els.map((e) => e.querySelector('[data-label]')?.textContent.trim() ?? ''));

/** The library's media and presentations, by name. */
const mediaNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listMedia()).map((item) => item.name),
  );
const presentationNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((item) => item.name),
  );

/** The open playlist's whole order, as kept (Session 44: the window shows it a folder at a time). */
const shown = (win: Page) =>
  win.evaluate(async () => {
    const open = document.querySelector('[data-testid="playlist-node"][data-open="true"]');
    const all = await (globalThis as PageGlobals).drashti.playlists.items(
      open?.getAttribute('data-node-id') ?? '',
    );
    return all.map((i) => (i.kind === 'header' ? `# ${i.label}` : i.label));
  });

async function playlists(win: Page, names: string[]): Promise<string[]> {
  return win.evaluate(async (list) => {
    const d = (globalThis as PageGlobals).drashti;
    const ids: string[] = [];
    for (const name of list) {
      const made = await d.playlists.create(name, null, false);
      ids.push(made.ok ? (made.ids[0] ?? '') : '');
    }
    return ids;
  }, names);
}

let standIn: StandIn | null = null;
test.afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

test('the preview is headed LIVE with no Next under it; Edit layout… opens the stage layout in use', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  await expect(win.locator('#live-preview-title')).toHaveText('LIVE');
  await expect(win.getByText('On the screens now', { exact: true })).toHaveCount(0);
  await expect(win.getByTestId('next-preview')).toHaveCount(0);
  await expect(win.getByTestId('live-preview')).toBeVisible();

  // A stage group, every stage screen showing a placeholder layout (Session 55: chosen for them all).
  await setUpScreen(win, 'Stage', 0);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.name === 'Stage');
    await d.screens.setGroupRole(group?.id ?? '', 'stage');
    const saved = await d.stageLayouts.save(null, {
      name: 'Placeholder band layout',
      background: '#000000',
      boxes: [],
    });
    if (saved.ok) await d.stageLayouts.choose(saved.id);
  });
  // Edit layout…, from the stage screen's panel: the editor at that layout.
  const panel = win.getByTestId('stage-message-control');
  await panel.getByTestId('stage-edit-layout').click();
  const editor = win.getByTestId('stage-layout-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('stage-layout-name')).toHaveValue('Placeholder band layout');
  await expectNoSeriousA11yIssues(win, 'the stage layout editor from the stage panel');
  await editor.getByRole('button', { name: 'Close stage layouts' }).click();
  await expect(editor).toHaveCount(0);
  await app.close();
});

test('the library’s Import › Files… and a drop on its list bring pictures into the library only, never the open playlist (Q57-11); dropped on the window they go into the open playlist too, with Undo for its rows', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-add-'));
  await playlists(win, ['Placeholder Sunday']);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Sunday');

  // Each its own colour: the library keeps one copy of the same picture.
  const a = await makeTestImage(win, join(dir, 'Placeholder A.png'), { color: '#1e3a8a' });
  const b = await makeTestImage(win, join(dir, 'Placeholder B.png'), { color: '#7c2d12' });
  const c = await makeTestImage(win, join(dir, 'Placeholder C.png'), { color: '#365314' });
  const d = await makeTestImage(win, join(dir, 'Placeholder D.png'), { color: '#581c87' });
  await app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files });
    },
    [a, b],
  );
  // The library's Import… › Files…, then a picture dropped on its list: each into the library.
  await openLibrary(win);
  await win.getByTestId('library-sheet').getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  await expect
    .poll(() => mediaNames(win))
    .toEqual(expect.arrayContaining(['Placeholder A.png', 'Placeholder B.png']));
  await dropFiles(win, win.getByTestId('library-drop'), [c]);
  await expect.poll(() => mediaNames(win)).toContain('Placeholder C.png');
  // A picture dropped on the window (on LIVE) goes into the open playlist too, and it alone: what came in through
  // the library never does.
  await dropFiles(win, win.getByTestId('live-preview'), [d], { overlay: false });
  await expect.poll(() => labels(win)).toEqual(['Placeholder D.png']);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await expect(win.getByTestId('import-result').getByRole('button', { name: 'Report' })).toHaveCount(0);
  await closeLibrary(win);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => labels(win)).toEqual([]);
  expect(await mediaNames(win)).toEqual(
    expect.arrayContaining(['Placeholder A.png', 'Placeholder B.png', 'Placeholder C.png', 'Placeholder D.png']),
  );
  await app.close();
});

test('a Dropbox file link, and a YouTube download, each land in the open playlist once imported', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-add-link-'));
  const deck = makeTestPptx([{ color: '581C87', text: 'Placeholder slide', notes: '' }]);
  standIn = await dropboxStandIn(
    {
      deckAAAAAAAAAAA: {
        name: 'Placeholder katha.pptx',
        body: deck,
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    },
    {},
  );
  writeFileSync(join(work, 'fake.log'), '');
  const { app } = await launchApp({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Videos'),
    // The stand-in saves the .pptx as PDF, as PowerPoint would (CI has no PowerPoint).
    DRASHTI_TEST_DECK_CONVERTER: '1',
    DRASHTI_TEST_FAKE_YT_DLP: FAKE_YT_DLP,
    DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
      log: join(work, 'fake.log'),
      title: 'Placeholder video',
      duration: 65,
    }),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  await playlists(win, ['Placeholder Sunday']);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Sunday');

  await chooseMenuItem(app, 'import-from-link');
  await expectNoSeriousA11yIssues(win, 'the link input', '[data-testid="link-paste"]');
  await pasteLink(win, fileLink('deckAAAAAAAAAAA', 'Placeholder katha.pptx'));
  await expect.poll(() => labels(win), { timeout: 120_000 }).toEqual(['Placeholder katha']);
  await expect(win.getByTestId('import-report')).toHaveCount(0);

  await chooseMenuItem(app, 'import-from-link');
  await pasteLink(win, YOUTUBE_LINK);
  await expect
    .poll(() => labels(win), { timeout: 180_000 })
    .toEqual(['Placeholder katha', 'Placeholder video.mp4']);
  await app.close();
});

test('a folder imported with the library’s Import › A Folder… comes into the library only, never the open playlist (Q57-11); a folder of lyrics dropped on the open playlist goes into it in its folders’ order, with headers (Session 26c)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  await playlists(win, ['Placeholder Sabha']);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sabha' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Sabha');
  const work = mkdtempSync(join(tmpdir(), 'drashti-add-folder-'));
  const root = join(work, 'Placeholder Sabha');
  for (const sub of ['', 'Week 2', 'Week 10/Deep']) mkdirSync(join(root, sub), { recursive: true });
  await makeTestImage(win, join(root, 'b cover.png'), { color: '#1e3a8a' });
  await makeTestImage(win, join(root, 'A cover.png'), { color: '#7c2d12' });
  await makeTestImage(win, join(root, 'Week 2', 'Darshan.png'), { color: '#365314' });
  await makeTestImage(win, join(root, 'Week 10', 'Deep', 'Late.png'), { color: '#581c87' });
  writeFileSync(join(root, 'Week 2', 'Placeholder words.txt'), 'Placeholder line one\n');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, root);
  await openLibrary(win);
  await win.getByTestId('library-sheet').getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'A Folder…' }).click();
  // Its pictures and its words, into the library.
  await expect
    .poll(() => mediaNames(win))
    .toEqual(expect.arrayContaining(['A cover.png', 'b cover.png', 'Darshan.png', 'Late.png']));
  await expect.poll(() => presentationNames(win)).toContain('Placeholder words');
  await closeLibrary(win);
  await expect(win.getByTestId('import-report')).toHaveCount(0);

  // A folder of only lyrics (no smart playlist follows lyrics) dropped on the open playlist goes into it, and it
  // alone: the folder imported through the library never does.
  const lyrics = join(work, 'Placeholder Lyrics');
  for (const sub of ['', 'Week 2', 'Week 10/Deep']) mkdirSync(join(lyrics, sub), { recursive: true });
  writeFileSync(join(lyrics, 'b verse.txt'), 'Placeholder verse b\n');
  writeFileSync(join(lyrics, 'A verse.txt'), 'Placeholder verse a\n');
  writeFileSync(join(lyrics, 'Week 2', 'Second week.txt'), 'Placeholder second week\n');
  writeFileSync(join(lyrics, 'Week 10', 'Deep', 'Late words.txt'), 'Placeholder late words\n');
  await dropPaths(win, win.getByTestId('open-playlist'), [lyrics]);
  // Folder by folder, depth first, A→Z with numbers in order (2 before 10), a header before each subfolder's part.
  await expect
    .poll(() => shown(win))
    .toEqual(['A verse', 'b verse', '# Week 2', 'Second week', '# Week 10 › Deep', 'Late words']);
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await app.close();
});
