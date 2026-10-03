import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Playlist, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { chooseMenuItem, importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Help > Save diagnostics writes one file an operator can send: versions,
 * the setup, counts and the log, and no library content at all.
 */

test('the diagnostics file holds the setup and the log, and no library text', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const desktop = mkdtempSync(join(tmpdir(), 'drashti-desktop-'));
  await app.evaluate(({ app: electronApp }, dir) => {
    electronApp.setPath('desktop', dir);
  }, desktop);

  // Library content that must not appear: names, slide words, where the files came from.
  const source = mkdtempSync(join(tmpdir(), 'drashti-diagnostics-source-'));
  const secretName = 'Placeholder Confidential Hymn';
  const secretWords = 'Placeholder unique slide words 7731';
  const song = join(source, `${secretName}.pro6`);
  writeFileSync(
    song,
    pp6Presentation({
      uuid: 'E2E-DIAG',
      groups: [
        {
          name: 'Placeholder Private Group',
          slides: [{ text: [{ rtf: cocoaRtf([[secretWords, 72, [255, 255, 255]]]) }] }],
        },
      ],
    }),
  );
  const list = join(source, 'Default.pro6pl');
  writeFileSync(
    list,
    pp6Playlist([{ name: 'Placeholder Private Playlist', entries: [{ document: song, name: secretName }] }]),
  );
  const broken = join(source, 'Placeholder Broken File.pro6');
  writeFileSync(broken, 'not a presentation');
  await importAndGetIds(win, [song, list, broken]);

  await operatorReady(win);
  await chooseMenuItem(app, 'save-diagnostics');
  await expect(win.getByRole('alert').filter({ hasText: 'Diagnostics saved on the Desktop' })).toBeVisible();
  const [file] = readdirSync(desktop);
  expect(file).toMatch(/^Drashti diagnostics \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.txt$/u);
  const text = readFileSync(join(desktop, file ?? ''), 'utf8');

  // What it holds.
  expect(text).toContain('== Drashti diagnostics ==');
  expect(text).toContain('Electron');
  expect(text).toContain('== Displays ==');
  expect(text).toContain('== Sound ==');
  expect(text).toMatch(/Presentations: \d+/u);
  expect(text).toContain('== Recent imports (counts and issue codes only) ==');
  expect(text).toContain('== Log ==');
  // What it never holds.
  for (const secret of [
    secretName,
    secretWords,
    'Placeholder Private Group',
    'Placeholder Private Playlist',
    'Placeholder Broken File',
    source,
    homedir(),
  ])
    expect(text, secret).not.toContain(secret);
  await app.close();
});
