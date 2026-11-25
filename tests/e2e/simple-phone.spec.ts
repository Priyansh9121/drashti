import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NEW_LOWER_THIRD } from '../../src/shared/lower-thirds';
import { PHONE_REFUSAL } from '../../src/shared/phone-rule';
import { apiCall, device, networkOn, NETWORK_ENV, pairByQr, pairingCode, pairToken } from './devices';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow, VIDEO } from './placeholder-show';
import { phoneAsks } from './pro-phone';
import { makeTestTone } from './test-media';

/*
 * A paired phone on a computer in Simple Mode (alpha.23, QA23-PHONE-1, the owner: "in simple mode only show the flow,
 * whats running in live, and chat"): it reads what is live, and everything else is refused in words, whatever the
 * phone's page or a script asks: a lower third, a message, the stage message, a timer, Next, a row of the playlist,
 * Clear all, the time bar, a row's When it ends, Rename and Remove, another playlist's rows, a folder or a playlist
 * made, and Audio. Simple Mode's window does each of those (moved from the phone, Session 55's "a phone does only
 * what Simple Mode's window does" now the window's alone). With Simple access (Part 19) the same, in words naming no
 * way to Pro Mode, whatever mode the window asks for. Back in Pro Mode the phone is still refused the lower third.
 * Placeholder content; codes and tokens made at run time.
 */

const SIMPLE_PERSON = 'simple.phone.placeholder@example.com';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** Where the show is: the live presentation and slide position. */
async function where(win: Page) {
  const s = await state(win);
  return { presentationId: s.live.presentationId, slideIndex: s.layers.slide?.slideIndex ?? null };
}

/** A lower third made in Drashti (Pro Mode's Lower Thirds), for the phone to ask for; its id. */
const makeLowerThird = (win: Page) =>
  win.evaluate(
    async (input) => {
      const saved = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, input);
      if (!saved.ok) throw new Error(saved.message);
      return (await (globalThis as PageGlobals).drashti.lowerThirds.list())[0]?.id ?? '';
    },
    {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    },
  );

/** The first message template's id, as the window has it. */
const firstMessage = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.messages.list())[0]?.id ?? '');

/** The placeholder playlist's rows, as the window has them. */
const rowsOf = (win: Page, playlistId: string) =>
  win.evaluate(async (id) => (globalThis as PageGlobals).drashti.playlists.items(id), playlistId);

