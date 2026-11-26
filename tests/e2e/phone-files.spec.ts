import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, device, networkOn, NETWORK_ENV, pairByQr, pairingCode, pairToken, TABLET } from './devices';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * Files between Drashti and its phones (Session 54, D3 and D4), under the phone rule (alpha.23, QA23-PHONE-1, the
 * owner: "no video access in either of simple or pro mode in phone, they cant change videos, only ppts an pdfs"; the
 * rule's words: "Phones cannot add or share files with Drashti."). The operator window keeps what it had (the owner's
 * Q11: "Words now, hide later"): a playlist's right-click menu shares it with phones and stops sharing it, its row says
 * so, a folder playlist shares whole, and Phones and tablets turns files from phones on and off. A phone or tablet
 * (Safari's engine as an iPhone or iPad, Chrome's as an Android phone, against the app's real server on this computer)
 * is refused all of it in words, the show and the library as they were: Shared from Drashti and its items, a file's
 * own bytes and a link to them (a sound played there), a click's picture, and adding a file (its start, its pieces,
 * how it stands, Cancel), whatever its size or name and whether the switch is on or off; a Stage or Announcements
 * device never sees any of it. The phone's own pages for it went with the rule (its page, the UI builder's).
 * Placeholder content and generated sound only; codes and tokens are made at run time and never printed.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

/** A playlist shared with phones, or no longer, as its right-click menu does it. */
const setShared = (win: Page, playlistId: string, on: boolean) =>
  win.evaluate(
    async ({ id, value }) => {
      const result = await (globalThis as PageGlobals).drashti.playlists.share(id, value);
      if (!result.ok) throw new Error(result.message);
    },
    { id: playlistId, value: on },
  );

const setAddFiles = (win: Page, on: boolean) =>
  win.evaluate(async (value) => {
    const result = await (globalThis as PageGlobals).drashti.network.setAddFiles(value);
    if (!result.ok) throw new Error(result.message);
  }, on);

/** What phones are sending, in Drashti's media folder: empty, as nothing is ever taken from one. */
const uploadsLeft = (userData: string) => {
  try {
    return readdirSync(join(userData, 'Media', '.phone-uploads'));
  } catch {
    return [];
  }
};

/** The start of a file a phone would send (POST /api/v1/uploads), as the phone's page asks for it. */
const sending = (file: string) => ({ name: basename(file), size: statSync(file).size });

/** What a file from a phone would change in the operator window: Media, Added from Phones, the uploads folder. */
const filesOf = (win: Page, userData: string) => async () => ({
  media: (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).map(
    (m) => m.name,
  ),
  addedFromPhones: (await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree())).filter(
    (n) => n.name === 'Added from Phones',
  ).length,
  uploads: uploadsLeft(userData),
});

/** Every request a phone made to send one file (Add from this Phone…), each refused in the files' words. */
async function refusedSending(phone: { win: Page; page: Page }, file: string, desk: () => Promise<unknown>) {
  const id = randomUUID();
  await expectPhoneRefuses(phone, 'POST', '/api/v1/uploads', sending(file), 'files', desk);
  await expectPhoneRefuses(phone, 'POST', `/api/v1/uploads/${id}/piece?offset=0`, undefined, 'files', desk);
  await expectPhoneRefuses(phone, 'GET', `/api/v1/uploads/${id}`, undefined, 'files', desk);
  await expectPhoneRefuses(phone, 'POST', `/api/v1/uploads/${id}/cancel`, undefined, 'files', desk);
  await expectPhoneRefuses(phone, 'GET', '/api/v1/uploads', undefined, 'files', desk);
}

