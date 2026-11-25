import type { Page } from '@playwright/test';
import { chromium, expect, test, webkit } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LowerThirdInput, NEW_LOWER_THIRD } from '../../src/shared/lower-thirds';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  apiCall,
  device,
  type Engine,
  networkOn,
  NETWORK_ENV,
  pairByQr,
  pairingCode,
  pairToken,
} from './devices';
import {
  importAndGetIds,
  launchApp,
  openSection,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';
import { expectPhoneRefuses } from './phone-refuses';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * The phone as a mirror of the operator window (Session 54, D5): the clears in the desktop's order with its keys'
 * names, each lit while its layer is up and clearing it (the Wallpaper in the Logo's place, Session 55); the library's
 * media, the stage message, a timer alone, a lower third and an audio playlist, each put up and taken off from the
 * phone and seen on both sides as it changes (props and the idle rotation went in Session 55); laid out for a phone
 * and a tablet (375 × 812, 768 × 1024 and held sideways) in Safari's
 * engine and Chrome's, with axe, 44 px targets and nothing off the side; and none of it for a Stage or Announcements
 * device. Under the phone rule (alpha.23, QA23-PHONE-1, the owner: "no video access in either of simple or pro mode in
 * phone, they cant change videos, only ppts an pdfs"; "Only PPT and PDF") every one of the phone's requests for them is
 * refused in its group's words, nothing changed: what each did moved to the operator window (its own bottom bar, its
 * Stage section, LIVE and the window's bridge for the rest), every desk assertion kept. The phone's page still lays
 * itself out at each size (its own controls are the UI builder's) and still draws what is live. Placeholder content
 * and generated media only; codes and tokens made at run time.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
const layers = async (win: Page) => (await snapshot(win)).state.layers;

const dispatch = (win: Page, command: unknown) =>
  win.evaluate(async (c) => {
    const r = await (globalThis as PageGlobals).drashti.engine.dispatch(c as never);
    if (!r.ok) throw new Error(r.message);
  }, command);

/** A media item's id by the start of its name. */
const mediaId = (win: Page, name: string) =>
  win.evaluate(async (n) => {
    const media = await (globalThis as PageGlobals).drashti.library.listMedia();
    return media.find((m) => m.name.startsWith(n))?.id ?? '';
  }, name);

/** Every visible control under 44 × 44 CSS pixels (as phone-pages.spec.ts measures them). */
const tooSmall = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]',
      ),
    ]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30),
        r: el.getBoundingClientRect(),
      }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ name, r }) => `${name} (${String(Math.round(r.width))} × ${String(Math.round(r.height))})`),
  );

/** Whatever reaches past the page's right edge, or makes a scrolling part scroll sideways. */
const offTheSide = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolls = [document.scrollingElement, ...document.querySelectorAll('main, main *')].filter(
      (el): el is Element =>
        el !== null &&
        el.scrollWidth > el.clientWidth + 1 &&
        ['auto', 'scroll'].includes(getComputedStyle(el).overflowX),
    );
    const past = [...document.querySelectorAll<HTMLElement>('button, input, select, h2')].filter(
      (el) => el.offsetParent !== null && el.getBoundingClientRect().right > width + 1,
    );
    return [...scrolls, ...past].map((el) => `${el.tagName} ${el.textContent.trim().slice(0, 30)}`);
  });

/** The operator window's own bottom bar, as its buttons read (words and keys), its ? left out (D5 review). */
const windowClearWords = (win: Page) =>
  win
    .locator('[data-testid="layer-bar"] button:not([data-testid^="what-is-this"])')
    .evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).innerText.replace(/\s+/gu, ' ').trim()));

/** How late the phone hears Drashti in the clears' test: a phone on a busy Wi-Fi (x58). */
const FEED_LATE_MS = 400;

/**
 * Everything Drashti says to the phone over its state feed reaches it `ms` late, in order, as over a busy Wi-Fi; what
 * the phone says goes at once (x58: CI's Mac once read the phone's clears before its feed had said the Wallpaper was
 * off, while the window's own bar already had).
 */