test('a phone on a computer in Simple Mode reads what is live and is refused the rest in words: a lower third, a message, the stage message, a timer, Next, a row of its playlist and Clear all, nothing on the screens; Simple Mode’s window runs them; Pro Mode again, the phone is still refused the lower third', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const thirdId = await makeLowerThird(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  // The network and the phone's pairing are Pro Mode's (Simple Mode changes neither).
  const { base, port } = await networkOn(win);
  // A script's token first: a pairing code is one at a time.
  const script = await pairToken(win, port, 'remote', 'Placeholder script');
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  // The placeholder playlist open as Drashti switches: Simple Mode's one playlist (Part 18).
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(
    show.playlistId,
  );
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // What is live, it reads, in Simple Mode too.
    for (const path of ['/api/v1/state', '/api/v1/hall', '/api/v1/status'])
      expect((await apiCall(port, path, { token: script })).status, path).toBe(200);

    // A lower third, a message filled in, the stage message and a timer, as a script and the phone's page ask:
    // refused in words, nothing on the screens.
    const fromScript = { win, port, token: script };
    const fromPhone = { win, page: p };
    await expectPhoneRefuses(fromScript, 'GET', '/api/v1/lower-thirds', undefined, 'computer');
    await expectPhoneRefuses(fromScript, 'POST', `/api/v1/lower-thirds/${thirdId}/show`, {}, 'computer');
    expect((await state(win)).layers.lowerThird).toBeNull();
    await expect(output.getByTestId('lower-third-layer')).toHaveCount(0);
    const message = await firstMessage(win);
    await expectPhoneRefuses(
      fromScript,
      'POST',
      `/api/v1/messages/${message}/show`,
      { values: { plate: 'AB 123' } },
      'computer',
    );
    expect((await state(win)).layers.messages).toEqual([]);
    await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);
    await expectPhoneRefuses(
      fromScript,
      'POST',
      '/api/v1/stage-message',
      { text: 'Placeholder: five minutes' },
      'simple',
    );
    expect((await state(win)).stageMessage).toBeNull();
    const timers = (await state(win)).timers;
    await expectPhoneRefuses(
      fromScript,
      'POST',
      `/api/v1/timers/${timers[0]?.id ?? 'none'}/start`,
      {},
      'simple',
    );
    expect((await state(win)).timers.every((t) => t.startedAt === null)).toBe(true);

    // Next, a row of its playlist and Clear all from the phone: refused in Simple Mode's words, nothing up.
    const rows = await rowsOf(win, show.playlistId);
    const welcomeRow = rows.find((r) => r.kind === 'presentation' && r.presentationId === show.welcomeId);
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/trigger/next', {}, 'simple');
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/trigger/item',
      { playlistId: show.playlistId, itemId: welcomeRow?.id ?? '' },
      'simple',
    );
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/trigger/slide',
      { presentationId: show.kirtanId, slideIndex: 3 },
      'simple',
    );
    expect((await where(win)).presentationId).toBeNull();

    // Simple Mode's window (moved from the phone): Next with nothing up starts its playlist; Next goes on into the
    // kirtan.
    const right = simple.getByTestId('column-right');
    const middle = simple.getByTestId('column-middle');
    await right.getByTestId('show-next').click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.welcomeId, slideIndex: 0 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder welcome to the sabha');
    await right.getByTestId('show-next').click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 0 });
    // A row of its playlist: one of the kirtan's slides goes up, and Next goes on from it.
    await middle
      .getByTestId('slide-thumb')
      .filter({ hasText: `${KIRTAN}_4` })
      .click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 3 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder second verse');
    await right.getByTestId('show-next').click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 4 });
    // The picture's row: up as the background, as one click on it in the window puts it up.
    await middle.getByTestId('playlist-item').filter({ hasText: PICTURE }).click();
    await expect
      .poll(async () => {
        const bg = (await state(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.pictureMediaId);

    // Clear all from the phone: refused; from Simple Mode's window: everything off.
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/all', {}, 'simple');
    await simple.getByTestId('simple-buttons').getByTestId('simple-clear-all').click();
    await expect.poll(async () => (await state(win)).layers.background).toBeNull();
    expect((await state(win)).layers.slide).toBeNull();
    await expect(output.locator('[data-layer="slide"]')).toHaveCount(0);

    // Pro Mode again (its double-click): the phone is still refused the lower third (alpha.23: before, it showed it);
    // the window shows it.
    await win.getByTestId('simple-leave').dblclick();
    await expect(simple).toHaveCount(0);
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/lower-thirds/${thirdId}/show`, {}, 'computer');
    expect((await state(win)).layers.lowerThird).toBeNull();
    const shown = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.lowerThirds.show(id),
      thirdId,
    );
    expect(shown).toMatchObject({ ok: true });
    await expect.poll(async () => (await state(win)).layers.lowerThird?.lines[0]).toBe('Placeholder Speaker');
    await expect(output.getByTestId('lower-third-layer')).toBeVisible();
  } finally {
    await phone.close();
  }
  await app.close();
});

test('with Simple access, a phone is refused the same in words naming no way to Pro Mode, whatever mode the window asks for, and Next too; the window’s Next still works', async () => {
  test.setTimeout(240_000);
  const { app, access: list } = await launchApp(NETWORK_ENV, undefined, { as: { gmail: SIMPLE_PERSON } });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const thirdId = await makeLowerThird(win);
    await setUpScreen(win);
    const output = await outputPage(app);
    // Pro access to begin with: the network on and the phone paired; the placeholder playlist open.
    const { base, port } = await networkOn(win);
    // A script's token first: a pairing code is one at a time.
    const script = await pairToken(win, port, 'remote', 'Placeholder script');
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
    const phone = await device('chromium');
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      // The owner gives this Gmail Simple: at its next check (every 15 s), Simple Mode, with no way to Pro Mode.
      list.setMode(SIMPLE_PERSON, 'simple');
      const simple = win.getByTestId('simple-mode');
      await expect(simple).toBeVisible({ timeout: 25_000 });
      await expect(win.getByTestId('simple-access')).toContainText('Simple Mode only');

      // Refused in words that name no way to Pro Mode.
      const fromScript = { win, port, token: script };
      for (const words of ['simple', 'computer'] as const)
        expect(PHONE_REFUSAL[words]).not.toMatch(/double-click|Pro Mode/u);
      await expectPhoneRefuses(fromScript, 'POST', `/api/v1/lower-thirds/${thirdId}/show`, {}, 'computer');
      expect((await state(win)).layers.lowerThird).toBeNull();
      await expect(output.getByTestId('lower-third-layer')).toHaveCount(0);

      // The window asks for Pro Mode: refused, and the phone is still refused.
      const asked = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
      expect(asked.ok).toBe(false);
      await expect(simple).toBeVisible();
      await expectPhoneRefuses(
        fromScript,
        'POST',
        '/api/v1/stage-message',
        { text: 'Placeholder: five minutes' },
        'simple',
      );
      expect((await state(win)).stageMessage).toBeNull();

      // Next from the phone: refused in Simple Mode's words; the window's Next (moved from the phone) still starts
      // Simple Mode's playlist.
      await expectPhoneRefuses({ win, page: p }, 'POST', '/api/v1/trigger/next', {}, 'simple');
      expect((await where(win)).presentationId).toBeNull();
      await simple.getByTestId('column-right').getByTestId('show-next').click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.welcomeId, slideIndex: 0 });
    } finally {
      await phone.close();
    }
  } finally {
    await app.close();
  }
});

test('a Simple Mode phone is refused choosing a playlist’s rows, the time bar and the video and picture rows’ When it ends, Rename and Remove, in words; Simple Mode’s window pauses, seeks and plays, and edits the rows', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win, { video: true });
  // Another playlist inside a folder, and a pin on the quick bar (Pro Mode’s).
  const other = await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const folder = await d.playlists.create('Placeholder evenings', null, true);
    if (!folder.ok) throw new Error(folder.message);
    const made = await d.playlists.create('Placeholder other evening', folder.ids[0] ?? null, false);
    if (!made.ok) throw new Error(made.message);
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
    if (!added.ok) throw new Error(added.message);
    await d.quickBar.set([{ kind: 'media', mediaId, media: 'image', label: 'Placeholder backdrop' }]);
    return made.ids[0] ?? '';
  }, show.pictureMediaId);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  const phone = await device('chromium');
  const p = phone.page;
  const items = () => rowsOf(win, show.playlistId);
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const asks = { win, page: p };
    // Pro Mode: every playlist read (the phone puts up a PowerPoint or a PDF from one); the quick bar refused.
    const lists = await phoneAsks(p, 'GET', '/api/v1/playlists');
    expect(lists.status).toBe(200);
    expect(JSON.stringify(lists.json['playlists'])).toContain('Placeholder other evening');
    await expectPhoneRefuses(asks, 'GET', '/api/v1/quick-bar', undefined, 'computer');

    // Simple Mode: the playlists and their rows refused in Simple Mode's words.
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    await expectPhoneRefuses(asks, 'GET', '/api/v1/playlists', undefined, 'simple');
    await expectPhoneRefuses(asks, 'GET', `/api/v1/playlists/${show.playlistId}/items`, undefined, 'simple');
    await expectPhoneRefuses(asks, 'GET', `/api/v1/playlists/${other}/items`, undefined, 'simple');

    // When it ends on the video's row: the phone's refused; each of the four set in Simple Mode's window (moved from
    // the phone) is saved in Drashti.
    const videoRow = (await items()).find((i) => i.kind === 'media' && i.mediaId === show.videoMediaId);
    if (!videoRow) throw new Error('The placeholder playlist has no video row.');
    const whenEndsNow = async () => {
      const row = (await items()).find((i) => i.id === videoRow.id);
      return row?.kind === 'media' ? (row.whenEnds ?? 'wallpaper') : null;
    };
    for (const whenEnds of ['next', 'freeze', 'wallpaper', 'loop'] as const) {
      await expectPhoneRefuses(
        asks,
        'POST',
        `/api/v1/playlist-items/${videoRow.id}/when-ends`,
        { whenEnds },
        'computer',
        items,
      );
      const set = await win.evaluate(
        ({ id, whenEnds }) => (globalThis as PageGlobals).drashti.playlists.setWhenEnds(id, whenEnds),
        { id: videoRow.id, whenEnds },
      );
      expect(set.ok).toBe(true);
      await expect.poll(whenEndsNow).toBe(whenEnds);
    }
    // Loop keeps this short test video playing for the time bar. Its row from the phone: refused; in the window: up.
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/trigger/item',
      { playlistId: show.playlistId, itemId: videoRow.id },
      'simple',
    );
    const middle = simple.getByTestId('column-middle');
    await middle.getByTestId('playlist-item').filter({ hasText: VIDEO }).click();
    await expect
      .poll(async () => {
        const bg = (await state(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.videoMediaId);
    const seek = async () => {
      const background = (await state(win)).layers.background;
      return background?.kind === 'media' ? background.seek : undefined;
    };
    // The time bar from the phone: refused (a command, in Simple Mode's words); from the window: pause, seek, play.
    const playing = { layer: 'background' } as const;
    await expectPhoneRefuses(asks, 'POST', '/api/v1/playing/pause', { playing }, 'simple');
    await expectPhoneRefuses(asks, 'POST', '/api/v1/playing/move', { playing, toMs: 0 }, 'simple');
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/skip',
      { layer: 'background', jump: 'forward' },
      'simple',
    );
    expect((await seek())?.paused).toBeUndefined();
    const run = (command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) =>
      win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
    await run({ type: 'pausePlaying', playing });
    await expect.poll(async () => (await seek())?.paused).toBe(true);
    await run({ type: 'moveTo', playing, toMs: 0 });
    await expect.poll(async () => (await seek())?.toMs).toBe(0);
    await run({ type: 'moveTo', playing, toMs: 1500 });
    await expect.poll(async () => (await seek())?.toMs ?? 0).toBeGreaterThan(1200);
    expect((await seek())?.paused).toBe(true);
    await expectPhoneRefuses(asks, 'POST', '/api/v1/playing/play', { playing }, 'simple');
    await run({ type: 'resumePlaying', playing });
    await expect.poll(async () => (await seek())?.paused).toBeUndefined();

    // The picture's row: looking at it, its Save picture, Rename and Remove from the phone refused; Remove (with Undo)
    // and Rename in Simple Mode's window.
    const pictureRow = (await items()).find((i) => i.kind === 'media' && i.mediaId === show.pictureMediaId);
    if (!pictureRow) throw new Error('The placeholder playlist has no picture row.');
    await expectPhoneRefuses(asks, 'GET', `/api/v1/media/${show.pictureMediaId}/look`, undefined, 'media');
    await expectPhoneRefuses(
      asks,
      'GET',
      `/api/v1/media/${show.pictureMediaId}/original`,
      undefined,
      'media',
    );
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/playlist-items/delete',
      { ids: [pictureRow.id] },
      'computer',
      items,
    );
    const before = (await items()).map((i) => i.id);
    const removed = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.playlists.removeItems([id]),
      pictureRow.id,
    );
    expect(removed.ok).toBe(true);
    await expect.poll(async () => (await items()).length).toBe(before.length - 1);
    const restored = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.playlists.restoreItems([id]),
      pictureRow.id,
    );
    expect(restored.ok).toBe(true);
    await expect.poll(async () => (await items()).map((i) => i.id)).toEqual(before);
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/media/${show.pictureMediaId}/rename`,
      { name: 'Placeholder backdrop, simple' },
      'media',
    );
    const renamed = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.media.rename(id, 'Placeholder backdrop, simple'),
      show.pictureMediaId,
    );
    expect(renamed).toMatchObject({ ok: true });
    await expect(
      middle.getByTestId('playlist-item').filter({ hasText: 'Placeholder backdrop, simple' }),
    ).toBeVisible();

    // The other playlist's picture row from the phone: refused; the computer's own selection as it was.
    const otherRow = (await rowsOf(win, other))[0];
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/trigger/item',
      { playlistId: other, itemId: otherRow?.id ?? '' },
      'simple',
    );
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
    expect((await state(win)).live.playlist?.playlistId).not.toBe(other);

    // A folder and a playlist in it: the phone's refused; made in Simple Mode's window (moved from the phone).
    const tree = () => win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/playlists/new',
      { name: 'Placeholder phone evenings', isFolder: true },
      'computer',
      tree,
    );
    const nested = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const folder = await d.playlists.create('Placeholder phone evenings', null, true);
      if (!folder.ok) throw new Error(folder.message);
      const made = await d.playlists.create('Placeholder phone gathering', folder.ids[0] ?? null, false);
      if (!made.ok) throw new Error(made.message);
      return { folder: folder.ids[0] ?? '', list: made.ids[0] ?? '' };
    });
    const madeTree = await tree();
    expect(madeTree.find((n) => n.id === nested.list)).toMatchObject({
      name: 'Placeholder phone gathering',
      parentId: nested.folder,
    });
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a Simple Mode phone is refused Audio in words: an audio playlist made, its tracks added, moved, removed and put back, its options, a track played, paused and renamed, the playlist renamed, deleted and put back; Simple Mode’s window does each', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-simple-phone-audio-'));
  const [first = '', second = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder first tone.wav'), { seconds: 30, hz: 300 }),
    makeTestTone(join(dir, 'Placeholder second tone.wav'), { seconds: 30, hz: 400 }),
  ]);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const phone = await device('chromium');
  const p = phone.page;
  const music = () => win.evaluate(() => (globalThis as PageGlobals).drashti.music.view());
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const asks = { win, page: p };
    // The phone's Audio (its More before alpha.23): refused in words, Audio as it was.
    await expectPhoneRefuses(asks, 'GET', '/api/v1/music', undefined, 'media');
    await expectPhoneRefuses(
      asks,
      'POST',
      '/api/v1/music/new',
      { name: 'Placeholder phone audio' },
      'media',
      music,
    );
    // In Simple Mode's window (moved from the phone): made, its two tones added.
    const made = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.music.create('Placeholder phone audio'),
    );
    if (!made.ok) throw new Error(made.message);
    const id = made.id ?? made.view.playlists[0]?.id ?? '';
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/music/${id}/tracks/add`,
      { mediaIds: [first] },
      'media',
      music,
    );
    const add = await win.evaluate(
      ({ id, first, second }) =>
        (globalThis as PageGlobals).drashti.music.addTracks(id, [first, second], null),
      { id, first, second },
    );
    expect(add.ok).toBe(true);
    const tracks = async () => (await music()).playlists[0]?.tracks ?? [];
    await expect.poll(async () => (await tracks()).length).toBe(2);
    // The second moved up, then removed, and put back (Undo).
    const secondTrack = (await tracks())[1]?.id ?? '';
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/music/tracks/${secondTrack}/move`,
      { to: 0 },
      'media',
      music,
    );
    const moved = await win.evaluate(
      (trackId) => (globalThis as PageGlobals).drashti.music.moveTrack(trackId, 0),
      secondTrack,
    );
    expect(moved.ok).toBe(true);
    await expect.poll(async () => (await tracks())[0]?.name).toContain('Placeholder second tone');
    await expectPhoneRefuses(asks, 'POST', `/api/v1/music/tracks/${secondTrack}/delete`, {}, 'media', music);
    const out = await win.evaluate(
      (trackId) => (globalThis as PageGlobals).drashti.music.removeTrack(trackId),
      secondTrack,
    );
    expect(out.ok).toBe(true);
    await expect.poll(async () => (await tracks()).length).toBe(1);
    const back = await win.evaluate(
      (trackId) => (globalThis as PageGlobals).drashti.music.restoreTrack(trackId, 0),
      secondTrack,
    );
    expect(back.ok).toBe(true);
    await expect.poll(async () => (await tracks()).length).toBe(2);
    // Music steps aside, Loop and Shuffle: the phone's refused; the options set in the window.
    await expectPhoneRefuses(asks, 'POST', '/api/v1/music/steps-aside', { on: false }, 'media');
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/music/${id}/options`,
      { loop: false, shuffle: true },
      'media',
      music,
    );
    const options = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.music.setOptions(id, { loop: false, shuffle: true }),
      id,
    );
    expect(options.ok).toBe(true);
    await expect.poll(async () => (await music()).playlists[0]).toMatchObject({ loop: false, shuffle: true });
    const unshuffled = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.music.setOptions(id, { loop: false, shuffle: false }),
      id,
    );
    expect(unshuffled.ok).toBe(true);
    // A track played, paused and played on: the phone's refused; the window's.
    await expectPhoneRefuses(asks, 'POST', '/api/v1/music/play', { playlistId: id, index: 1 }, 'media');
    expect((await state(win)).layers.audio ?? null).toBeNull();
    const played = await win.evaluate((id) => (globalThis as PageGlobals).drashti.music.play(id, 1), id);
    expect(played.ok).toBe(true);
    await expect.poll(async () => (await state(win)).layers.audio?.title).toContain('Placeholder first tone');
    await expectPhoneRefuses(asks, 'POST', '/api/v1/music/pause', {}, 'simple');
    const run = (command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) =>
      win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
    await run({ type: 'pauseMusic' });
    await expect.poll(async () => (await state(win)).layers.audio?.pausedAtMs).toBeDefined();
    await run({ type: 'resumeMusic' });
    await expect.poll(async () => (await state(win)).layers.audio?.pausedAtMs).toBeUndefined();
    // A track renamed by its file's Rename, and the playlist renamed, deleted and put back (the phone's refused).
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/media/${first}/rename`,
      { name: 'Placeholder renamed tone' },
      'media',
      music,
    );
    const renamed = await win.evaluate(
      (mediaId) => (globalThis as PageGlobals).drashti.media.rename(mediaId, 'Placeholder renamed tone'),
      first,
    );
    expect(renamed).toMatchObject({ ok: true });
    await expect
      .poll(async () => (await tracks()).some((t) => t.name === 'Placeholder renamed tone'))
      .toBe(true);
    await expectPhoneRefuses(
      asks,
      'POST',
      `/api/v1/music/${id}/rename`,
      { name: 'Placeholder renamed audio' },
      'media',
      music,
    );
    const name = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.music.rename(id, 'Placeholder renamed audio'),
      id,
    );
    expect(name.ok).toBe(true);
    await expect.poll(async () => (await music()).playlists[0]?.name).toBe('Placeholder renamed audio');
    await expectPhoneRefuses(asks, 'POST', `/api/v1/music/${id}/delete`, {}, 'media', music);
    const gone = await win.evaluate((id) => (globalThis as PageGlobals).drashti.music.remove(id), id);
    expect(gone.ok).toBe(true);
    await expect.poll(async () => (await music()).playlists).toHaveLength(0);
    await expectPhoneRefuses(asks, 'POST', `/api/v1/music/${id}/restore`, {}, 'media', music);
    const kept = await win.evaluate((id) => (globalThis as PageGlobals).drashti.music.restore(id), id);
    expect(kept.ok).toBe(true);
    await expect.poll(async () => (await music()).playlists[0]?.name).toBe('Placeholder renamed audio');
  } finally {
    await phone.close();
    await app.close();
  }
});
