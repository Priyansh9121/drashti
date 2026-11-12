import { longPress } from './phone-gestures';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NEW_LOWER_THIRD } from '../../src/shared/lower-thirds';
import { apiCall, device, networkOn, NETWORK_ENV, pairByQr, pairingCode, pairToken } from './devices';
import { importAndGetIds, launchApp, operatorPage, operatorReady, outputPage, type PageGlobals, setUpScreen } from './helpers';
import { KIRTAN, PICTURE, PLAYLIST, setUpPlaceholderShow, VIDEO } from './placeholder-show';
import { makeTestTone } from './test-media';

/*
 * A paired phone on a computer in Simple Mode (Session 55, the owner's answer of 30 Oct 2026): it does only what Simple
 * Mode's window does, and the main process refuses the rest. A lower third, a message, the stage message and a timer
 * asked for are refused in words (a script's requests here: since Part 9 the phone itself no longer offers them in
 * Simple Mode, saying why once), and nothing of them reaches the screens; Next, a row of Simple Mode's playlist and its
 * slides, and Clear all work as in the window. Back in Pro Mode the phone shows the lower third again. With Simple
 * access (Part 19) the same, in its own words, whatever mode the window asks for. A phone can choose a playlist, use
 * the time bar, and use the video row's When it ends and the row's Rename and Delete with Undo. Placeholder content;
 * codes and tokens made at run time.
 */

const SIMPLE_PERSON = 'simple.phone.placeholder@example.com';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** Where the show is: the live presentation and slide position. */
async function where(win: Page) {
  const s = await state(win);
  return { presentationId: s.live.presentationId, slideIndex: s.layers.slide?.slideIndex ?? null };
}

/** A lower third made in Drashti (Pro Mode's Lower Thirds), for the phone to ask for. */
const makeLowerThird = (win: Page) =>
  win.evaluate(
    async (input) => {
      const saved = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, input);
      if (!saved.ok) throw new Error(saved.message);
    },
    {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    },
  );

/** The phone's refusal, as it shows it at the top of its page. */
const refusal = (phone: Page) =>
  phone.getByRole('alert').filter({ hasText: 'Simple Mode on Drashti’s computer' });

/** A script's request (a paired Remote's token), refused in these words: its status and message. */
async function refusedToScript(port: number, token: string, path: string, body?: unknown): Promise<string> {
  const r = await apiCall(port, path, { method: 'POST', token, body });
  expect(r.status, path).toBe(403);
  return String(r.json['message']);
}

/** What Simple Mode's window does not have, hidden on the phone's More (Part 9). */
async function moreHidesProParts(phone: Page): Promise<void> {
  await phone.getByTestId('remote-tab-more').click();
  for (const part of [
    'remote-lower-thirds',
    'remote-messages',
    'remote-stage',
    'remote-timers',
    'remote-open-screens',
    'remote-open-library',
  ])
    await expect(phone.getByTestId(part), part).toHaveCount(0);
  await expect(phone.getByTestId('remote-music')).toBeVisible();
}

