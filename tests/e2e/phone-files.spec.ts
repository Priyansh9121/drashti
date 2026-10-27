import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, device, networkOn, NETWORK_ENV, pairByQr, pairingCode, pairToken, TABLET } from './devices';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { PICTURE, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * Files between Drashti and its phones (Session 54, D3 and D4), each step seen in the operator window and on a
 * phone or tablet against the app's real server on this computer (Safari's engine as an iPhone or iPad, Chrome's
 * as an Android phone): a playlist shared with phones from its right-click menu, listed on a remote under Shared
 * from Drashti to look at on the device, read-only, and never for a Stage or Announcements device; and a file
 * added from a phone while the switch is on, sent with a progress bar, picking up again after the connection
 * drops, Cancel, the size limit and a renamed file refused in words, then in Added from Phones and Media with
 * the phone's name, never live by itself. At 375 × 812 and 768 × 1024, passing axe. Placeholder content and
 * generated sound only; codes and tokens are made at run time and never printed.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

/** A file's pieces, and what the phone asks of one file (how it stands), as their addresses are. */
const PIECE = /\/api\/v1\/uploads\/[0-9a-f-]{36}\/piece\?offset=\d+$/u;
const ONE_FILE = /\/api\/v1\/uploads\/[0-9a-f-]{36}$/u;

const setAddFiles = (win: Page, on: boolean) =>
  win.evaluate(async (value) => {
    const result = await (globalThis as PageGlobals).drashti.network.setAddFiles(value);
    if (!result.ok) throw new Error(result.message);
  }, on);

/** What phones are sending, in Drashti's media folder: empty once each is imported, cancelled or refused. */
const uploadsLeft = (userData: string) => {
  try {
    return readdirSync(join(userData, 'Media', '.phone-uploads'));
  } catch {
    return [];
  }
};

/** Every visible control in `within` under 44 × 44 CSS pixels, by its name (phone-pages.spec.ts checks the rest). */
const tooSmall = (page: Page, within: string) =>
  page.evaluate(
    (selector) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          `${selector} :is(button, a[href], input:not([type="hidden"]), select, [role="button"])`,
        ),
      ]
        .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 44 || box.height < 44)
        .map(({ el }) => (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30)),
    within,
  );

/** Choose files with the phone's own picker, from Add from this Phone…. */
async function addFromPhone(p: Page, files: string[]): Promise<void> {
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByTestId('remote-add-button').click(),
  ]);
  await chooser.setFiles(files);
}