test('a playlist shared with phones: Share and Stop Sharing in its menu, while a phone at 375 × 812 is refused Shared from Drashti, its items, their files and pictures in words; never for a Stage or Announcements device', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { port, base } = await networkOn(win);
  const node = win.getByTestId('playlist-node').filter({ hasText: PLAYLIST });

  // With no remote paired there is no one to share it with.
  await node.click({ button: 'right' });
  await expect(win.getByRole('menuitem', { name: 'Open' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Share with Phones and Tablets' })).toHaveCount(0);
  await win.keyboard.press('Escape');

  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };
    const items = `/api/v1/shared/${show.playlistId}/items`;
    // Nothing shared yet: the phone's list of shared playlists is refused all the same.
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/shared', undefined, 'files');

    // A remote is paired: Share with Phones and Tablets, and the playlist's row says so.
    await expect(win.getByTestId('network-badge')).toHaveText(/\b1 device\b/u);
    await node.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Share with Phones and Tablets' }).click();
    await expect(node.getByTestId('playlist-shared')).toBeVisible();
    await expectNoSeriousA11yIssues(win, 'a playlist shared with phones, in the operator window');

    // On the phone (was Shared from Drashti, the library's third choice, and D1's viewer): the shared playlists, its
    // items, the picture's own file and a click's picture are each refused, and nothing changes on the screens.
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/shared', undefined, 'files');
    await expectPhoneRefuses(fromPhone, 'GET', items, undefined, 'files');
    await expectPhoneRefuses(
      fromPhone,
      'GET',
      `/api/v1/media/${show.pictureMediaId}/original`,
      undefined,
      'media',
    );
    const slideId =
      (await win.evaluate(
        async (id) =>
          (await (globalThis as PageGlobals).drashti.library.getPresentation(id))?.groups[0]?.slides[0]?.id,
        show.kirtanId,
      )) ?? '';
    expect(slideId).not.toBe('');
    await expectPhoneRefuses(
      fromPhone,
      'GET',
      `/api/v1/presentations/${show.kirtanId}?format=png&slide=${slideId}&click=0`,
      undefined,
      'media',
    );

    // Read-only, and now refused to every Remote: a script's token too. A Stage or Announcements device never sees it.
    const script = await pairToken(win, port, 'remote', 'Placeholder script');
    await expectPhoneRefuses({ win, port, token: script }, 'GET', '/api/v1/shared', undefined, 'files');
    expect((await apiCall(port, items, { method: 'POST', token: script, body: { items: [] } })).status).toBe(
      405,
    );
    for (const kind of ['stage', 'announcements'] as const) {
      const token = await pairToken(win, port, kind, `Placeholder ${kind}`);
      expect((await apiCall(port, '/api/v1/shared', { token })).status, kind).toBe(403);
      expect((await apiCall(port, items, { token })).status, kind).toBe(403);
    }

    // Stop Sharing: gone from its row; the phone and the script refused as before (no longer "no such playlist").
    await node.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Stop Sharing' }).click();
    await expect(node.getByTestId('playlist-shared')).toHaveCount(0);
    await expectPhoneRefuses({ win, port, token: script }, 'GET', items, undefined, 'files');
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/shared', undefined, 'files');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a shared playlist’s sound is refused to a phone in words, its own file and a link to it, shared or not; Drashti plays nothing, and Stop Sharing is the window’s as before', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-files-sound-'));
  const [toneId = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 4, rate: 48_000 }),
  ]);
  expect(toneId).not.toBe('');
  await win.evaluate(
    async ({ playlistId, mediaId }) => {
      const added = await (globalThis as PageGlobals).drashti.playlists.addItems(playlistId, null, [
        { kind: 'media', mediaId },
      ]);
      if (!added.ok) throw new Error(added.message);
    },
    { playlistId: show.playlistId, mediaId: toneId },
  );
  const { port, base } = await networkOn(win);
  // In no shared playlist: a Remote gets no sound of the library (refused in words, no longer "no such media item").
  const script = await pairToken(win, port, 'remote', 'Placeholder script');
  const original = `/api/v1/media/${toneId}/original`;
  await expectPhoneRefuses({ win, port, token: script }, 'GET', original, undefined, 'media');
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await setShared(win, show.playlistId, true);
    // Shared: still refused, to the script and to the phone (was played on the phone by a link made for it, in
    // pieces, with B's time bar), its link too.
    const fromPhone = { win, page: p };
    await expectPhoneRefuses({ win, port, token: script }, 'GET', original, undefined, 'media');
    await expectPhoneRefuses(fromPhone, 'GET', `/api/v1/shared/${show.playlistId}/items`, undefined, 'files');
    await expectPhoneRefuses(fromPhone, 'GET', `/api/v1/media/${toneId}/link`, undefined, 'media');
    await expectPhoneRefuses(fromPhone, 'GET', original, undefined, 'media');
    // Drashti plays nothing.
    expect((await snapshot(win)).state.layers.audio).toBeNull();

    // Stop Sharing, in the window: refused as before.
    await setShared(win, show.playlistId, false);
    await expectPhoneRefuses({ win, port, token: script }, 'GET', original, undefined, 'media');
  } finally {
    await phone.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});