test('a phone on a computer in Simple Mode does only what Simple Mode’s window does: a lower third, a message, the stage message and a timer refused in words with nothing on the screens; Next, a row of its playlist and Clear all work; Pro Mode again, the lower third shows', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  await makeLowerThird(win);
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
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(
    show.playlistId,
  );
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');

    // The phone says once what it can do in Simple Mode and how the computer returns to Pro Mode.
    const note = p.getByTestId('remote-simple');
    await expect(note).toContainText('(playlists, playback and Audio)');
    await expect(note).toContainText('On the Drashti computer, a double-click on Pro Mode leaves it.');
    await expect(note).not.toContainText('access is Simple Mode only');
    // No lower thirds, messages, stage message or timers on its More: Simple Mode's window has none.
    await moreHidesProParts(p);

    // Asked for all the same (a script's requests): refused in words, nothing on the screens.
    const third = (await apiCall(port, '/api/v1/lower-thirds', { token: script })).json['lowerThirds'] as {
      id: string;
    }[];
    const words = await refusedToScript(port, script, `/api/v1/lower-thirds/${third[0]?.id ?? 'none'}/show`);
    expect(words).toContain('(playlists, playback and Audio)');
    expect(words).toContain('On the Drashti computer, a double-click on Pro Mode leaves it.');
    expect((await state(win)).layers.lowerThird).toBeNull();
    await expect(output.getByTestId('lower-third-layer')).toHaveCount(0);
    // A message filled in: refused, none on the screens.
    const templates = (await apiCall(port, '/api/v1/messages', { token: script })).json['messages'] as {
      id: string;
    }[];
    await refusedToScript(port, script, `/api/v1/messages/${templates[0]?.id ?? 'none'}/show`, {
      values: { plate: 'AB 123' },
    });
    expect((await state(win)).layers.messages).toEqual([]);
    await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);
    // The stage message: refused, none on the stage screens.
    await refusedToScript(port, script, '/api/v1/stage-message', { text: 'Placeholder: five minutes' });
    expect((await state(win)).stageMessage).toBeNull();
    // A timer started: refused (Simple Mode has no timers), it does not count.
    const timers = (await state(win)).timers;
    await refusedToScript(port, script, `/api/v1/timers/${timers[0]?.id ?? 'none'}/start`);
    expect((await state(win)).timers.every((t) => t.startedAt === null)).toBe(true);

    // Next with nothing up starts Simple Mode's playlist, as its window's Next does; Next goes on into the kirtan.
    await p.getByTestId('remote-tab-playlist').click();
    await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
    await expect(
      p.locator('[data-testid="remote-item"][data-kind="group"]').filter({ hasText: KIRTAN }),
    ).toBeVisible();
    const next = p.getByTestId('remote-next-button');
    await next.click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.welcomeId, slideIndex: 0 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder welcome to the sabha');
    await next.click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 0 });

    // A row of its playlist: the kirtan's slides are rows on the phone (Part 9), one tapped goes up, and Next goes on
    // from it.
    await p
      .getByTestId('remote-row')
      .filter({ hasText: `${KIRTAN}_4` })
      .click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 3 });
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder second verse');
    await next.click();
    await expect.poll(() => where(win)).toEqual({ presentationId: show.kirtanId, slideIndex: 4 });
    // The picture's row: up as the background, as one click on it in the window puts it up.
    await p.getByTestId('remote-item').filter({ hasText: PICTURE }).click();
    await expect
      .poll(async () => {
        const bg = (await state(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.pictureMediaId);
    await expect(refusal(p)).toHaveCount(0);

    // Clear all: everything off, as its window's Clear all.
    await p.getByTestId('remote-tab-show').click();
    await p.getByTestId('remote-actions').getByRole('button', { name: 'Clear all' }).click();
    await expect.poll(async () => (await state(win)).layers.background).toBeNull();
    expect((await state(win)).layers.slide).toBeNull();
    await expect(output.locator('[data-layer="slide"]')).toHaveCount(0);

    // Pro Mode again (its double-click): the phone shows the lower third, as before, and its note goes.
    await win.getByTestId('simple-leave').dblclick();
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    await expect(note).toHaveCount(0);
    await p.getByTestId('remote-tab-more').click();
    const shown = p.getByTestId('remote-lower-third').filter({ hasText: 'Placeholder Speaker' });
    await expect(shown).toContainText('Placeholder title');
    await shown.getByRole('button', { name: 'Show' }).click();
    await expect.poll(async () => (await state(win)).layers.lowerThird?.lines[0]).toBe('Placeholder Speaker');
    await expect(output.getByTestId('lower-third-layer')).toBeVisible();
    await expect(refusal(p)).toHaveCount(0);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('with Simple access, a phone is refused the same in words naming no way to Pro Mode, whatever mode the window asks for, and Next still works', async () => {
  test.setTimeout(240_000);
  const { app, access: list } = await launchApp(NETWORK_ENV, undefined, { as: { gmail: SIMPLE_PERSON } });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    await makeLowerThird(win);
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
      await expect(win.getByTestId('simple-mode')).toBeVisible({ timeout: 25_000 });
      await expect(win.getByTestId('simple-access')).toContainText('Simple Mode only');

      // The phone's note names no way to Pro Mode; More shows none of what Simple Mode's window has not.
      const note = p.getByTestId('remote-simple');
      await expect(note).toContainText('whose access is Simple Mode only');
      await expect(note).toContainText('(playlists, playback and Audio)');
      expect(await note.innerText()).not.toMatch(/double-click|Pro Mode/u);
      await moreHidesProParts(p);
      const third = (await apiCall(port, '/api/v1/lower-thirds', { token: script })).json['lowerThirds'] as {
        id: string;
      }[];
      const words = await refusedToScript(
        port,
        script,
        `/api/v1/lower-thirds/${third[0]?.id ?? 'none'}/show`,
      );
      expect(words).toContain('whose access is Simple Mode only');
      expect(words).toContain('(playlists, playback and Audio)');
      expect(words).not.toMatch(/double-click|Pro Mode/u);
      expect((await state(win)).layers.lowerThird).toBeNull();
      await expect(output.getByTestId('lower-third-layer')).toHaveCount(0);

      // The window asks for Pro Mode: refused, and the phone is still refused.
      const asked = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
      expect(asked.ok).toBe(false);
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      expect(
        await refusedToScript(port, script, '/api/v1/stage-message', { text: 'Placeholder: five minutes' }),
      ).toContain('whose access is Simple Mode only');
      expect((await state(win)).stageMessage).toBeNull();

      // Next still starts Simple Mode's playlist.
      await p.getByTestId('remote-tab-playlist').click();
      await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
      await p.getByTestId('remote-next-button').click();
      await expect.poll(() => where(win)).toEqual({ presentationId: show.welcomeId, slideIndex: 0 });
    } finally {
      await phone.close();
    }
  } finally {
    await app.close();
  }
});

test('a Simple Mode phone chooses a playlist, pauses, seeks and plays, and edits video and picture rows', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win, { video: true });
  // Another playlist inside a folder, and a pin on the quick bar (Pro Mode’s).
  await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const folder = await d.playlists.create('Placeholder evenings', null, true);
    if (!folder.ok) throw new Error(folder.message);
    const made = await d.playlists.create('Placeholder other evening', folder.ids[0] ?? null, false);
    if (!made.ok) throw new Error(made.message);
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
    if (!added.ok) throw new Error(added.message);
    await d.quickBar.set([{ kind: 'media', mediaId, media: 'image', label: 'Placeholder backdrop' }]);
  }, show.pictureMediaId);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  const phone = await device('chromium');
  const p = phone.page;
  const items = () =>
    win.evaluate(async (id) => (globalThis as PageGlobals).drashti.playlists.items(id), show.playlistId);
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // Pro Mode: every playlist to choose from, the other one chosen; the quick bar on the Show tab.
    await p.getByTestId('remote-tab-playlist').click();
    const other = await p
      .getByTestId('remote-playlist')
      .locator('option', { hasText: 'Placeholder other evening' })
      .getAttribute('value');
    await p.getByTestId('remote-playlist').selectOption(other ?? '');
    await p.getByTestId('remote-tab-show').click();
    await expect(p.getByTestId('remote-quick-bar')).toBeVisible();
    await expect(p.getByTestId('remote-simple')).toHaveCount(0);

    // Simple Mode opens the computer’s current playlist to start. Other playlists stay available.
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    const note = p.getByTestId('remote-simple');
    await expect(note).toContainText('(playlists, playback and Audio)');
    await p.getByTestId('remote-tab-playlist').click();
    await expect(p.getByTestId('remote-playlist')).toHaveValue(show.playlistId);
    await expect(p.getByTestId('remote-playlist').locator('option', { hasText: 'Placeholder other evening' })).toHaveCount(1);
    // Said once: put away, it stays away while Simple Mode is on.
    await note.getByRole('button', { name: 'Dismiss' }).click();
    await expect(note).toHaveCount(0);
    await p.getByTestId('remote-tab-show').click();
    await p.getByTestId('remote-tab-playlist').click();
    await expect(note).toHaveCount(0);
    // No quick bar (Simple Mode's window has none).
    await p.getByTestId('remote-tab-show').click();
    await expect(p.getByTestId('remote-quick-bar')).toHaveCount(0);

    // The four choices in When it ends are available on the video’s row, and each is saved in Drashti.
    await p.getByTestId('remote-tab-playlist').click();
    const videoRow = p.locator('[data-testid="remote-item"][data-kind="media"]').filter({ hasText: VIDEO });
    const menu = p.getByTestId('remote-row-menu');
    for (const whenEnds of ['next', 'freeze', 'wallpaper', 'loop'] as const) {
      await longPress(videoRow);
      await expect(menu.locator('[data-testid^="remote-menu-when-"]')).toHaveCount(4);
      await menu.getByTestId('remote-menu-when-' + whenEnds).click();
      await expect
        .poll(async () => (await items()).find((i) => i.kind === 'media' && i.mediaId === show.videoMediaId))
        .toMatchObject({ whenEnds });
    }
    // Loop keeps this short test video available for the time bar checks.
    await videoRow.click();
    await expect
      .poll(async () => {
        const bg = (await state(win)).layers.background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.videoMediaId);
    await p.getByTestId('remote-tab-show').click();
    const seek = async () => {
      const background = (await state(win)).layers.background;
      return background?.kind === 'media' ? background.seek : undefined;
    };
    await p.getByTestId('remote-time-bar-pause').click();
    await expect.poll(async () => (await seek())?.paused).toBe(true);
    const bar = p.getByRole('slider', { name: 'Time of the background video' });
    const box = await bar.boundingBox();
    if (!box) throw new Error('The phone’s time bar is missing.');
    await bar.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
    await expect.poll(async () => (await seek())?.toMs ?? 0).toBeGreaterThan(1200);
    expect((await seek())?.paused).toBe(true);
    await p.getByTestId('remote-time-bar-play').click();
    await expect.poll(async () => (await seek())?.paused).toBeUndefined();
    await expect(p.getByTestId('remote-skip-background-forward')).toHaveCount(0);

    // The picture’s long press offers looking, saving, Rename and Delete.
    await p.getByTestId('remote-tab-playlist').click();
    const pictureRow = p
      .locator('[data-testid="remote-item"][data-kind="media"]')
      .filter({ hasText: PICTURE });
    await longPress(pictureRow);
    await expect(menu.locator('[data-testid^="remote-menu-"]')).toHaveText([
      /Look at it on this phone/u,
      /Save picture/u,
      /Rename/u,
      /Remove from playlist/u,
    ]);
    // Remove: out of Simple Mode's playlist, and Undo puts it back.
    const before = (await items()).map((i) => i.id);
    await menu.getByTestId('remote-menu-remove').click();
    await expect(pictureRow).toHaveCount(0);
    await expect.poll(async () => (await items()).length).toBe(before.length - 1);
    await p.getByTestId('remote-rows-undo').click();
    await expect.poll(async () => (await items()).map((i) => i.id)).toEqual(before);
    // Rename…: the picture its playlist holds.
    await longPress(pictureRow);
    await menu.getByTestId('remote-menu-rename').click();
    await p.getByTestId('remote-rename').getByRole('textbox').fill('Placeholder backdrop, simple');
    await p.getByTestId('remote-rename-save').click();
    await expect(
      p
        .locator('[data-testid="remote-item"][data-kind="media"]')
        .filter({ hasText: 'Placeholder backdrop, simple' }),
    ).toBeVisible();
    await expect(refusal(p)).toHaveCount(0);

    // Choosing a nested playlist on the phone leaves the computer’s own selection alone.
    await p.getByTestId('remote-playlist').selectOption(other ?? '');
    await expect(pictureRow).toBeVisible();
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
    await pictureRow.click();
    await expect.poll(async () => (await state(win)).live.playlist?.playlistId).toBe(other);
    await expect(p.getByTestId('remote-playlist')).toHaveValue(other ?? '');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a Simple Mode phone manages Audio and plays a chosen track', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-simple-phone-audio-'));
  await importAndGetIds(win, [
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
    await p.getByTestId('remote-tab-more').click();
    const audio = p.getByTestId('remote-music');
    await audio.getByTestId('remote-audio-new').click();
    await p.getByTestId('remote-audio-name').fill('Placeholder phone audio');
    await p.getByRole('button', { name: 'Create audio playlist', exact: true }).click();
    const editor = p.getByTestId('remote-audio-editor');
    const track = editor.getByTestId('remote-audio-track');
    for (const name of ['Placeholder first tone', 'Placeholder second tone']) {
      await editor.getByTestId('remote-audio-add').click();
      await p.getByTestId('remote-audio-library').getByRole('button', { name: new RegExp(name, 'u') }).click();
      await expect(track.filter({ hasText: name })).toBeVisible();
    }
    await track.nth(1).getByRole('button', { name: 'Move up', exact: true }).click();
    await expect.poll(async () => (await music()).playlists[0]?.tracks[0]?.name).toContain('Placeholder second tone');
    await track.first().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(track).toHaveCount(1);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(track).toHaveCount(2);
    await editor.getByRole('button', { name: 'Loop', exact: true }).click();
    await editor.getByRole('button', { name: 'Shuffle', exact: true }).click();
    await expect.poll(async () => (await music()).playlists[0]).toMatchObject({ loop: true, shuffle: true });
    await editor.getByRole('button', { name: 'Shuffle', exact: true }).click();
    await track.nth(1).getByRole('button', { name: 'Play track', exact: true }).click();
    await expect.poll(async () => (await state(win)).layers.audio?.title).toContain('Placeholder first tone');
    await audio.getByRole('button', { name: 'Pause music', exact: true }).click();
    await expect.poll(async () => (await state(win)).layers.audio?.pausedAtMs).toBeDefined();
    await audio.getByRole('button', { name: 'Play music', exact: true }).click();
    await expect.poll(async () => (await state(win)).layers.audio?.pausedAtMs).toBeUndefined();
    await editor.getByRole('button', { name: 'Rename playlist', exact: true }).click();
    await p.getByTestId('remote-audio-name').fill('Placeholder renamed audio');
    await p.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect.poll(async () => (await music()).playlists[0]?.name).toBe('Placeholder renamed audio');
    await editor.getByRole('button', { name: 'Delete playlist', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await music()).playlists).toHaveLength(0);
    await audio.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await music()).playlists[0]?.name).toBe('Placeholder renamed audio');
  } finally {
    await phone.close();
    await app.close();
  }
});