test('a playlist shared with phones: Share and Stop Sharing in its menu, Shared from Drashti on a remote at 375 × 812, on the device only and read-only, never for a Stage or Announcements device', async () => {
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
    await p.getByTestId('remote-tab-library').click();
    await expect(p.getByTestId('remote-library')).toBeVisible();
    await expect(p.getByTestId('remote-shared')).toHaveCount(0);

    // A remote is paired: Share with Phones and Tablets, and the playlist's row says so.
    await expect(win.getByTestId('network-badge')).toHaveText(/\b1 device\b/u);
    await node.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Share with Phones and Tablets' }).click();
    await expect(node.getByTestId('playlist-shared')).toBeVisible();
    await expectNoSeriousA11yIssues(win, 'a playlist shared with phones, in the operator window');

    // On the phone, under Shared from Drashti: its items with its headers, each file to look at.
    const shared = p.getByTestId('remote-shared');
    await expect(shared.getByTestId('remote-shared-playlist')).toContainText(PLAYLIST);
    await expectNoSeriousA11yIssues(p, 'Shared from Drashti on a phone at 375 × 812');
    expect(await tooSmall(p, '[data-testid="remote-files"]')).toEqual([]);
    await shared.getByTestId('remote-shared-playlist').click();
    await expect(shared.getByTestId('remote-shared-header')).toHaveText(['Welcome', 'Kirtan']);
    await expect(shared.getByTestId('remote-shared-item')).toHaveCount(3);
    const before = (await snapshot(win)).state;
    await shared.getByTestId('remote-shared-item').filter({ hasText: PICTURE }).click();
    const viewer = p.getByTestId('shared-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByTestId('shared-viewer-where')).toHaveText('Picture · 3 of 3');
    await expect(viewer.getByTestId('shared-media')).toHaveAttribute('data-media', 'image');
    await expect(viewer).toContainText('On this device only: nothing here goes on the screens.');
    await expect(viewer.getByTestId('shared-viewer-close')).toBeFocused();
    await expectNoSeriousA11yIssues(p, 'a shared picture looked at on a phone');
    expect(await tooSmall(p, '[data-testid="shared-viewer"]')).toEqual([]);
    // The kirtan before it: its slides one under another, in its order.
    await viewer.getByTestId('shared-viewer-previous').click();
    await expect(viewer.getByTestId('shared-viewer-where')).toHaveText('Presentation · 2 of 3');
    await expect(viewer.getByTestId('shared-slides').getByRole('listitem')).toHaveCount(
      show.kirtanOrder.length,
    );
    await expectNoSeriousA11yIssues(p, 'a shared presentation looked at on a phone');
    await viewer.getByTestId('shared-viewer-previous').click();
    await expect(viewer.getByTestId('shared-viewer-previous')).toBeDisabled();
    // Looking changes nothing on the screens.
    const after = (await snapshot(win)).state;
    expect(after.live).toEqual(before.live);
    expect(after.layers.slide).toEqual(before.layers.slide);
    expect(after.layers.background).toEqual(before.layers.background);
    await p.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // Read-only: no request changes it. A Stage or Announcements device never sees it.
    const script = await pairToken(win, port, 'remote', 'Placeholder script');
    const listed = await apiCall(port, '/api/v1/shared', { token: script });
    expect(listed.status).toBe(200);
    expect(listed.json['playlists']).toEqual([
      { id: show.playlistId, name: PLAYLIST, itemCount: 5, fromFolder: false },
    ]);
    const items = `/api/v1/shared/${show.playlistId}/items`;
    expect((await apiCall(port, items, { method: 'POST', token: script, body: { items: [] } })).status).toBe(
      405,
    );
    for (const kind of ['stage', 'announcements'] as const) {
      const token = await pairToken(win, port, kind, `Placeholder ${kind}`);
      expect((await apiCall(port, '/api/v1/shared', { token })).status, kind).toBe(403);
      expect((await apiCall(port, items, { token })).status, kind).toBe(403);
    }

    // Stop Sharing: gone from its row, from the phone, and from the API.
    await node.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Stop Sharing' }).click();
    await expect(node.getByTestId('playlist-shared')).toHaveCount(0);
    await expect(p.getByTestId('remote-shared')).toHaveCount(0);
    expect((await apiCall(port, items, { token: script })).status).toBe(404);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a folder playlist shared whole: a smart playlist following a folder, its folders as headers on a remote', async () => {
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
    await p.getByTestId('remote-tab-library').click();
    await expect(win.getByTestId('network-badge')).toHaveText(/\b1 device\b/u);
    await node.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Share with Phones and Tablets' }).click();
    await expect(node.getByTestId('playlist-shared')).toBeVisible();
    // Shared whole: its own files, then its folder's, under the folder's name.
    const shared = p.getByTestId('remote-shared');
    await shared.getByTestId('remote-shared-playlist').filter({ hasText: 'Placeholder Sabha' }).click();
    await expect(shared.getByTestId('remote-shared-header')).toHaveText(['Week 1']);
    await expect(shared.getByTestId('remote-shared-item')).toHaveText([/Opening\.png/u, /Darshan\.png/u]);
    await expectNoSeriousA11yIssues(p, 'a shared folder playlist on a phone');
    await shared.getByTestId('remote-shared-item').filter({ hasText: 'Darshan.png' }).click();
    await expect(p.getByTestId('shared-viewer-where')).toHaveText('Picture · 2 of 2');
  } finally {
    await phone.close();
  }
  await app.close();
  rmSync(work, { recursive: true, force: true });
});

