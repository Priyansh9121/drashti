import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

test('Trim saves a new video in the same playlist row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-copy-'));
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const source = await makeTestVideo(win, join(dir, 'Placeholder clip.mp4'), {
      seconds: 6,
      fps: 25,
      h264: true,
    });
    const [mediaId = ''] = await importAndGetIds(win, [source]);
    const playlistName = 'Placeholder trim playlist';
    const rowId = await win.evaluate(
      async ({ mediaId, playlistName }) => {
        const d = (globalThis as PageGlobals).drashti;
        const made = await d.playlists.create(playlistName, null, false);
        if (!made.ok) throw new Error(made.message);
        const added = await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
        if (!added.ok) throw new Error(added.message);
        return added.ids[0] ?? '';
      },
      { mediaId, playlistName },
    );
    await win.getByTestId('playlist-node').filter({ hasText: playlistName }).click();
    const row = win.getByTestId('playlist-item').and(win.locator(`[data-item-id="${rowId}"]`));
    await row.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
    const dialog = win.getByTestId('markers-dialog');
    await dialog.getByTestId('markers-start').fill('0:01.4');
    await dialog.getByTestId('markers-end').fill('0:04.6');
    await dialog.getByTestId('markers-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText('Placeholder clip trimmed');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
