import type { Page } from '@playwright/test';
import { chromium, expect, test, webkit } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEW_LOWER_THIRD } from '../../src/shared/lower-thirds';
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
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { LOGO, PICTURE, setUpPlaceholderShow, VIDEO } from './placeholder-show';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * The phone as a mirror of the operator window (Session 54, D5): the clears in the desktop's order with its keys'
 * names, each lit while its layer is up and clearing it; props, the library's media, the stage message, a timer
 * alone, a lower third, the idle rotation and an audio playlist, each put up and taken off from the phone and seen on
 * both sides as it changes; laid out for a phone and a tablet (375 × 812, 768 × 1024 and held sideways) in Safari's
 * engine and Chrome's, with axe, 44 px targets and nothing off the side; and none of it for a Stage or Announcements
 * device. Placeholder content and generated media only; codes and tokens made at run time.
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

/** The clears' words and keys, in their order on the page. */
const clearWords = (phone: Page) =>
  phone
    .getByTestId('remote-actions')
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).innerText.replace(/\s+/gu, ' ').trim()));

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the phone’s clears are the desktop’s bottom bar: in its order with its keys’ names, each lit while its layer is up and clearing it, the keys followed as they change (${engine})`, async () => {
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
    try {
      await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      // In the desktop's order, left to right (LayerBar.tsx), each with the key the window answers.
      await expect
        .poll(() => clearWords(p))
        .toEqual([
          'Clear all F1',
          'Slide F2',
          'Background F3',
          'Props F4',
          'Audio F5',
          'Messages F6',
          'Ticker F7',
          'Masks F8',
          'Logo F12',
          'Black-out B',
        ]);
      // No logo chosen yet: the Logo can be pressed all the same, as the window's can, and says why in the window's
      // words (D5 review: it was greyed with no reason). Then one is chosen.
      await expect(p.getByTestId('remote-logo')).toBeEnabled();
      await p.getByTestId('remote-logo').click();
      await expect(p.getByRole('alert')).toContainText(
        'No logo has been chosen yet. Choose one in Pro Mode: Props, then “Use as the logo”.',
      );
      expect((await snapshot(win)).state.logo).toBeNull();
      await win.evaluate((id) => (globalThis as PageGlobals).drashti.props.setLogo(id), show.logoPropId);
      // Read out as the desktop's are: a layer's clear by its name, the rest by their words and key.
      const actions = p.getByTestId('remote-actions');
      await expect(actions.getByRole('button', { name: 'Clear all F1', exact: true })).toBeDisabled();
      await expect(actions.getByRole('button', { name: 'Clear slide', exact: true })).toBeDisabled();

      // The slide, the background, a prop and a message up from the operator window: their clears light up.
      const props = await win.evaluate(() => (globalThis as PageGlobals).drashti.props.list());
      const logo = props.find((x) => x.name === LOGO);
      if (!logo) throw new Error('no placeholder prop');
      await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 0 });
      await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: show.pictureMediaId, media: 'image', fit: 'fit', loop: false },
      });
      await dispatch(win, {
        type: 'showProp',
        prop: {
          id: logo.id,
          name: logo.name,
          elements: logo.elements,
          width: logo.width,
          height: logo.height,
        },
      });
      await dispatch(win, {
        type: 'showMessage',
        message: { id: 'message:placeholder', text: 'Placeholder words' },
      });
      for (const layer of ['slide', 'background', 'props', 'messages'])
        await expect(p.getByTestId(`remote-clear-${layer}`), layer).toHaveAttribute('data-lit', 'true');
      for (const layer of ['audio', 'ticker', 'masks'])
        await expect(p.getByTestId(`remote-clear-${layer}`), layer).toBeDisabled();
      await expect(
        actions.getByRole('button', { name: 'Clear slide (on screen)', exact: true }),
      ).toBeEnabled();
      await expectNoSeriousA11yIssues(p, `the clears lit on a phone (${engine})`);

      // Each clears its own layer, on the screens too, and goes dim.
      await p.getByTestId('remote-clear-slide').click();
      await expect(
        output.locator('[data-layer="slide"]', { hasText: 'Placeholder chorus line' }),
      ).toHaveCount(0);
      await expect.poll(async () => (await layers(win)).slide).toBeNull();
      await p.getByTestId('remote-clear-props').click();
      await expect.poll(async () => (await layers(win)).props).toEqual([]);
      await p.getByTestId('remote-clear-messages').click();
      await expect.poll(async () => (await layers(win)).messages).toEqual([]);
      await p.getByTestId('remote-clear-background').click();
      await expect.poll(async () => (await layers(win)).background).toBeNull();
      for (const layer of ['slide', 'background', 'props', 'messages'])
        await expect(p.getByTestId(`remote-clear-${layer}`), layer).toBeDisabled();

      // Clear all, then Put it back in its place (no key, as the desktop's bar), then Clear all again.
      await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 1 });
      await p.getByTestId('remote-clear-all').click();
      await expect(p.getByTestId('remote-put-back')).toHaveText('Put it back');
      await p.getByTestId('remote-put-back').click();
      await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder first verse');
      await expect(p.getByTestId('remote-clear-all')).toBeEnabled();

      // The single-letter keys turned off in Drashti: Black-out names no key, the Logo keeps F12; and back.
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSingleKeys(false));
      await expect.poll(async () => (await clearWords(p)).slice(-2)).toEqual(['Logo F12', 'Black-out']);
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSingleKeys(true));
      await expect.poll(async () => (await clearWords(p)).slice(-2)).toEqual(['Logo F12', 'Black-out B']);
    } finally {
      await phone.close();
    }
    await app.close();
  });

test('from a phone, as from the operator window: props, media with its skips, the stage message, a timer alone, a lower third, the idle rotation and an audio playlist, each seen on both sides as it changes', async () => {
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
  const output = await outputPage(app);
  const { base } = await networkOn(win);
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');

    // Props: Show and Hide, by the prop's name, the logo marked; up on the screens and in the window's LIVE.
    await p.getByTestId('remote-tab-more').click();
    const prop = p.getByTestId('remote-prop').filter({ hasText: LOGO });
    await prop.getByRole('button', { name: 'Show' }).click();
    await expect.poll(async () => (await layers(win)).props.map((x) => x.name)).toEqual([LOGO]);
    await expect(output.locator('[data-layer="props"]')).toContainText(LOGO);
    await expect(win.getByTestId('live-preview').locator('[data-layer="props"]')).toContainText(LOGO);
    await expect(prop).toHaveAttribute('data-shown', 'true');
    await expectNoSeriousA11yIssues(p, 'the More tab with a prop up');
    await prop.getByRole('button', { name: 'Hide' }).click();
    await expect.poll(async () => (await layers(win)).props).toEqual([]);
    // Up from the window: the phone follows, with no reload. A prop made in Drashti is listed at once.
    const logo = (await win.evaluate(() => (globalThis as PageGlobals).drashti.props.list())).find(
      (x) => x.name === LOGO,
    );
    if (!logo) throw new Error('no placeholder prop');
    await dispatch(win, {
      type: 'showProp',
      prop: { id: logo.id, name: logo.name, elements: logo.elements, width: logo.width, height: logo.height },
    });
    await expect(prop).toHaveAttribute('data-shown', 'true');
    await dispatch(win, { type: 'hideProp', propId: logo.id });
    await expect(prop).not.toHaveAttribute('data-shown');
    const made = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.props.save(null, {
        name: 'Placeholder corner words',
        width: 1920,
        height: 1080,
        elements: [
          {
            id: 'placeholder-corner-words',
            kind: 'text',
            frame: { x: 60, y: 960, width: 1800, height: 80 },
            text: 'Placeholder corner words',
            lang: 'en',
            style: {
              fontFamily: null,
              fontSize: 48,
              fontWeight: 600,
              color: '#ffffff',
              align: 'center',
              verticalAlign: 'middle',
              lineHeight: 1.2,
              shadow: true,
            },
          },
        ],
      }),
    );
    expect(made.ok).toBe(true);
    await expect(p.getByTestId('remote-prop').filter({ hasText: 'Placeholder corner words' })).toBeVisible();

    // The stage message: shown on the stage screens only, said on the phone and in the window, then cleared.
    await p.getByTestId('remote-stage-text').fill('Placeholder: five minutes');
    await p.getByTestId('remote-stage').getByRole('button', { name: 'Show' }).click();
    await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBe('Placeholder: five minutes');
    await expect(p.getByTestId('remote-stage-message')).toContainText('Placeholder: five minutes');
    await expect(win.getByTestId('stage-message-shown')).toHaveText('Placeholder: five minutes');
    await p.getByTestId('remote-stage-clear').click();
    await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBeNull();
    await expect(p.getByTestId('remote-stage-message')).toHaveCount(0);

    // A timer alone on the screens (Show on the screens), then taken off the same way.
    const timer = p.getByTestId('remote-timer').first();
    await timer.getByTestId('remote-timer-show').click();
    await expect.poll(async () => (await layers(win)).slide?.timer?.name).toBe('Sabha starts in');
    await expect(timer.getByTestId('remote-timer-show')).toHaveText('Take off the screens');
    // Named under LIVE on the Show tab, as the window's LIVE names it.
    await p.getByTestId('remote-tab-show').click();
    await expect(p.getByTestId('remote-timer-alone')).toContainText('Sabha starts in');
    await p.getByTestId('remote-tab-more').click();
    await timer.getByTestId('remote-timer-show').click();
    await expect.poll(async () => (await layers(win)).slide).toBeNull();

    // A lower third made in Drashti appears at once; Show and Hide.
    await win.evaluate((input) => (globalThis as PageGlobals).drashti.lowerThirds.save(null, input), {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    });
    const third = p.getByTestId('remote-lower-third').filter({ hasText: 'Placeholder Speaker' });
    await expect(third).toContainText('Placeholder title');
    await third.getByRole('button', { name: 'Show' }).click();
    await expect.poll(async () => (await layers(win)).lowerThird?.lines[0]).toBe('Placeholder Speaker');
    await expect(third).toHaveAttribute('data-up', 'true');
    await third.getByRole('button', { name: 'Hide' }).click();
    await expect.poll(async () => (await layers(win)).lowerThird).toBeNull();

    // The idle rotation, once it has a picture: Start and Stop.
    await win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.idle.saveSettings({
          pictures: [id],
          secondsEach: 3,
          quoteOfTheDay: false,
        }),
      show.pictureMediaId,
    );
    await p.getByTestId('remote-idle-start').click();
    await expect.poll(async () => (await snapshot(win)).state.idle.startedAt).not.toBeNull();
    await p.getByTestId('remote-idle-stop').click();
    await expect.poll(async () => (await snapshot(win)).state.idle.startedAt).toBeNull();

    // An audio playlist made in Drashti: listed with its tracks, played from the phone, then paused.
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
    const tunes = p.getByTestId('remote-music-playlist').filter({ hasText: 'Placeholder tunes' });
    await expect(tunes).toContainText('2 tracks');
    await tunes.getByRole('button', { name: 'Play Placeholder tunes' }).click();
    await expect.poll(async () => (await layers(win)).audio?.music?.playlistId).toBe(music);
    await expect(tunes).toHaveAttribute('data-playing', 'true');
    await expect(p.getByTestId('remote-music').getByRole('button', { name: 'Previous track' })).toBeVisible();
    // Its second track, paused on its row: Play there goes on with that track where it was, as the window's Play
    // does, never from the first track again (D5 review).
    await p.getByTestId('remote-music').getByRole('button', { name: 'Next track' }).click();
    await expect.poll(async () => (await layers(win)).audio?.music?.index).toBe(1);
    await tunes.getByRole('button', { name: 'Pause Placeholder tunes' }).click();
    await expect.poll(async () => (await layers(win)).audio?.pausedAtMs).not.toBeUndefined();
    await expect(tunes).toHaveAttribute('data-paused', 'true');
    await tunes.getByRole('button', { name: 'Play Placeholder tunes' }).click();
    await expect
      .poll(async () => {
        const audio = (await layers(win)).audio;
        return { index: audio?.music?.index, paused: audio?.pausedAtMs !== undefined };
      })
      .toEqual({ index: 1, paused: false });
    await expect(tunes).not.toHaveAttribute('data-paused');
    await p.getByTestId('remote-music').getByRole('button', { name: 'Pause music' }).click();
    await expect.poll(async () => (await layers(win)).audio?.pausedAtMs).not.toBeUndefined();
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });

    // Next in words beside its picture, as the window's caption says it (D5 review): until then a phone showed only
    // the next slide's picture, hidden from screen readers.
    await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 0 });
    await p.getByTestId('remote-tab-show').click();
    await expect(p.getByTestId('remote-next-caption')).toHaveText('Placeholder Kirtan, slide 2');

    // Media: the library's pictures, videos and sounds. A picture goes up as the background, the slide taken off.
    await p.getByTestId('remote-tab-library').click();
    await p.getByTestId('remote-library-media').click();
    await expect(p.getByTestId('remote-library-media')).toHaveAttribute('aria-selected', 'true');
    const picture = p.getByTestId('remote-media-item').filter({ hasText: PICTURE });
    await expect(picture).toContainText('Picture');
    await expectNoSeriousA11yIssues(p, 'Media on a phone');
    await picture.getByRole('button').first().click();
    await expect
      .poll(async () => {
        const l = await layers(win);
        return { background: l.background?.kind === 'media' ? l.background.mediaId : null, slide: l.slide };
      })
      .toEqual({ background: show.pictureMediaId, slide: null });
    await expect(picture).toHaveAttribute('data-live', 'true');
    await picture.getByTestId('remote-media-take-off').click();
    await expect.poll(async () => (await layers(win)).background).toBeNull();
    // Look beside it, as a playlist's picture has: D1's viewer on this phone alone, nothing put up.
    await picture.getByTestId('remote-item-look').click();
    const viewer = p.getByTestId('viewer');
    await expect(viewer).toHaveAttribute('data-page', `picture:${show.pictureMediaId}`);
    await expectNoSeriousA11yIssues(p, 'a picture from Media looked at on a phone');
    expect((await layers(win)).background).toBeNull();
    await viewer.getByTestId('viewer-close').click();
    await expect(viewer).toHaveCount(0);
    // Found by a word of its name; a video goes up the same way, and its skips are under LIVE.
    await p.getByTestId('remote-media-search').fill('clip');
    const video = p.getByTestId('remote-media-item').filter({ hasText: VIDEO });
    await expect(video).toBeVisible();
    await expect(p.getByTestId('remote-media-item')).toHaveCount(1);
    // Play beside it plays it on this phone alone.
    await expect(video.getByTestId('remote-item-look')).toHaveAttribute(
      'aria-label',
      /^Play “Placeholder clip[^”]*” on this device$/u,
    );
    await video.getByRole('button').first().click();
    await expect
      .poll(async () => {
        const bg = (await layers(win)).background;
        return bg?.kind === 'media' ? bg.mediaId : null;
      })
      .toBe(show.videoMediaId);
    await p.getByTestId('remote-tab-show').click();
    const forward = p.getByTestId('remote-skip-background-forward');
    // Dimmed until Drashti knows the file's length, a moment after it starts.
    await expect(forward).toBeEnabled({ timeout: 20_000 });
    await forward.click();
    await expect
      .poll(async () => {
        const bg = (await layers(win)).background;
        return bg?.kind === 'media' ? (bg.seek?.toMs ?? null) : null;
      })
      .not.toBeNull();
    await expectNoSeriousA11yIssues(p, 'the Show tab with a video playing');
    // A sound plays over the rest, and is taken off from Media.
    await p.getByTestId('remote-tab-library').click();
    await p.getByTestId('remote-media-search').fill('tune');
    const tune = p.getByTestId('remote-media-item').filter({ hasText: 'Placeholder tune' });
    // A sound has neither: a sound plays on a phone only from a playlist shared with phones.
    await expect(tune.getByTestId('remote-item-look')).toHaveCount(0);
    await tune.getByRole('button').first().click();
    await expect.poll(async () => (await layers(win)).audio?.mediaId).toBe(toneId);
    await expect(tune).toHaveAttribute('data-live', 'true');
    await tune.getByTestId('remote-media-take-off').click();
    await expect.poll(async () => (await layers(win)).audio).toBeNull();
  } finally {
    await phone.close();
  }
  await app.close();
});

/** The sizes the mirror is laid out for: a phone, a tablet upright and a tablet held sideways. */
const SIZES = [
  { name: 'a phone', width: 375, height: 812, layout: 'phone', mobile: true },
  // Held sideways, a phone keeps its tabs (D5 review): as wide as a small tablet, far too short for its columns.
  { name: 'a phone held sideways', width: 844, height: 390, layout: 'phone', mobile: true },
  { name: 'a tablet', width: 768, height: 1024, layout: 'wide', mobile: true },
  { name: 'a tablet held sideways', width: 1024, height: 768, layout: 'landscape', mobile: true },
] as const;

/** The places each layout has: the tabs to press, Media among them. */
const PLACES = {
  phone: [
    'remote-tab-show',
    'remote-tab-playlist',
    'remote-tab-library',
    'remote-library-media',
    'remote-tab-more',
  ],
  wide: ['remote-side-playlist', 'remote-side-library', 'remote-library-media'],
  landscape: [
    'remote-panel-show',
    'remote-panel-playlist',
    'remote-panel-library',
    'remote-library-media',
    'remote-panel-more',
  ],
} as const;

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the mirror laid out for a phone and a tablet, upright and held sideways, in ${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine: axe, 44 px targets, nothing off the side, the tablet using its width, and Add to Home Screen`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win, { video: true });
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.props.setLogo(id), show.logoPropId);
    await win.evaluate((input) => (globalThis as PageGlobals).drashti.lowerThirds.save(null, input), {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder Speaker', 'Placeholder title', ''],
    });
    // Something on every clear's layer it can be: the clears lit, their words at their longest.
    await dispatch(win, { type: 'goLive', presentationId: show.kirtanId, slideIndex: 0 });
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
          await pairByQr(
            page,
            base,
            await pairingCode(win, 'remote', `Placeholder ${size.layout}`),
            '/remote',
          );
          await expect(page.getByTestId('connection')).toHaveText('Connected');
          await expect(page.getByTestId('remote')).toHaveAttribute('data-layout', size.layout);
          for (const place of PLACES[size.layout]) {
            await page.getByTestId(place).click();
            await expect(page.getByTestId(place)).toHaveAttribute('aria-selected', 'true');
            if (place === 'remote-library-media')
              await expect(page.getByTestId('remote-media-item').first()).toBeVisible();
            await expectNoSeriousA11yIssues(page, `${place} on ${at}`);
            expect.soft(await tooSmall(page), `targets under 44 px: ${place} on ${at}`).toEqual([]);
            expect.soft(await offTheSide(page), `off the side: ${place} on ${at}`).toEqual([]);
          }
          // The clears fill the width: three to a row on a phone, more where there is room.
          if (size.layout === 'phone') await page.getByTestId('remote-tab-show').click();
          const tops = await page
            .getByTestId('remote-actions')
            .getByRole('button')
            .evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
          const firstRow = tops.filter((t) => t === tops[0]).length;
          if (size.width < 600) expect(firstRow, at).toBe(3);
          else expect(firstRow, at).toBeGreaterThanOrEqual(3);
          // Back and Next always in reach, a phone held sideways too.
          await expect(page.getByTestId('remote-next-button')).toBeInViewport();
          await expect(page.getByTestId('remote-back')).toBeInViewport();
          // Held sideways, More's sections stand in two columns, and Media in a grid of two or more.
          if (size.layout === 'landscape') {
            await page.getByTestId('remote-panel-more').click();
            const lefts = await page
              .locator(
                '[data-testid="remote-stage"], [data-testid="remote-props"], [data-testid="remote-timers"]',
              )
              .evaluateAll((sections) => sections.map((s) => Math.round(s.getBoundingClientRect().left)));
            expect(new Set(lefts).size, `More in columns on ${at}`).toBeGreaterThan(1);
            await page.getByTestId('remote-panel-library').click();
            await page.getByTestId('remote-library-media').click();
            const mediaLefts = await page
              .getByTestId('remote-media-item')
              .evaluateAll((items) => items.map((i) => Math.round(i.getBoundingClientRect().left)));
            expect(new Set(mediaLefts).size, `Media in a grid on ${at}`).toBeGreaterThan(1);
          }
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

