import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { closePlaylistIfOpen, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * Phone photos and files into the playlist (Session 55, Part 8, the owner's idea J; Question 5 of 3 and 4 Nov 2026),
 * refused (alpha.23, QA23-PHONE-1, the owner: "no video access in either of simple or pro mode in phone, they cant
 * change videos, only ppts an pdfs"; the rule's words: "Phones cannot add or share files with Drashti."): a paired
 * phone's Add photos and Add from this Phone… are refused in those words, before a byte is read, in Pro Mode with a
 * playlist open on Drashti and with none, and in Simple Mode, with files from phones turned on all the while; the
 * playlist, Media and Added from Phones stay as they were, nothing waits in the uploads folder and nothing goes live.
 * The phone's own buttons and words for it went with the rule (its page, the UI builder's). At 375 × 812. Placeholder
 * pictures and tones only, made here; codes and tokens are made at run time and never printed.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

const setAddFiles = (win: Page, on: boolean) =>
  win.evaluate(async (value) => {
    const result = await (globalThis as PageGlobals).drashti.network.setAddFiles(value);
    if (!result.ok) throw new Error(result.message);
  }, on);

/** What phones are sending, in Drashti's media folder: empty, as nothing is ever taken. */
const uploadsLeft = (userData: string) => {
  try {
    return readdirSync(join(userData, 'Media', '.phone-uploads'));
  } catch {
    return [];
  }
};

/** The start of a file a phone would send (Add photos says `into: 'open'`), as the phone's page asks for it. */
const sending = (file: string, photos: boolean) => ({
  name: basename(file),
  size: statSync(file).size,
  ...(photos ? { into: 'open' } : {}),
});

/** What a file from a phone would have changed in the operator window: the playlist, Media and Added from Phones. */
const deskOf = (win: Page, userData: string, playlistId: string) => async () => ({
  labels: await win.evaluate(
    async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.label),
    playlistId,
  ),
  media: (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).map(
    (m) => m.name,
  ),
  addedFromPhones: (await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree())).filter(
    (n) => n.name === 'Added from Phones',
  ).length,
  uploads: uploadsLeft(userData),
});

test('Add photos on a paired phone at 375 × 812 is refused in words, with a playlist open on Drashti and with none: nothing added, never live', async () => {
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
  const desk = deskOf(win, userData, playlistId);

  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };

    // Add photos, each picture, with the playlist open on Drashti: refused, and the phone's list of what it sends too.
    for (const photo of photos)
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/uploads', sending(photo, true), 'files', desk);
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/uploads', undefined, 'files', desk);
    // The open playlist as it was, no Added from Phones, neither picture in Media.
    const after = await desk();
    expect(after).toMatchObject({ labels: ['Placeholder start'], addedFromPhones: 0, uploads: [] });
    expect(after.media.filter((m) => m.startsWith('Placeholder photo'))).toEqual([]);
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(1);
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(0);
    // Never live.
    const { state } = await snapshot(win);
    expect(state.live.playlist).toBeNull();
    expect(state.layers.background).toBeNull();

    // The playlist closed (where they went to Added from Phones): refused the same.
    await closePlaylistIfOpen(win);
    const third = await makeTestImage(win, join(dir, 'Placeholder photo three.png'), { color: '#1e3a8a' });
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/uploads', sending(third, true), 'files', desk);
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(0);
    expect(uploadsLeft(userData)).toEqual([]);
  } finally {
    await phone.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});

/*
 * Question 5 (the owner's decisions of 3 and 4 Nov 2026) put a phone's files at the end of Simple Mode's playlist; under
 * the phone rule a phone adds none in Simple Mode either: Add from this Phone… and Add photos, a picture or a sound,
 * refused in the same words, Simple Mode's playlist as it was; back in Pro Mode, the playlist closed, the same.
 */
test('in Simple Mode a paired phone’s photos and other files are refused in words, Simple Mode’s playlist as it was, never live; in Pro Mode the same', async () => {
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
  const desk = deskOf(win, userData, playlistId);
  const nothingAdded = { labels: ['Placeholder start'], addedFromPhones: 0, uploads: [] };
  const sent = (media: string[]) =>
    media.filter((m) => m.startsWith('Placeholder photo') || m === 'Placeholder tone.wav');

  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };

    // Add from this Phone…, a picture; Add photos, another; a sound (the owner's answer of 4 Nov 2026: a phone's other
    // files too): each refused in Simple Mode, its playlist as it was, nothing in Media, nothing live or sounding.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/uploads',
      sending(photos[0] ?? '', false),
      'files',
      desk,
    );
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/uploads',
      sending(photos[1] ?? '', true),
      'files',
      desk,
    );
    const tone = makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 1, hz: 440 });
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/uploads', sending(tone, false), 'files', desk);
    const inSimple = await desk();
    expect(inSimple).toMatchObject(nothingAdded);
    expect(sent(inSimple.media)).toEqual([]);
    await expect(rowsInSimple).toHaveCount(1);
    const { state } = await snapshot(win);
    expect(state.live.playlist).toBeNull();
    expect(state.layers.background).toBeNull();
    expect(state.layers.audio).toBeNull();

    // Pro Mode again, the playlist closed: Add from this Phone…'s picture refused the same; no Added from Phones.
    await win.getByTestId('simple-leave').dblclick();
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    await closePlaylistIfOpen(win);
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/uploads',
      sending(photos[2] ?? '', false),
      'files',
      desk,
    );
    const inPro = await desk();
    expect(inPro).toMatchObject(nothingAdded);
    expect(sent(inPro.media)).toEqual([]);
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(0);
  } finally {
    await phone.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});
