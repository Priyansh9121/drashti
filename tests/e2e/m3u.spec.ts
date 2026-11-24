import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchApp, openSection, operatorPage, operatorReady } from './helpers';
import { makeTestImage, makeTestTone } from './test-media';

test('M3U imports local files in order, lists a web entry without fetching it, exports UTF-8 and imports into Audio', async () => {
  test.setTimeout(120_000);
  let fetched = 0;
  const server = createServer((_req, res) => {
    fetched++;
    res.end('Never fetch an M3U web entry');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local stand-in');
  const web = `http://127.0.0.1:${String(address.port)}/placeholder.wav`;
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-m3u-'));
    const one = makeTestTone(join(dir, 'Placeholder one.wav'), { seconds: 10, hz: 440 });
    const two = makeTestTone(join(dir, 'Placeholder two.wav'), { seconds: 20, hz: 330 });
    const three = await makeTestImage(win, join(dir, 'Placeholder three.png'));
    const list = join(dir, 'Placeholder list.m3u');
    writeFileSync(
      list,
      `\uFEFF#EXTM3U\r\n#EXTINF:10,Placeholder one\r\nPlaceholder one.wav\r\n${pathToFileURL(two).href}\r\n${three}\r\n${web}\r\n`,
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, list);
    await win.getByRole('button', { name: 'New playlist or folder' }).click();
    await win.getByRole('menuitem', { name: 'Import a Playlist File (M3U)…', exact: true }).click();
    await expect(win.getByTestId('m3u-not-taken')).toContainText(web);
    expect(fetched).toBe(0);
    await win.getByRole('button', { name: 'Close playlist file report', exact: true }).click();
    const panel = win.getByTestId('open-playlist');
    await expect(panel.getByTestId('playlist-title')).toHaveText('Placeholder list');
    await expect(panel.getByTestId('playlist-item').locator('[data-label]')).toHaveText([
      'Placeholder one',
      'Placeholder two.wav',
      'Placeholder three.png',
    ]);
    const output = join(dir, 'Placeholder exported.m3u8');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, output);
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Export as M3U…', exact: true }).click();
    await expect
      .poll(() => {
        try {
          return readFileSync(output, 'utf8');
        } catch {
          return '';
        }
      })
      .toContain('#EXTM3U\n#EXTINF:10,Placeholder one\n');
    const exported = readFileSync(output, 'utf8');
    expect(exported).toContain('#EXTINF:20,Placeholder two.wav\n');
    expect(exported).not.toContain(web);
    const paths = exported.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
    expect(paths).toHaveLength(3);
    expect(paths.every((file) => file.includes('Media') || file.includes('media'))).toBe(true);
    const audioList = join(dir, 'Placeholder audio.m3u8');
    writeFileSync(audioList, `#EXTM3U\n${one}\n${pathToFileURL(two).href}\n`);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, audioList);
    await openSection(win, 'audio');
    await win.getByTestId('audio-add').click();
    await win.getByRole('menuitem', { name: 'Import', exact: true }).click();
    await expect(win.getByTestId('music-playlist').filter({ hasText: 'Placeholder audio' })).toBeVisible();
    await expect(win.getByTestId('music-track')).toHaveCount(2);
    expect(fetched).toBe(0);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
