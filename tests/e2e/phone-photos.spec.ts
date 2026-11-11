import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { closePlaylistIfOpen, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { makeTestImage, makeTestTone } from './test-media';

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

/** Choose files with the phone's own picker, from Add from this Phone…. */
async function addFromPhone(p: Page, files: string[]): Promise<void> {
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByTestId('remote-add-button').click(),
  ]);
  await chooser.setFiles(files);
}

/*
 * Question 5 (the owner's decisions of 3 and 4 Nov 2026): while Drashti is in Simple Mode, a photo a paired phone sends,
 * by Add from this Phone… or Add photos, goes to the end of Simple Mode's playlist, and into Media as ever, never live;
 * so does a sound (and a video, a PDF or a deck); the phone says so before it is sent. Back in Pro Mode a picture from
 * Add from this Phone… goes to Added from Phones as before.
 */
test('in Simple Mode a paired phone’s photos and other files go to the end of Simple Mode’s playlist, said first, never live; in Pro Mode, to Added from Phones as before', async () => {
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
    await makeTestImage(win, join(dir, 'Placeholder photo three.png'), { color: '#1e3a8a' }),
  ];
  // A playlist with a header in it, open as Drashti switches to Simple Mode: Simple Mode's one playlist.
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
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder sabha');
  await setAddFiles(win, true);
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(playlistId);
  const rowsInSimple = win.getByTestId('open-playlist').getByTestId('playlist-item');
  await expect(rowsInSimple).toHaveCount(1);
  const labels = () =>
    win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.label),
      playlistId,
    );
  const addedFromPhones = () =>
    win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.playlists.tree()).filter(
        (n) => n.name === 'Added from Phones',
      ),
    );

  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-library').click();
    await p.getByTestId('remote-library-media').click();
    await expect(p.getByTestId('remote-add-button')).toBeVisible();
    const sending = p.getByTestId('remote-sending');

    // Add from this Phone…, a picture: at the end of Simple Mode's playlist, in Media, never live.
    await addFromPhone(p, [photos[0] ?? '']);
    const one = sending.filter({ hasText: 'Placeholder photo one.png' });
    await expect(one).toHaveAttribute('data-state', 'added', { timeout: 60_000 });
    await expect(one.getByTestId('remote-sending-words')).toHaveText(
      'Added to Drashti, in Media and the playlist “Placeholder sabha”.',
    );
    await expect.poll(labels).toEqual(['Placeholder start', 'Placeholder photo one.png']);
    // Simple Mode's window shows it as its last row.
    await expect(rowsInSimple).toHaveCount(2);
    await expect(rowsInSimple.last()).toContainText('Placeholder photo one.png');
    const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
    expect(media.filter((m) => m.name === 'Placeholder photo one.png')).toHaveLength(1);
    expect(await addedFromPhones()).toEqual([]);
    const { state } = await snapshot(win);
    expect(state.live.playlist).toBeNull();
    expect(state.layers.background).toBeNull();

    // The phone says where pictures go, before they are sent: Simple Mode's playlist, by its name.
    await expect(p.getByTestId('remote-photos-words')).toHaveText(
      'Add photos puts pictures at the end of Simple Mode’s playlist, “Placeholder sabha”. They never go on the screens by themselves.',
    );
    await expect(p.getByTestId('remote-add-words')).toHaveText(
      'A picture, video, sound, PDF, PowerPoint or Keynote file, up to 2 GB, goes whole to the end of Simple Mode’s playlist “Placeholder sabha”. It never goes on the screens by itself.',
    );
    await expectNoSeriousA11yIssues(p, 'adding files on a phone in Simple Mode at 375 × 812');

    // Add photos: the same, after it.
    await addPhotos(p, [photos[1] ?? '']);
    await expect(sending.filter({ hasText: 'Placeholder photo two.png' })).toHaveAttribute(
      'data-state',
      'added',
      { timeout: 60_000 },
    );
    await expect
      .poll(labels)
      .toEqual(['Placeholder start', 'Placeholder photo one.png', 'Placeholder photo two.png']);
    await expect(rowsInSimple).toHaveCount(3);

    // A sound (the owner's answer of 4 Nov 2026: a phone's other files too): after them, never playing by itself.
    const tone = makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 1, hz: 440 });
    await addFromPhone(p, [tone]);
    const sound = sending.filter({ hasText: 'Placeholder tone.wav' });
    await expect(sound).toHaveAttribute('data-state', 'added', { timeout: 60_000 });
    await expect(sound.getByTestId('remote-sending-words')).toHaveText(
      'Added to Drashti, in Media and the playlist “Placeholder sabha”.',
    );
    await expect
      .poll(labels)
      .toEqual([
        'Placeholder start',
        'Placeholder photo one.png',
        'Placeholder photo two.png',
        'Placeholder tone.wav',
      ]);
    await expect(rowsInSimple).toHaveCount(4);
    expect(await addedFromPhones()).toEqual([]);
    expect((await snapshot(win)).state.layers.audio).toBeNull();
    await expect.poll(() => uploadsLeft(userData)).toEqual([]);

    // Pro Mode again, the playlist closed: Add from this Phone…'s picture goes to Added from Phones, as before.
    await win.getByTestId('simple-leave').dblclick();
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    await closePlaylistIfOpen(win);
    await expect(p.getByTestId('remote-add')).toContainText(
      'goes whole into Drashti’s playlist “Added from Phones”',
    );
    await addFromPhone(p, [photos[2] ?? '']);
    const three = sending.filter({ hasText: 'Placeholder photo three.png' });
    await expect(three).toHaveAttribute('data-state', 'added', { timeout: 60_000 });
    await expect(three.getByTestId('remote-sending-words')).toHaveText(
      'Added to Drashti, in Media and the playlist “Added from Phones”.',
    );
    expect(await labels()).toEqual([
      'Placeholder start',
      'Placeholder photo one.png',
      'Placeholder photo two.png',
      'Placeholder tone.wav',
    ]);
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(1);
  } finally {
    await phone.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});
