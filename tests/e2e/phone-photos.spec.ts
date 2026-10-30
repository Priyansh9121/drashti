import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { closePlaylistIfOpen, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Phone photos into the playlist (Session 55, Part 8, the owner's idea J): a paired phone's Add photos sends pictures
 * from its camera roll over the local network into the playlist open on Drashti, at its end, imported as a dropped
 * picture is (what a screen can't show, HEIC among them, converted by itself: Part 5), never live by itself. With no
 * playlist open they go to Added from Phones, as Add from this Phone… does, and the phone says so before they go.
 * Paired phones only (the poster link has no files at all). At 375 × 812. Placeholder pictures only, made here; codes
 * and tokens are made at run time and never printed.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

const setAddFiles = (win: Page, on: boolean) =>
  win.evaluate(async (value) => {
    const result = await (globalThis as PageGlobals).drashti.network.setAddFiles(value);
    if (!result.ok) throw new Error(result.message);
  }, on);

/** What phones are sending, in Drashti's media folder: empty once each is imported. */
const uploadsLeft = (userData: string) => {
  try {
    return readdirSync(join(userData, 'Media', '.phone-uploads'));
  } catch {
    return [];
  }
};

/** Choose pictures with the phone's own picker, from Add photos. */
async function addPhotos(p: Page, files: string[]): Promise<void> {
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByTestId('remote-photos-button').click(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
}

test('Add photos on a paired phone at 375 × 812: pictures into the end of the playlist open on Drashti, never live; with none open, into Added from Phones, said first', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-photos-'));
  const photos = [
    await makeTestImage(win, join(dir, 'Placeholder photo one.png'), { color: '#7c2d12' }),
    await makeTestImage(win, join(dir, 'Placeholder photo two.png'), { color: '#14532d' }),
  ];
  // A playlist with a header in it, open in the operator window.
  const playlistId = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.playlists.create('Placeholder sabha', null, false);
    if (!list.ok) throw new Error(list.message);
    const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
      { kind: 'header', label: 'Placeholder start' },
    ]);
    if (!added.ok) throw new Error(added.message);
    return list.ids[0] ?? '';
  });
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder sabha' }).click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(1);
  await setAddFiles(win, true);

  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-library').click();
    await p.getByTestId('remote-library-media').click();
    // Add photos, saying where they go: the playlist open on Drashti.
    const photosButton = p.getByTestId('remote-photos-button');
    await expect(photosButton).toBeVisible();
    await expect(p.getByTestId('remote-photos-words')).toContainText('“Placeholder sabha”');
    await expectNoSeriousA11yIssues(p, 'Add photos on a phone at 375 × 812');

    await addPhotos(p, photos);
    const rows = p.getByTestId('remote-sending');
    await expect(rows).toHaveCount(2);
    for (const name of ['Placeholder photo one.png', 'Placeholder photo two.png'])
      await expect(rows.filter({ hasText: name })).toHaveAttribute('data-state', 'added', {
        timeout: 60_000,
      });
    await expect(
      rows.filter({ hasText: 'Placeholder photo one.png' }).getByTestId('remote-sending-words'),
    ).toHaveText('Added to Drashti, in Media and the playlist “Placeholder sabha”.');
    await expect.poll(() => uploadsLeft(userData)).toEqual([]);

    // In the open playlist, after what was there, in the order chosen; no Added from Phones.
    const labels = await win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.label),
      playlistId,
    );
    expect(labels).toEqual(['Placeholder start', 'Placeholder photo one.png', 'Placeholder photo two.png']);
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(3);
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(0);
    // Never live by itself.
    const { state } = await snapshot(win);
    expect(state.live.playlist).toBeNull();
    expect(state.layers.background).toBeNull();

    // The playlist closed: the phone says they go to Added from Phones, and they do.
    await closePlaylistIfOpen(win);
    await expect(p.getByTestId('remote-photos-words')).toContainText('“Added from Phones”');
    const third = await makeTestImage(win, join(dir, 'Placeholder photo three.png'), { color: '#1e3a8a' });
    await addPhotos(p, [third]);
    await expect(rows.filter({ hasText: 'Placeholder photo three.png' })).toHaveAttribute(
      'data-state',
      'added',
      {
        timeout: 60_000,
      },
    );
    await expect(
      rows.filter({ hasText: 'Placeholder photo three.png' }).getByTestId('remote-sending-words'),
    ).toHaveText('Added to Drashti, in Media and the playlist “Added from Phones”.');
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(1);
  } finally {
    await phone.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});