async function feedComesLate(page: Page, ms: number): Promise<void> {
  await page.routeWebSocket(/\/api\/v1\/feed$/u, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      server.send(message);
    });
    server.onMessage((message) => {
      // The late Wi-Fi itself, never a wait of the test's.
      setTimeout(() => {
        ws.send(message);
      }, ms);
    });
  });
}

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the phone’s clears are refused in words, each layer’s, Clear all, Put it back, the Wallpaper and Black-out; the window’s own bottom bar, in its order with its keys’ names, lights and clears each, the keys followed as they change (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    await setUpScreen(win);
    const output = await outputPage(app);
    const { base } = await networkOn(win);
    const phone = await device(engine);
    const p = phone.page;
    await feedComesLate(p, FEED_LATE_MS);
    try {
      await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      const fromPhone = { win, page: p };
      const bar = win.getByTestId('layer-bar');
      const clearOf = (layer: string, on = false) =>
        bar.getByRole('button', { name: `Clear ${layer}${on ? ' (on screen)' : ''}`, exact: true });
      const clearAll = bar.getByRole('button', { name: /^Clear all/u });
      // In the desktop's order, left to right (LayerBar.tsx), each with the key the window answers: the window's own
      // bar (the phone's copy of it went with the phone rule).
      await expect
        .poll(() => windowClearWords(win))
        .toEqual([
          'Clear all F1',
          'Slide F2',
          'Background F3',
          'Audio F5',
          'Messages F6',
          'Ticker F7',
          'Wallpaper F12',
          'Black-out B',
        ]);
      // The Wallpaper (Session 55, in the Logo's place): the phone's refused; moved to the window, up and off.
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/wallpaper', {}, 'media');
      await win.getByTestId('wallpaper-button').click();
      await expect.poll(async () => (await snapshot(win)).state.wallpaper).toBe(true);
      await expect(win.getByTestId('wallpaper-button')).toHaveAttribute('data-lit', 'true');
      await win.getByTestId('wallpaper-button').click();
      await expect.poll(async () => (await snapshot(win)).state.wallpaper).toBe(false);
      await expect(win.getByTestId('wallpaper-button')).not.toHaveAttribute('data-lit');
      // Black-out from the phone: refused, the show as it was.
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/blackout', {}, 'computer');
      // Read out as the desktop's are: a layer's clear by its name, dimmed with nothing up.
      await expect(clearAll).toBeDisabled();
      await expect(clearOf('slide')).toBeDisabled();

      // The slide, the background and a message up from the operator window: their clears light up.
      await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 0 });
      await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: show.pictureMediaId, media: 'image', fit: 'fit', loop: false },
      });
      await dispatch(win, {
        type: 'showMessage',
        message: { id: 'message:placeholder', text: 'Placeholder words' },
      });
      for (const layer of ['slide', 'background', 'messages'])
        await expect(clearOf(layer, true), layer).toHaveAttribute('data-lit', 'true');
      for (const layer of ['audio', 'ticker']) await expect(clearOf(layer), layer).toBeDisabled();
      await expectNoSeriousA11yIssues(
        win,
        `the clears lit in the window (${engine})`,
        '[data-testid="layer-bar"]',
      );

      // The phone's clears refused, each in its words (a kirtan is not a PowerPoint or a PDF: its slide too), nothing
      // taken off. Moved to the window: each clears its own layer, on the screens too, and goes dim.
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/slide', {}, 'noDeck');
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/messages', {}, 'computer');
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/background', {}, 'computer');
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/all', {}, 'computer');
      await clearOf('slide', true).click();
      await expect(
        output.locator('[data-layer="slide"]', { hasText: 'Placeholder chorus line' }),
      ).toHaveCount(0);
      await expect.poll(async () => (await layers(win)).slide).toBeNull();
      await clearOf('messages', true).click();
      await expect.poll(async () => (await layers(win)).messages).toEqual([]);
      await clearOf('background', true).click();
      await expect.poll(async () => (await layers(win)).background).toBeNull();
      for (const layer of ['slide', 'background', 'messages'])
        await expect(clearOf(layer), layer).toBeDisabled();

      // Clear all, then Put it back in its place (no key, as the desktop's bar), the phone's refused; then Clear all
      // again.
      await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 1 });
      await clearAll.click();
      await expect(win.getByTestId('put-back')).toHaveText('Put it back');
      await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/put-back', {}, 'computer');
      await win.getByTestId('put-back').click();
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder first verse');
      await expect(clearAll).toBeEnabled();

      // The single-letter keys turned off in Drashti: Black-out names no key, the Wallpaper keeps F12; and back.
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSingleKeys(false));
      await expect
        .poll(async () => (await windowClearWords(win)).slice(-2))
        .toEqual(['Wallpaper F12', 'Black-out']);
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSingleKeys(true));
      await expect
        .poll(async () => (await windowClearWords(win)).slice(-2))
        .toEqual(['Wallpaper F12', 'Black-out B']);
    } finally {
      await phone.close();
    }
    await app.close();
  });

