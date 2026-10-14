import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink, type StandIn } from './dropbox-stand-in';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Session 26a step 6: the preview headed LIVE, with no Next under it (the
 * stage screen and the remote keep theirs); Edit layout… on the stage
 * screen's panel; and Add to playlist after any import: from the import
 * report, and chosen before Download in Import from a Link (a Dropbox file
 * link through the stand-in, and a YouTube download through the fake
 * yt-dlp). Placeholder files and made-up links only.
 */

const FAKE_YT_DLP = join(__dirname, 'fake-yt-dlp.cjs');
const YOUTUBE_LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

const labels = (win: Page) =>
  win
    .getByTestId('playlist-item')
    .evaluateAll((els) => els.map((e) => e.querySelector('[data-label]')?.textContent.trim() ?? ''));

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

  // A stage group whose layout, in the live Look, is a placeholder one.
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
    const looks = await d.looks.list();
    const look = looks.looks.find((l) => l.id === looks.liveId);
    if (saved.ok && look && group) await d.looks.setGroup(look.id, group.id, { stageLayoutId: saved.id });
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

test('the import report adds what an import made to the open playlist, another, or a new one named after it', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-add-'));
  const [sunday] = await playlists(win, ['Placeholder Sunday', 'Placeholder Youth']);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Sunday');

  // Two pictures, imported with the button: the report offers the open playlist first.
  const a = await makeTestImage(win, join(dir, 'Placeholder A.png'), { color: '#1e3a8a' });
  const b = await makeTestImage(win, join(dir, 'Placeholder B.png'), { color: '#7c2d12' });
  await app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files });
    },
    [a, b],
  );
  await win.getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible();
  const target = report.getByTestId('report-add-target');
  await expect(target).toHaveValue(`playlist:${sunday ?? ''}`);
  await expectNoSeriousA11yIssues(
    win,
    'the import report with Add to playlist',
    '[data-testid="import-report"]',
  );
  await report.getByTestId('report-add-button').click();
  await expect(report.getByTestId('report-added')).toContainText('Added to “Placeholder Sunday”');
  await expect.poll(() => labels(win)).toEqual(['Placeholder A.png', 'Placeholder B.png']);
  // Undo takes them out again.
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => labels(win)).toEqual([]);

  // Another import, into a new playlist named after the file.
  const c = await makeTestImage(win, join(dir, 'Placeholder Darshan.png'), { color: '#365314' });
  await app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: files });
    },
    [c],
  );
  await win.getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(report).toBeVisible();
  await report.getByTestId('report-add-target').selectOption('new');
  await report.getByTestId('report-add-button').click();
  await expect(report.getByTestId('report-added')).toContainText('Added to “Placeholder Darshan”');
  const tree = await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
  const made = tree.find((n) => n.name === 'Placeholder Darshan');
  expect(made?.itemCount).toBe(1);
  // The same picture again, into another playlist chosen from the list: "Placeholder Youth".
  await report.getByTestId('report-add-target').selectOption({ label: 'Placeholder Youth' });
  await report.getByTestId('report-add-button').click();
  await expect(report.getByTestId('report-added')).toContainText('Added to “Placeholder Youth”');
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
  const chosen = join(work, 'Chosen folder');
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
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  const [sunday] = await playlists(win, ['Placeholder Sunday']);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder Sunday');

  // Dropbox: "When it's imported, add it to:" says the open playlist before Download.
  await chooseMenuItem(app, 'import-from-link');
  const dialog = win.getByTestId('link-dialog');
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(fileLink('deckAAAAAAAAAAA', 'Placeholder katha.pptx'));
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder katha.pptx');
  await expect(win.getByTestId('link-add-to')).toHaveValue(`playlist:${sunday ?? ''}`);
  await expectNoSeriousA11yIssues(win, 'the link dialog with its playlist', '[data-testid="link-dialog"]');
  await win.getByTestId('link-choose-folder').click();
  await win.getByTestId('link-download').click();
  // Closed while it goes: it still lands in the playlist when the import ends.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => labels(win), { timeout: 120_000 }).toEqual(['Placeholder katha']);
  const report = win.getByTestId('import-report');
  if (await report.isVisible())
    await report.getByRole('button', { name: 'Close', exact: true }).first().click();

  // YouTube: the same, through the fake yt-dlp.
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-another').click();
  await win.getByTestId('link-kind-youtube').click();
  await win.getByTestId('link-text').fill(YOUTUBE_LINK);
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder video', { timeout: 60_000 });
  await expect(win.getByTestId('link-add-to')).toHaveValue(`playlist:${sunday ?? ''}`);
  await win.getByTestId('link-permission').check();
  await win.getByTestId('link-download').click();
  await expect
    .poll(() => labels(win), { timeout: 180_000 })
    .toEqual(['Placeholder katha', 'Placeholder video.mp4']);
  await app.close();
});