test('a Stage or Announcements device can read and do none of the mirror’s requests, and a Remote does them', async () => {
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
    ['GET', '/api/v1/props'],
    ['POST', `/api/v1/props/${show.logoPropId}/show`],
    ['POST', `/api/v1/props/${show.logoPropId}/hide`],
    ['GET', '/api/v1/media'],
    ['POST', `/api/v1/media/${show.pictureMediaId}/show`],
    ['GET', '/api/v1/lower-thirds'],
    ['POST', '/api/v1/lower-thirds/hide'],
    ['GET', '/api/v1/music'],
    ['POST', '/api/v1/stage-message', { text: 'Placeholder: five minutes' }],
    ['POST', '/api/v1/stage-message/clear'],
    ['POST', '/api/v1/skip', { layer: 'background', jump: 'back' }],
    ['POST', '/api/v1/idle/stop'],
  ];
  const before = (await snapshot(win)).rev;
  for (const token of [stage, poster])
    for (const [method, path, body] of asks)
      expect((await apiCall(port, path, { method, token, body })).status, `${method} ${path}`).toBe(403);
  expect((await snapshot(win)).rev).toBe(before);
  // A Remote reads them, and puts the prop and the picture up (the skip is refused: nothing is playing).
  expect((await apiCall(port, '/api/v1/keys', { token: remote })).json).toMatchObject({
    keys: { singleKeys: true },
  });
  expect((await apiCall(port, '/api/v1/props', { token: remote })).json).toMatchObject({
    props: [{ id: show.logoPropId, name: LOGO }],
  });
  expect(
    (await apiCall(port, `/api/v1/props/${show.logoPropId}/show`, { method: 'POST', token: remote })).status,
  ).toBe(200);
  expect(
    (await apiCall(port, `/api/v1/media/${show.pictureMediaId}/show`, { method: 'POST', token: remote }))
      .status,
  ).toBe(200);
  const l = await layers(win);
  expect(l.props.map((x) => x.id)).toEqual([show.logoPropId]);
  expect(l.background?.kind === 'media' ? l.background.mediaId : null).toBe(show.pictureMediaId);
  expect(
    (
      await apiCall(port, '/api/v1/skip', {
        method: 'POST',
        token: remote,
        body: { layer: 'audio', jump: 'back' },
      })
    ).status,
  ).toBe(409);
  await app.close();
});