test('from a phone, refused in words; from the operator window as before: media with its skips, the stage message, a timer alone, a lower third and an audio playlist, each seen as it changes, and the phone still drawing what is live (Session 55: props and the idle rotation went)', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win, { video: true });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-mirror-'));
  await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder tune.wav'), { seconds: 4 }),
    makeTestTone(join(dir, 'Placeholder second tune.wav'), { seconds: 30, hz: 660 }),
  ]);
  const toneId = await mediaId(win, 'Placeholder tune');
  const secondToneId = await mediaId(win, 'Placeholder second tune');
  expect(toneId).not.toBe('');
  expect(secondToneId).not.toBe('');
  await setUpScreen(win);
  await outputPage(app);
  const { base } = await networkOn(win);
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };

    // No props, masks or idle rotation on the phone (Session 55).
    for (const id of ['remote-props', 'remote-masks', 'remote-idle', 'remote-looks'])
      await expect(p.getByTestId(id), id).toHaveCount(0);

    // The stage message: the phone's refused; moved to the window, shown on the stage screens only, said in the
    // window, then cleared (the phone's clear refused too).
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/stage-message',
      { text: 'Placeholder: five minutes' },
      'computer',
    );
    await dispatch(win, { type: 'setStageMessage', text: 'Placeholder: five minutes' });
    await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBe('Placeholder: five minutes');
    await openSection(win, 'stage');
    await expect(win.getByTestId('stage-message-shown')).toHaveText('Placeholder: five minutes');
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/stage-message/clear', {}, 'computer');
    await dispatch(win, { type: 'clearStageMessage' });
    await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBeNull();

    // A timer up for the audience (Show for the audience, Session 55), then taken off the same way (Hide): the
    // phone's refused; moved to the window, named under LIVE.
    const timerId = (await snapshot(win)).state.timers.find((t) => t.name === 'Sabha starts in')?.id ?? '';
    expect(timerId).not.toBe('');
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/timers/${timerId}/show`, {}, 'computer');
    await dispatch(win, { type: 'showAudienceTimer', timerId });
    await expect.poll(async () => (await layers(win)).timer?.timerId).toBeTruthy();
    await expect(win.getByTestId('live-audience-timer')).toContainText('Sabha starts in');
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/timers/hide', {}, 'computer');
    await dispatch(win, { type: 'hideAudienceTimer' });
    await expect.poll(async () => (await layers(win)).timer ?? null).toBeNull();

    // A lower third with the new moving background: the phone's list, Show and Hide refused; moved to the window,
    // and the phone's live picture draws it with the same motion as Main.
    const input: LowerThirdInput = {
      ...NEW_LOWER_THIRD,
      look: { ...NEW_LOWER_THIRD.look, motion: 'streaks' },
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    };
    const saved = await win.evaluate(
      (made) => (globalThis as PageGlobals).drashti.lowerThirds.save(null, made),
      input,
    );
    if (!saved.ok) throw new Error(saved.message);
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/lower-thirds', undefined, 'computer');
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/lower-thirds/${saved.id}/show`, {}, 'computer');
    expect(
      await win.evaluate((id) => (globalThis as PageGlobals).drashti.lowerThirds.show(id), saved.id),
    ).toMatchObject({ ok: true });
    await expect.poll(async () => (await layers(win)).lowerThird?.lines[0]).toBe('Placeholder Speaker');
    await expect(p.getByTestId('remote-live').getByTestId('lower-third-layer')).toHaveAttribute(
      'data-lt-motion',
      'streaks',
    );
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/lower-thirds/hide', {}, 'computer');
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.lowerThirds.hide())).toMatchObject({
      ok: true,
    });
    await expect.poll(async () => (await layers(win)).lowerThird).toBeNull();

    // An audio playlist made in Drashti: the phone's list, Play, Next track, Pause and Play on refused; moved to the
    // window (its Music's Play, as its bridge does it), played, on to its second track, paused, played on there.
    const music = await win.evaluate(
      async (ids) => {
        const d = (globalThis as PageGlobals).drashti;
        const made = await d.music.create('Placeholder tunes');
        if (!made.ok || !made.id) throw new Error('no audio playlist');
        const added = await d.music.addTracks(made.id, ids, null);
        if (!added.ok) throw new Error(added.message);
        return made.id;
      },
      [toneId, secondToneId],
    );
    const play = () => win.evaluate((id) => (globalThis as PageGlobals).drashti.music.play(id), music);
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/music', undefined, 'media');
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/music/play', { playlistId: music }, 'media');
    expect(await play()).toMatchObject({ ok: true });
    await expect.poll(async () => (await layers(win)).audio?.music?.playlistId).toBe(music);
    // Its second track, paused: Play goes on with that track where it was, never from the first track again (D5
    // review).
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/music/next', {}, 'media');
    await dispatch(win, { type: 'musicNext' });
    await expect.poll(async () => (await layers(win)).audio?.music?.index).toBe(1);
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/music/pause', {}, 'media');
    await dispatch(win, { type: 'pauseMusic' });
    await expect.poll(async () => (await layers(win)).audio?.pausedAtMs).not.toBeUndefined();
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/music/play', { playlistId: music }, 'media');
    expect(await play()).toMatchObject({ ok: true });
    await expect
      .poll(async () => {
        const audio = (await layers(win)).audio;
        return { index: audio?.music?.index, paused: audio?.pausedAtMs !== undefined };
      })
      .toEqual({ index: 1, paused: false });
    await dispatch(win, { type: 'pauseMusic' });
    await expect.poll(async () => (await layers(win)).audio?.pausedAtMs).not.toBeUndefined();
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });
    // Cleared part-way through its second track (alpha.20, the owner's "Yes, all A" to Q60-39 P1): the window's Play
    // plays on from that track.
    await expect.poll(async () => (await layers(win)).audio).toBeNull();
    expect(await play()).toMatchObject({ ok: true });
    // Seen from its first moment on its second track: started on the first (of 4 s), it would only come to the
    // second by itself, later.
    const seen: (number | undefined)[] = [];
    await expect
      .poll(async () => {
        const audio = (await layers(win)).audio;
        if (audio?.music?.playlistId === music) seen.push(audio.music.index);
        return seen.length;
      })
      .toBeGreaterThan(0);
    expect(seen[0], 'the track it starts on').toBe(1);
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });

    // Next in words beside its picture, as the window's caption says it (D5 review): the phone still says what comes
    // next; its Next on a kirtan is refused (not a PowerPoint or a PDF).
    await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 0 });
    await expect(p.getByTestId('remote-next-caption')).toHaveText('Placeholder Kirtan, slide 2');
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/trigger/next', {}, 'noDeck');

    // Media: the phone's list of the library's pictures, videos and sounds, and each put up from it, refused. Moved to
    // the window: a picture up as the background, the slide taken off (the commands the phone's Media ran, as the
    // window's Media runs them), then taken off.
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/media', undefined, 'media');
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/media/${show.pictureMediaId}/show`, {}, 'media');
    await dispatch(win, { type: 'clearLayer', layer: 'slide' });
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: show.pictureMediaId, media: 'image', fit: 'fit', loop: false },
    });
    await expect
      .poll(async () => {
        const l = await layers(win);
        return { background: l.background?.kind === 'media' ? l.background.mediaId : null, slide: l.slide };
      })
      .toEqual({ background: show.pictureMediaId, slide: null });
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/background', {}, 'computer');
    await dispatch(win, { type: 'clearLayer', layer: 'background' });
    await expect.poll(async () => (await layers(win)).background).toBeNull();
    // A video the same way, and its skips: the phone's refused; the window's skip forward moves it, once Drashti
    // knows the file's length.
    const videoId = show.videoMediaId ?? '';
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/media/${videoId}/show`, {}, 'media');
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: videoId, media: 'video', fit: 'fill', loop: true },
    });
    await expect
      .poll(async () => {
        const bg = (await layers(win)).background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.videoMediaId);
    await expect
      .poll(
        async () => {
          const bg = (await layers(win)).background;
          return bg?.kind === 'media' ? (bg.durationMs ?? 0) : 0;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/skip',
      { layer: 'background', jump: 'forward' },
      'media',
    );
    await dispatch(win, { type: 'skip', layer: 'background', jump: 'forward' });
    await expect
      .poll(async () => {
        const bg = (await layers(win)).background;
        return bg?.kind === 'media' ? (bg.seek?.toMs ?? null) : null;
      })
      .not.toBeNull();
    await expectNoSeriousA11yIssues(p, 'the phone’s page with a video playing on the screens');
    // A sound plays over the rest: the phone's refused; the window's up, and taken off.
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/media/${toneId}/show`, {}, 'media');
    await dispatch(win, {
      type: 'playAudio',
      audio: { id: 'placeholder-tune', title: 'Placeholder tune', mediaId: toneId, volume: 1, loop: false },
    });
    await expect.poll(async () => (await layers(win)).audio?.mediaId).toBe(toneId);
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/audio', {}, 'computer');
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });
    await expect.poll(async () => (await layers(win)).audio).toBeNull();
  } finally {
    await phone.close();
  }
  await app.close();
});

/** The sizes the mirror is laid out for: a phone, a tablet upright and a tablet held sideways. */
const SIZES = [
  { name: 'a phone', width: 375, height: 812, layout: 'phone', mobile: true },
  // Held sideways, a phone keeps its tabs (D5 review): as wide as a small tablet, far too short for its columns; since
  // alpha.21 with Back, Next and the tabs at the middle's side.
  { name: 'a phone held sideways', width: 844, height: 390, layout: 'sideways', mobile: true },
  { name: 'a tablet', width: 768, height: 1024, layout: 'wide', mobile: true },
  { name: 'a tablet held sideways', width: 1024, height: 768, layout: 'landscape', mobile: true },
] as const;

/**
 * The places each layout has that the phone rule leaves (alpha.23, QA23-PHONE-1: the Show tab and, in Pro Mode, the
 * playlist; the library, Media and More went with the rule, the phone's page the UI builder's).
 */
const PLACES = {
  phone: ['remote-tab-show', 'remote-tab-playlist'],
  sideways: ['remote-tab-show', 'remote-tab-playlist'],
  wide: ['remote-side-playlist'],
  landscape: ['remote-panel-show', 'remote-panel-playlist'],
} as const;

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the phone’s page laid out for a phone and a tablet, upright and held sideways, in ${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine, with everything up on the screens (each refused to it in words): axe, 44 px targets, nothing off the side, Back and Next in reach, and Add to Home Screen`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win, { video: true });
    const dir = mkdtempSync(join(tmpdir(), 'drashti-mirror-layout-'));
    await importAndGetIds(win, [makeTestTone(join(dir, 'Placeholder tune.wav'), { seconds: 120 })]);
    const toneId = await mediaId(win, 'Placeholder tune');
    // Repeat Slides counts down only with somewhere to go, a step after the one up (show-engine.ts countFor): two
    // pictures, as a hall's Repeat Slides has. With one, it stays up with no count, and no "Moves on by itself".
    const [secondPictureId = ''] = await importAndGetIds(win, [
      await makeTestImage(win, join(dir, 'Placeholder second backdrop.png'), { color: '#7c2d12' }),
    ]);
    expect(secondPictureId).not.toBe('');
    await win.evaluate((input) => (globalThis as PageGlobals).drashti.lowerThirds.save(null, input), {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    });
    // Everything the phone can have up at once (D5 review): an audio playlist playing (Music's rows, the time bars, and
    // its track's marker in the Playing row) and Repeat Slides going round (LIVE's own line, "Moves on by itself"),
    // so each is laid out and checked at every size. Under black-out no video plays (Session 56: LIVE shows one thing
    // at a time), so the Playing row is the track's marker's, not a background video's skips as before.
    const repeatId = await win.evaluate(
      async ({ toneId, pictureId, secondPictureId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const marked = await d.media.setMarkers(toneId, {
          startMs: null,
          endMs: null,
          markers: [{ id: 'm1', name: 'Placeholder chorus', atMs: 30_000 }],
        });
        if (!marked.ok) throw new Error(marked.message);
        const made = await d.music.create('Placeholder tunes');
        if (!made.ok || !made.id) throw new Error('no audio playlist');
        const added = await d.music.addTracks(made.id, [toneId], null);
        if (!added.ok) throw new Error(added.message);
        // Going round, so it still plays at the last size checked, however long each size takes.
        const looped = await d.music.setOptions(made.id, { loop: true, shuffle: false });
        if (!looped.ok) throw new Error(looped.message);
        const played = await d.music.play(made.id, 0);
        if (!played.ok) throw new Error(played.message);
        // Each step of the set-up says why, should it fail, rather than leave a later wait to time out.
        const repeat = await d.playlists.createRepeat(null);
        if (!repeat.ok) throw new Error(repeat.message);
        const id = repeat.ids[0] ?? '';
        const renamed = await d.playlists.rename(id, 'Placeholder Hall Pictures');
        if (!renamed.ok) throw new Error(renamed.message);
        const items = await d.playlists.addItems(id, null, [
          { kind: 'media', mediaId: pictureId },
          { kind: 'media', mediaId: secondPictureId },
        ]);
        if (!items.ok) throw new Error(items.message);
        const set = await d.playlists.setRepeat(id, {
          secondsEach: 600,
          transition: { kind: 'dissolve', durationMs: 500 },
        });
        if (!set.ok) throw new Error(set.message);
        return id;
      },
      { toneId, pictureId: show.pictureMediaId, secondPictureId },
    );
    await dispatch(win, { type: 'startRepeat', playlistId: repeatId, slideIndex: 0 });
    await expect.poll(async () => (await snapshot(win)).state.autoAdvance).not.toBeNull();
    // Something on every clear's layer it can be: the clears lit, their words at their longest.
    await dispatch(win, { type: 'setBlackout', on: true });
    await dispatch(win, {
      type: 'showMessage',
      message: { id: 'message:placeholder', text: 'Placeholder words' },
    });
    await dispatch(win, { type: 'setStageMessage', text: 'Placeholder: five minutes' });
    const { base } = await networkOn(win);
    const browser = await (engine === 'webkit' ? webkit : chromium).launch();
    try {
      for (const size of SIZES) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          isMobile: size.mobile,
          hasTouch: true,
          bypassCSP: true,
        });
        const page = await context.newPage();
        const at = `${size.name} (${String(size.width)} × ${String(size.height)}, ${engine})`;
        try {
          await pairByQr(page, base, await pairingCode(win, 'remote', `Placeholder ${size.name}`), '/remote');
          await expect(page.getByTestId('connection')).toHaveText('Connected');
          await expect(page.getByTestId('remote')).toHaveAttribute('data-layout', size.layout);
          // Everything up on the screens is refused to a phone in words, nothing changed (alpha.23, QA23-PHONE-1): the
          // music's Pause, Repeat Slides' Stop, black-out, the message and the stage message taken off.
          if (size === SIZES[0]) {
            const fromPhone = { win, page };
            await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/music/pause', {}, 'media');
            await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/repeat/stop', {}, 'notDeck');
            await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/blackout', { on: false }, 'computer');
            await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/messages', {}, 'computer');
            await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/stage-message/clear', {}, 'computer');
          }
          for (const place of PLACES[size.layout]) {
            await page.getByTestId(place).click();
            await expect(page.getByTestId(place)).toHaveAttribute('aria-selected', 'true');
            await expectNoSeriousA11yIssues(page, `${place} on ${at}`);
            expect.soft(await tooSmall(page), `targets under 44 px: ${place} on ${at}`).toEqual([]);
            expect.soft(await offTheSide(page), `off the side: ${place} on ${at}`).toEqual([]);
          }
          // Back and Next always in reach, a phone held sideways too.
          if (size.layout === 'phone' || size.layout === 'sideways')
            await page.getByTestId('remote-tab-show').click();
          await expect(page.getByTestId('remote-next-button')).toBeInViewport();
          await expect(page.getByTestId('remote-back')).toBeInViewport();
          // Add to Home Screen: iOS's tags and Android Chrome's, and the icons they name.
          const tags = await page.evaluate(() =>
            Object.fromEntries(
              ['apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-title'].map(
                (n) => [n, document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? null],
              ),
            ),
          );
          expect(tags).toEqual({
            'apple-mobile-web-app-capable': 'yes',
            'mobile-web-app-capable': 'yes',
            'apple-mobile-web-app-title': 'Drashti remote',
          });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
    await app.close();
  });