test('a folder playlist shared whole: a smart playlist following a folder, shared from its menu; a remote is refused it and its items in words', async () => {
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-phone-files-folder-'));
  const folder = join(work, 'Placeholder Sabha');
  mkdirSync(join(folder, 'Week 1'), { recursive: true });
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_TEST_SMART_SCAN_MS: '1000',
    DRASHTI_TEST_SMART_SETTLE_MS: '500',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await makeTestImage(win, join(folder, 'Opening.png'), { color: '#7c2d12' });
  await makeTestImage(win, join(folder, 'Week 1', 'Darshan.png'), { color: '#1e3a8a' });
  // + New › Smart Playlist from a Folder…, the folder chosen for the dialog.
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
  const node = win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sabha' });
  await expect(node).toHaveAttribute('data-playlist-kind', 'smart');
  const playlistId = (await node.getAttribute('data-node-id')) ?? '';
  await expect
    .poll(
      async () =>
        (await win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), playlistId)).map(
          (i) => i.label,
        ),
      { timeout: 60_000 },
    )
    .toEqual(['Opening.png', 'Week 1', 'Darshan.png']);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await expect(win.getByTestId('network-badge')).toHaveText(/\b1 device\b/u);
    await node.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Share with Phones and Tablets' }).click();
    await expect(node.getByTestId('playlist-shared')).toBeVisible();
    // Shared whole, its folder's files as they were; the phone is refused the list and the items (was: its own files,
    // then its folder's under the folder's name, opened in D1's viewer).
    const fromPhone = { win, page: p };
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/shared', undefined, 'files');
    await expectPhoneRefuses(fromPhone, 'GET', `/api/v1/shared/${playlistId}/items`, undefined, 'files');
    expect(
      (await win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), playlistId)).map(
        (i) => i.label,
      ),
    ).toEqual(['Opening.png', 'Week 1', 'Darshan.png']);
  } finally {
    await phone.close();
  }
  await app.close();
  rmSync(work, { recursive: true, force: true });
});

test('a file added from a phone at 375 × 812: refused in words with the switch off and on, its start, its pieces and how it stands; the switch is the window’s as before; nothing in Added from Phones or Media, never live', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-files-'));
  // About 5.8 MB: several pieces, had it been taken.
  const tone = makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 60, rate: 48_000 });
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };
    const desk = filesOf(win, userData);
    // Off, as it starts: refused in the rule's words (no longer "Drashti does not take files from phones now").
    await refusedSending(fromPhone, tone, desk);
    // The switch, in the operator window's Phones and tablets, as before.
    await win.getByTestId('open-network').click();
    const panel = win.getByTestId('network-panel');
    const toggle = panel.getByTestId('network-add-files');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expectNoSeriousA11yIssues(win, 'the Phones and tablets panel with files from phones on');
    await panel.getByRole('button', { name: 'Close phones and tablets' }).click();

    // On: refused the same, before a byte is read.
    await refusedSending(fromPhone, tone, desk);
    expect(uploadsLeft(userData)).toEqual([]);
    // In the operator window: no Added from Phones, nothing in Media from the phone.
    await expect(win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' })).toHaveCount(0);
    const { media } = await desk();
    expect(media).not.toContain('Placeholder tone.wav');
    // Never live.
    const { state } = await snapshot(win);
    expect(state.live.presentationId).toBeNull();
    expect(state.live.playlist).toBeNull();
    expect(state.layers.audio).toBeNull();
    expect(state.layers.background).toBeNull();
  } finally {
    await phone.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});

test('at 768 × 1024: a tablet’s file is refused in words whatever its size or name, Cancel too, the switch on or off, and Drashti keeps nothing', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_TEST_UPLOAD_MAX_BYTES: String(8 * 1024 * 1024),
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const { base } = await networkOn(win);
  await setAddFiles(win, true);
  const code = await pairingCode(win, 'remote', 'Placeholder tablet');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-files-'));
  const tone = makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 60, rate: 48_000 });
  const long = makeTestTone(join(dir, 'Placeholder long tone.wav'), { seconds: 120, rate: 48_000 });
  const renamed = join(dir, 'Placeholder photo.jpg');
  writeFileSync(renamed, 'Placeholder words, named as a picture.\n'.repeat(100));
  const tablet = await device('webkit', TABLET);
  const p = tablet.page;
  try {
    await p.setViewportSize({ width: 768, height: 1024 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await expect(p.getByTestId('remote')).toHaveAttribute('data-layout', 'wide');
    const fromTablet = { win, page: p };
    const desk = filesOf(win, userData);

    // A file within the limit, with its Cancel; one over the size limit (8 MB here, no longer "larger than 8.0 MB")
    // and a page of words named as a picture (no longer checked by what is inside it): each refused in the rule's
    // words, before a byte is read.
    await refusedSending(fromTablet, tone, desk);
    expect(statSync(long).size).toBeGreaterThan(8 * 1024 * 1024);
    await expectPhoneRefuses(fromTablet, 'POST', '/api/v1/uploads', sending(long), 'files', desk);
    await expectPhoneRefuses(fromTablet, 'POST', '/api/v1/uploads', sending(renamed), 'files', desk);
    const names = (await desk()).media;
    for (const name of ['Placeholder tone.wav', 'Placeholder long tone.wav', 'Placeholder photo.jpg'])
      expect(names, name).not.toContain(name);
    expect(uploadsLeft(userData)).toEqual([]);

    // Turned off in Drashti: refused the same (no longer "Drashti does not take files from phones now").
    await setAddFiles(win, false);
    await expectPhoneRefuses(fromTablet, 'POST', '/api/v1/uploads', sending(tone), 'files', desk);
  } finally {
    await tablet.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});
