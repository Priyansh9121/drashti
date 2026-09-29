import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Playlist, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import {
  importAndGetIds,
  killApp,
  launchApp,
  operatorPage,
  outputPage,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { makeTestImage } from './test-media';

/*
 * Running a sabha from a playlist: an arrangement with a repeated chorus,
 * headers stepped over, a picture item, crossing into the next item, the
 * next slide shown beside the live one and loaded ahead on the output, and
 * the place in the playlist kept through a restart.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

/** Two songs, a picture and a playlist naming them, all placeholders, written to a new folder. */
async function sabhaFiles(win: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-sabha-'));
  const welcome = await makeTestImage(win, join(dir, 'Placeholder Welcome.png'), { color: '#2e7d32' });
  const logo = await makeTestImage(win, join(dir, 'Placeholder Logo.png'), {
    width: 120,
    height: 60,
    color: '#c62828',
  });
  const sung = join(dir, 'Placeholder Sung Song.pro6');
  writeFileSync(
    sung,
    pp6Presentation({
      uuid: 'E2E-SUNG',
      groups: [
        { name: 'Verse 1', uuid: 'G-V1', slides: [line('Placeholder verse one')] },
        { name: 'Chorus', uuid: 'G-C', slides: [line('Placeholder chorus')] },
        { name: 'Verse 2', uuid: 'G-V2', slides: [line('Placeholder verse two')] },
      ],
      arrangements: [{ name: 'As sung', groups: ['G-V1', 'G-C', 'G-V2', 'G-C'] }],
      selectedArrangement: 0,
    }),
  );
  const second = join(dir, 'Placeholder Second Song.pro6');
  writeFileSync(
    second,
    pp6Presentation({
      uuid: 'E2E-SECOND',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              image: { path: logo, rect: [60, 60, 600, 300] },
              ...line('Placeholder second song, first line'),
            },
            line('Placeholder second song, second line'),
          ],
        },
      ],
    }),
  );
  const playlist = join(dir, 'Default.pro6pl');
  const where = '/Users/mandir/Documents/ProPresenter6';
  writeFileSync(
    playlist,
    pp6Playlist([
      {
        name: 'Sunday',
        entries: [
          { header: 'Opening' },
          { document: `${where}/Placeholder Sung Song.pro6`, name: 'Placeholder Sung Song' },
          { header: 'Placeholder Break' },
          { media: welcome, name: 'Placeholder Welcome' },
          { document: `${where}/Placeholder Second Song.pro6`, name: 'Placeholder Second Song' },
        ],
      },
    ]),
  );
  return { songs: [sung, second], playlist };
}

async function openSunday(win: Page) {
  const panel = win.getByTestId('playlists');
  await panel.getByTestId('playlist-node').filter({ hasText: 'Sunday' }).click();
  await expect(panel.getByTestId('playlist-title')).toHaveText('Sunday');
  return panel.getByTestId('playlist-item');
}