test('a Stage or Announcements device can read and do none of the mirror’s requests, and a Remote is refused them in words', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { port } = await networkOn(win);
  const remote = await pairToken(win, port, 'remote', 'Placeholder remote');
  const stage = await pairToken(win, port, 'stage', 'Placeholder stage');
  const poster = await pairToken(win, port, 'announcements', 'Placeholder announcer');
  const asks: [string, string, unknown?][] = [
    ['GET', '/api/v1/keys'],
    ['GET', '/api/v1/media'],
    ['POST', `/api/v1/media/${show.pictureMediaId}/show`],
    ['GET', '/api/v1/lower-thirds'],
    ['POST', '/api/v1/lower-thirds/hide'],
    ['GET', '/api/v1/music'],
    ['POST', '/api/v1/stage-message', { text: 'Placeholder: five minutes' }],
    ['POST', '/api/v1/stage-message/clear'],
    ['POST', '/api/v1/skip', { layer: 'background', jump: 'back' }],
  ];
  const before = (await snapshot(win)).rev;
  for (const token of [stage, poster])
    for (const [method, path, body] of asks)
      expect((await apiCall(port, path, { method, token, body })).status, `${method} ${path}`).toBe(403);
  expect((await snapshot(win)).rev).toBe(before);
  // A Remote is refused them too, now in its group's words (alpha.23, QA23-PHONE-1), nothing changed: no longer the
  // keys read and the picture put up (the skip, refused before as nothing played, refused in the media words).
  const script = { win, port, token: remote };
  await expectPhoneRefuses(script, 'GET', '/api/v1/keys', undefined, 'computer');
  await expectPhoneRefuses(script, 'GET', '/api/v1/media', undefined, 'media');
  await expectPhoneRefuses(script, 'POST', `/api/v1/media/${show.pictureMediaId}/show`, undefined, 'media');
  await expectPhoneRefuses(script, 'GET', '/api/v1/lower-thirds', undefined, 'computer');
  await expectPhoneRefuses(script, 'POST', '/api/v1/lower-thirds/hide', undefined, 'computer');
  await expectPhoneRefuses(script, 'GET', '/api/v1/music', undefined, 'media');
  await expectPhoneRefuses(
    script,
    'POST',
    '/api/v1/stage-message',
    { text: 'Placeholder: five minutes' },
    'computer',
  );
  await expectPhoneRefuses(script, 'POST', '/api/v1/stage-message/clear', undefined, 'computer');
  await expectPhoneRefuses(script, 'POST', '/api/v1/skip', { layer: 'audio', jump: 'back' }, 'media');
  expect((await layers(win)).background).toBeNull();
  await app.close();
});