test('a file added from a phone at 375 × 812: off until the switch is on, sent with a progress bar, picking up again after the connection drops, then in Added from Phones and Media with the phone’s name, never live', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-files-'));
  // About 5.8 MB: several pieces.
  const tone = makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 60, rate: 48_000 });
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-library').click();
    await expect(p.getByTestId('remote-library')).toBeVisible();
    // Off until someone turns it on.
    await expect(p.getByTestId('remote-add')).toHaveCount(0);
    await win.getByTestId('open-network').click();
    const panel = win.getByTestId('network-panel');
    const toggle = panel.getByTestId('network-add-files');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expectNoSeriousA11yIssues(win, 'the Phones and tablets panel with files from phones on');
    await panel.getByRole('button', { name: 'Close phones and tablets' }).click();
    await expect(p.getByTestId('remote-add-button')).toBeVisible();
    await expectNoSeriousA11yIssues(p, 'Add to Drashti on a phone at 375 × 812');
    expect(await tooSmall(p, '[data-testid="remote-files"]')).toEqual([]);

    // The second piece's connection drops; asking where to carry on waits until the test has seen it said.
    let pieces = 0;
    await p.route(PIECE, async (route) => {
      pieces++;
      if (pieces === 2) await route.abort('connectionreset');
      else await route.continue();
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await p.route(ONE_FILE, async (route) => {
      await held;
      await route.continue();
    });
    await addFromPhone(p, [tone]);
    const row = p.getByTestId('remote-sending').filter({ hasText: 'Placeholder tone.wav' });
    await expect(row).toBeVisible();
    const words = row.getByTestId('remote-sending-words');
    await expect(words).toHaveText('The connection dropped: picking up again…');
    // How far it got before, on its bar.
    const done = Number(await row.getByTestId('remote-sending-progress').getAttribute('aria-valuenow'));
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(100);
    await expectNoSeriousA11yIssues(p, 'a file being sent from a phone, its connection dropped');
    release();
    await expect(row).toHaveAttribute('data-state', 'added', { timeout: 60_000 });
    await expect(words).toHaveText('Added to Drashti, in Media and the playlist “Added from Phones”.');
    expect(pieces).toBeGreaterThan(2);
    await expect.poll(() => uploadsLeft(userData)).toEqual([]);

    // In the operator window: the playlist Added from Phones, and Media, each with the phone's name.
    const added = win.getByTestId('playlist-node').filter({ hasText: 'Added from Phones' });
    await expect(added).toBeVisible();
    await added.click();
    // Its length, once Drashti has read it, between.
    await expect(win.getByTestId('item-what')).toHaveText([/^Sound( · [\d:]+)? · from Placeholder phone$/u]);
    await win.getByTestId('library-tab-media').click();
    await expect(
      win.getByTestId('media-row').filter({ hasText: 'Placeholder tone.wav' }).getByTestId('media-note'),
    ).toHaveText('Audio · from Placeholder phone');
    // Never live by itself.
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

test('at 768 × 1024: Cancel leaves nothing behind, a file over the size limit and a renamed one are refused in words, and the switch turned off is said', async () => {
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
    await p.getByTestId('remote-side-library').click();
    await expect(p.getByTestId('remote-add-button')).toBeVisible();

    // Cancel while a piece is on its way: it stops at once, and Drashti keeps nothing of it.
    let pieces = 0;
    let cancelled: () => void = () => undefined;
    const pressed = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    await p.route(PIECE, async (route) => {
      pieces++;
      if (pieces === 2) {
        await pressed;
        await route.abort('aborted').catch(() => undefined);
        return;
      }
      await route.continue();
    });
    await addFromPhone(p, [tone]);
    const row = p.getByTestId('remote-sending').filter({ hasText: 'Placeholder tone.wav' });
    await expect.poll(() => pieces).toBe(2);
    await expect(row).toHaveAttribute('data-state', 'receiving');
    await expectNoSeriousA11yIssues(p, 'a file being sent from a tablet at 768 × 1024');
    expect(await tooSmall(p, '[data-testid="remote-files"]')).toEqual([]);
    await row.getByRole('button', { name: 'Cancel Placeholder tone.wav' }).click();
    cancelled();
    await expect(row).toHaveAttribute('data-state', 'cancelled');
    await expect(row.getByTestId('remote-sending-words')).toHaveText('Cancelled.');
    await expect.poll(() => uploadsLeft(userData)).toEqual([]);
    await p.unroute(PIECE);

    // Over the size limit (8 MB here), and a page of words named as a picture: each refused in words.
    await addFromPhone(p, [long]);
    const tooLarge = p.getByTestId('remote-sending').filter({ hasText: 'Placeholder long tone.wav' });
    await expect(tooLarge).toHaveAttribute('data-state', 'failed');
    await expect(tooLarge.getByTestId('remote-sending-words')).toHaveText(
      'This file is larger than 8.0 MB: Drashti takes files up to 8.0 MB from a phone.',
    );
    await addFromPhone(p, [renamed]);
    const notTaken = p.getByTestId('remote-sending').filter({ hasText: 'Placeholder photo.jpg' });
    await expect(notTaken).toHaveAttribute('data-state', 'failed', { timeout: 30_000 });
    await expect(notTaken.getByTestId('remote-sending-words')).toHaveText(
      'Drashti takes pictures, videos, sounds, PDF, PowerPoint and Keynote files, and this is none of them: each file is checked by what is inside it, not by its name.',
    );
    await expectNoSeriousA11yIssues(p, 'files refused, on a tablet at 768 × 1024');
    const names = (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).map(
      (m) => m.name,
    );
    for (const name of ['Placeholder tone.wav', 'Placeholder long tone.wav', 'Placeholder photo.jpg'])
      expect(names, name).not.toContain(name);
    expect(uploadsLeft(userData)).toEqual([]);

    // Turned off in Drashti: the tablet says so (what it sent stays listed).
    await setAddFiles(win, false);
    await expect(p.getByTestId('remote-add-off')).toHaveText('Drashti does not take files from phones now.');
    await expect(p.getByTestId('remote-add-button')).toHaveCount(0);
  } finally {
    await tablet.close();
    rmSync(dir, { recursive: true, force: true });
  }
  await app.close();
});
