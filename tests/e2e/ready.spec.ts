import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Ready? (Session 55, Part 8, the owner's idea H): one press before the sabha checks the screens, the sound output, the
 * chosen video input, access, the open playlist's files, the charger, sleep and notifications. Each line is green or
 * amber, an amber one with what to do; it says what it can't check. A file taken from the disk after it was imported
 * is found missing (the disk is looked at, not only the library). At CI's 1024 × 645 and at 1280 × 720. Placeholder
 * files only, made here.
 */

const LINES = [
  'screens',
  'sound',
  'video-input',
  'access',
  'files',
  'charger',
  'sleep',
  'notifications',
] as const;

async function checkReady(win: Page): Promise<void> {
  const dialog = win.getByTestId('ready-dialog');
  if ((await dialog.count()) === 0) await win.getByTestId('open-ready').click();
  else await dialog.getByTestId('ready-again').click();
  await expect(dialog.getByTestId('ready-again')).toHaveText('Check again');
  await expect(dialog.getByTestId('ready-lines').getByRole('listitem')).toHaveCount(LINES.length);
}

/** Every line green or amber; an amber one says what to do, a green one doesn't. */
async function expectLinesSayWhatToDo(win: Page): Promise<void> {
  const dialog = win.getByTestId('ready-dialog');
  for (const id of LINES) {
    const line = dialog.getByTestId(`ready-${id}`);
    const colour = await line.getAttribute('data-ready');
    expect(colour, id).toMatch(/^(green|amber)$/u);
    await expect(line.getByTestId(`ready-${id}-said`), id).not.toBeEmpty();
    if (colour === 'amber') await expect(line.getByTestId(`ready-${id}-todo`), id).not.toBeEmpty();
    else await expect(line.getByTestId(`ready-${id}-todo`), id).toHaveCount(0);
  }
}

/** The dialog in the window, nothing cut off or scrolling sideways. */
async function expectFits(win: Page, what: string): Promise<void> {
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const panel = document.querySelector('[data-testid="ready-dialog"]');
    if (!panel) return ['no dialog'];
    const r = panel.getBoundingClientRect();
    if (
      r.left < -0.5 ||
      r.top < -0.5 ||
      r.right > window.innerWidth + 0.5 ||
      r.bottom > window.innerHeight + 0.5
    )
      out.push(`the dialog (${String(Math.round(r.width))} × ${String(Math.round(r.height))}) is cut off`);
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
    for (const b of panel.querySelectorAll('button'))
      if (b.scrollWidth > b.clientWidth + 1) out.push(`${b.textContent.trim()}: its words do not fit`);
    return out;
  });
  expect(problems, what).toEqual([]);
}

test('Ready? checks before the sabha: green or amber lines with what to do, a file gone from the disk named, at 1024 × 645 and 1280 × 720', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);

  // No playlist open: every line is there, and the files line says to open the sabha's playlist.
  await checkReady(win);
  const dialog = win.getByTestId('ready-dialog');
  await expectLinesSayWhatToDo(win);
  await expect(dialog.getByTestId('ready-files')).toHaveAttribute('data-ready', 'amber');
  await expect(dialog.getByTestId('ready-files-todo')).toContainText('Open the sabha’s playlist');
  // What it can't check, said under the lines; the sound line's Test sound (the Setup wizard's tone).
  await expect(dialog.getByTestId('ready-cannot-check')).toContainText('projector');
  await expect(dialog.getByTestId('ready-test-sound')).toBeVisible();
  // Drashti holds this computer awake only while a screen shows: none does here.
  await expect(dialog.getByTestId('ready-sleep')).toHaveAttribute('data-ready', 'amber');
  await expectFits(win, 'Ready? at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'Ready?', '[data-testid="ready-dialog"]');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);

  // A playlist of a picture and a video, open: every file is there.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-ready-'));
  const files = [
    await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { color: '#1e3a8a' }),
    await makeTestVideo(win, join(dir, 'Placeholder clip.webm'), { seconds: 1 }),
  ];
  const [pictureId = '', videoId = ''] = await importAndGetIds(win, files);
  await win.evaluate(
    async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create('Placeholder sabha', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'media', mediaId: ids.pictureId },
        { kind: 'media', mediaId: ids.videoId },
      ]);
      if (!added.ok) throw new Error(added.message);
    },
    { pictureId, videoId },
  );
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder sabha' }).click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(2);
  await checkReady(win);
  await expect(dialog.getByTestId('ready-files')).toHaveAttribute('data-ready', 'green');
  await expect(dialog.getByTestId('ready-files-said')).toContainText(
    'Every file in “Placeholder sabha” is there.',
  );

  // The video's own copy taken from the disk behind Drashti's back: Check again finds it, by name, with Find missing
  // media… to put it right.
  const mediaDir = join(userData, 'Media');
  // Kept by its sha256 in a folder of its first two letters (import/media-store.ts storedPath).
  const copies = readdirSync(mediaDir, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.webm'),
  );
  expect(copies).toHaveLength(1);
  rmSync(join(mediaDir, copies[0] ?? ''));
  await checkReady(win);
  await expect(dialog.getByTestId('ready-files')).toHaveAttribute('data-ready', 'amber');
  await expect(dialog.getByTestId('ready-files-said')).toContainText('Placeholder clip');
  await expect(dialog.getByTestId('ready-files-said')).not.toContainText('Placeholder backdrop');
  await expect(dialog.getByTestId('ready-find-missing')).toBeVisible();
  await expectLinesSayWhatToDo(win);
  await expectFits(win, 'Ready? at 1024 × 645, a file missing');

  // At 1280 × 720 too.
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await expectFits(win, 'Ready? at 1280 × 720');
  await app.close();
});