// Session 54, D5 review: a Repeat Slides playlist is never played item by item; it goes round, as the window and
// Simple Mode start it. Until then a phone's tap on its item, and its Next, played nothing.
test('Repeat Slides from a phone, as from Simple Mode: Next with nothing up and Start going round start it, an item tapped goes round from it, and Stop (D5 review)', async () => {
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
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-playlist').selectOption(playlistId);
    await expect(p.getByTestId('remote-going-round')).toBeVisible();
    await expect(p.getByTestId('remote-item')).toHaveCount(2);
    await expectNoSeriousA11yIssues(p, 'a Repeat Slides playlist on a phone');

    // Next with nothing up starts it going round from its first step, as Simple Mode's Next does.
    await p.getByTestId('remote-next-button').click();
    await expect.poll(going).toEqual({ repeat: playlistId, item: firstItem });
    await expect(p.getByTestId('remote-item').nth(0)).toHaveAttribute('data-live', 'true');
    await p.getByTestId('remote-going-round-stop').click();
    await expect.poll(async () => (await going()).repeat).toBeNull();

    // An item tapped goes round from that item's first step, and is marked as the one up.
    await p.getByTestId('remote-item').nth(1).click();
    await expect.poll(going).toEqual({ repeat: playlistId, item: secondItem });
    await expect(p.getByTestId('remote-item').nth(1)).toHaveAttribute('data-live', 'true');
    await expect(p.getByTestId('remote-item').nth(0)).not.toHaveAttribute('data-live');
    // Under LIVE on the Show tab: Repeating, with its own Stop (its step stays up).
    await p.getByTestId('remote-tab-show').click();
    await expect(p.getByTestId('remote-repeating')).toContainText('Placeholder Hall Pictures');
    await p.getByTestId('remote-repeat-stop').click();
    await expect.poll(going).toEqual({ repeat: null, item: secondItem });

    // Start going round: from the first step again.
    await p.getByTestId('remote-tab-playlist').click();
    await p.getByTestId('remote-going-round').click();
    await expect.poll(going).toEqual({ repeat: playlistId, item: firstItem });
    await expect(p.getByTestId('remote-going-round-stop')).toBeVisible();
  } finally {
    await phone.close();
  }
  await app.close();
});