test('a sabha from a playlist: the repeated chorus, headers stepped over, a picture, on into the next song', async () => {
  // Media answers slowly, as from a slow disk: only what was loaded ahead can be ready in the first frame.
  const { app } = await launchApp({ DRASHTI_TEST_MEDIA_DELAY_MS: '400' });
  const win = await operatorPage(app);
  const files = await sabhaFiles(win);
  await importAndGetIds(win, files.songs);
  await importAndGetIds(win, [files.playlist]);
  await setUpScreen(win);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const items = await openSunday(win);
  await expect(items).toHaveCount(5);

  // Picking the song shows its slides in its arrangement: the chorus twice.
  await items.nth(1).click();
  const grid = win.getByTestId('slide-grid');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder Sung Song');
  expect(
    await grid.getByTestId('slide-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))),
  ).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);

  // Space starts it; Next plays it through, the chorus each time.
  const slideText = output.locator('[data-layer="slide"]');
  const liveText = win.getByTestId('live-text');
  const next = win.getByTestId('next-preview');
  await win.keyboard.press('Space');
  await expect(liveText).toContainText('slide 1 of 4');
  await expect(items.nth(1)).toHaveAttribute('data-live', 'true');
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await win.keyboard.press('ArrowRight');
    await expect(liveText).toContainText(`slide ${i + 1} of 4`);
    seen.push((await slideText.innerText()).trim());
  }
  expect(seen).toEqual([
    'Placeholder verse one',
    'Placeholder chorus',
    'Placeholder verse two',
    'Placeholder chorus',
  ]);

  // On the last slide, the picture comes next (the header before it is stepped over), and the output has it loaded.
  await expect(next).toHaveAttribute('data-kind', 'media');
  await expect(win.getByTestId('next-caption')).toHaveText('Picture: Placeholder Welcome');
  await expect(output.locator('[data-testid="preload"] img[data-state="ready"]')).toHaveCount(1);

  // Next: the picture goes up as the background and the slide comes off; the grid follows the show.
  await win.keyboard.press('ArrowRight');
  await expect(items.nth(3)).toHaveAttribute('data-live', 'true');
  await expect(slideText).toHaveCount(0);
  await expect(output.locator('[data-layer="background"] img[data-state="ready"]')).toHaveCount(1);
  await expect(win.getByTestId('item-media')).toHaveAttribute('aria-current', 'true');
  await expect(liveText).toHaveText('Live: Placeholder Welcome');

  // The next song's first slide is next, with its logo loaded ahead.
  await expect(win.getByTestId('next-caption')).toHaveText('Placeholder Second Song, slide 1 (next item)');
  await expect(output.locator('[data-testid="preload"] img[data-state="ready"]')).toHaveCount(1);
  // Watch the output as the next slide goes in: its logo must be loaded the moment the slide is,
  // before anything is painted (with media this slow, only a logo loaded ahead can be).
  await output.evaluate(() => {
    const seen: { text: string; logo: boolean | null }[] = [];
    (globalThis as typeof globalThis & { sabhaSeen?: typeof seen }).sabhaSeen = seen;
    new MutationObserver(() => {
      const layer = document.querySelector('[data-layer="slide"]');
      const img = layer?.querySelector<HTMLImageElement>('img[data-media-id]');
      seen.push({ text: layer?.textContent ?? '', logo: img ? img.complete && img.naturalWidth > 0 : null });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await win.keyboard.press('ArrowRight');
  await expect(slideText).toHaveText('Placeholder second song, first line');
  await expect(items.nth(4)).toHaveAttribute('data-live', 'true');
  await expect(grid.getByRole('heading', { level: 2 })).toHaveText('Placeholder Second Song');
  const going = await output.evaluate(
    () =>
      (globalThis as typeof globalThis & { sabhaSeen?: { text: string; logo: boolean | null }[] })
        .sabhaSeen ?? [],
  );
  const first = going.find((f) => f.text.includes('second song'));
  expect(first, 'the new slide going in').toBeDefined();
  expect(first?.logo, 'its logo, loaded ahead').toBe(true);

  // Previous goes back to the picture, then to the song's last slide: the second chorus.
  await win.keyboard.press('ArrowLeft');
  await expect(items.nth(3)).toHaveAttribute('data-live', 'true');
  await win.keyboard.press('ArrowLeft');
  await expect(liveText).toContainText('slide 4 of 4');
  await expect(slideText).toHaveText('Placeholder chorus');

  // Shift and an arrow jump whole items.
  await win.keyboard.press('Shift+ArrowRight');
  await expect(items.nth(3)).toHaveAttribute('data-live', 'true');
  await win.keyboard.press('Shift+ArrowRight');
  await expect(slideText).toHaveText('Placeholder second song, first line');
  await win.keyboard.press('ArrowRight');
  await expect(slideText).toHaveText('Placeholder second song, second line');
  // The end of the playlist: nothing after it, and Next stays put.
  await expect(next).toHaveAttribute('data-kind', 'none');
  await win.keyboard.press('ArrowRight');
  await expect(slideText).toHaveText('Placeholder second song, second line');

  await app.close();
});

test('after a crash the playlist and the place in it come back, and Next carries on into the next item', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  const files = await sabhaFiles(win);
  await importAndGetIds(win, files.songs);
  await importAndGetIds(win, [files.playlist]);
  await setUpScreen(win);
  await outputPage(app);
  const items = await openSunday(win);
  await items.nth(1).click();
  await win.keyboard.press('Space');
  for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowRight');
  await expect(win.getByTestId('live-text')).toContainText('slide 4 of 4');
  // Give the save a moment, then stop dead.
  await win.waitForTimeout(1500);
  await killApp(app);

  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  const output = await outputPage(again.app);
  await expect(output.locator('[data-layer="slide"]')).toHaveText('Placeholder chorus');
  // The playlist opens by itself at the song, marked live.
  const items2 = win2.getByTestId('playlists').getByTestId('playlist-item');
  await expect(items2.nth(1)).toHaveAttribute('data-live', 'true');
  await expect(win2.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Sung Song',
  );
  await win2.getByTestId('recovery-notice').getByRole('button', { name: 'OK' }).click();
  await win2.keyboard.press('ArrowRight');
  await expect(items2.nth(3)).toHaveAttribute('data-live', 'true');
  await expect(output.locator('[data-layer="background"] img')).toHaveCount(1);
  await again.app.close();
});