// Session 54, D5 review: a Repeat Slides playlist is never played item by item; it goes round, as the window and
// Simple Mode start it. Under the phone rule (alpha.23, QA23-PHONE-1, the owner's "Only PPT and PDF") a phone starts,
// steps through and stops none of it, each refused in words; the window starts it, from an item, and stops it.
test('Repeat Slides from a phone are refused in words: Next with nothing up, an item tapped, Start going round and Stop; from the window: going round from its first step, from an item, and Stop (D5 review)', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-mirror-repeat-'));
  const one = await makeTestImage(win, join(dir, 'Placeholder one.png'), { color: '#1d4e89' });
  const two = await makeTestImage(win, join(dir, 'Placeholder two.png'), { color: '#7c2d12' });
  const [oneId = '', twoId = ''] = await importAndGetIds(win, [one, two]);
  const { playlistId, items } = await win.evaluate(
    async ({ oneId, twoId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.createRepeat(null);
      const id = made.ok ? (made.ids[0] ?? '') : '';
      await d.playlists.rename(id, 'Placeholder Hall Pictures');
      await d.playlists.addItems(id, null, [
        { kind: 'media', mediaId: oneId },
        { kind: 'media', mediaId: twoId },
      ]);
      // Long enough that no step moves on by itself while the test looks.
      await d.playlists.setRepeat(id, { secondsEach: 60, transition: { kind: 'dissolve', durationMs: 500 } });
      return { playlistId: id, items: (await d.playlists.items(id)).map((i) => i.id) };
    },
    { oneId, twoId },
  );
  const [firstItem = '', secondItem = ''] = items;
  /** Which item's step is up, and whether it goes round. */
  const going = async () => {
    const { state } = await snapshot(win);
    return {
      repeat: state.repeat?.playlistId ?? null,
      item: state.layers.slide?.slide.id.split('/')[0] ?? null,
    };
  };
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    const fromPhone = { win, page: p };
    await expectNoSeriousA11yIssues(p, 'the phone’s page beside a Repeat Slides playlist');

    // Next with nothing up (which started it going round, as Simple Mode's Next does): refused. Moved to the window:
    // Start going round, from its first step; the phone's Stop refused; the window's stops it.
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/trigger/next', {}, 'noDeck');
    await dispatch(win, { type: 'startRepeat', playlistId, slideIndex: 0 });
    await expect.poll(going).toEqual({ repeat: playlistId, item: firstItem });
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/repeat/stop', {}, 'notDeck');
    await dispatch(win, { type: 'stopRepeat' });
    await expect.poll(async () => (await going()).repeat).toBeNull();

    // An item tapped (which went round from that item's first step): refused, as a row and as Start from it. Moved to
    // the window: going round from the second item's step, then Stop (its step stays up).
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/trigger/item',
      { playlistId, itemId: secondItem },
      'notDeck',
    );
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/repeat/${playlistId}/start`,
      { itemId: secondItem },
      'notDeck',
    );
    await dispatch(win, { type: 'startRepeat', playlistId, slideIndex: 1 });
    await expect.poll(going).toEqual({ repeat: playlistId, item: secondItem });
    await dispatch(win, { type: 'stopRepeat' });
    await expect.poll(going).toEqual({ repeat: null, item: secondItem });

    // Start going round (its button on the phone): refused; the window's, from the first step again.
    await expectPhoneRefuses(fromPhone, 'POST', `/api/v1/repeat/${playlistId}/start`, {}, 'notDeck');
    await dispatch(win, { type: 'startRepeat', playlistId, slideIndex: 0 });
    await expect.poll(going).toEqual({ repeat: playlistId, item: firstItem });
  } finally {
    await phone.close();
  }
  await app.close();
});
