import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import {
  killApp,
  launchApp,
  letTimePass,
  openSection,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
  windowShowing,
} from './helpers';
import { type LinkLook, linkLook, type LiveStandIn, liveStandIn } from './live-stand-in';
import { audioPage } from './time-bar-helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Show a Stream Link… (alpha.20, the playback set's slice 8; the owner's Q60-34 "all VLC type features" and Q60-39 "Yes,
 * all A", P3 A): an HLS or YouTube live link on the hall's screens, RECEIVED only. A live stand-in made by FFmpeg as the
 * test runs, on 127.0.0.1 only (tests/e2e/live-stand-in.ts: a moving picture whose top strip carries each frame's
 * number, and a tone); a YouTube link only through the fake yt-dlp; nothing ever reaches the internet. It goes up once
 * its pictures come, moving on the hall's screen and LIVE; Drashti's own stream shows the Wallpaper meanwhile; if it
 * drops, the last picture is held while Drashti reconnects by itself, the Wallpaper goes up after 20 s, and it comes
 * back by itself, unless something else went up meanwhile.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = join(__dirname, 'fake-yt-dlp.cjs');

/** The running Drashti's log, whose stream link lines a failure says (the main process's side of what happened). */
let logFile: string | null = null;
const mainSaid = (): string =>
  logFile !== null && existsSync(logFile)
    ? readFileSync(logFile, 'utf8')
        .split('\n')
        .filter((l) => l.includes('Stream link:'))
        .slice(-12)
        .join(' | ')
    : '(no log)';

function background(win: Page) {
  return win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
}

/** Show a link from its section's Show a Stream Link…; the window shut once it is up. */
async function showLink(win: Page, url: string, a11y = false): Promise<void> {
  await openSection(win, 'show-a-stream-link');
  await win.getByTestId('show-a-stream-link').click();
  const dialog = win.getByTestId('stream-link-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('stream-link-text').fill(url);
  if (a11y) {
    await settled(win);
    await expectNoSeriousA11yIssues(win, 'Show a Stream Link, a link typed');
  }
  await dialog.getByTestId('stream-link-show').click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Its picture comes to rest on this page: two looks a whole second apart show the same frame (two looks closer than a
 * frame would match while it still moved). Returns the last look; the frames seen and the players said on a failure.
 */
async function cameToRest(page: Page, why: string): Promise<LinkLook> {
  let held = await linkLook(page);
  const seen: string[] = [];
  try {
    await expect
      .poll(
        async () => {
          await letTimePass(page, 1000, 'the screen plays out what it had');
          const now = await linkLook(page);
          seen.push(`${String(now.frame)} [${now.state ?? '-'}]`);
          const still = now.frame !== null && now.frame === held.frame;
          held = now;
          return still;
        },
        { message: why, intervals: [100], timeout: 15_000 },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${why}: frames a second apart ${seen.join(', ')}; the last look ${JSON.stringify(held)} Main: ${mainSaid()}: ${String(error)}`,
      { cause: error },
    );
  }
  return held;
}

/** Its pictures move on this page: later looks show later frames, never black (each look's players said on a failure). */
async function moving(page: Page, why: string, within: string | null = null): Promise<void> {
  let last = await linkLook(page, within);
  const said = () => `${why}: ${JSON.stringify(last)} Main: ${mainSaid()}`;
  try {
    await expect
      .poll(
        async () => {
          last = await linkLook(page, within);
          return last.frame;
        },
        { message: why, timeout: 15_000 },
      )
      .not.toBeNull();
  } catch (error) {
    throw new Error(`${said()} (no picture shown): ${String(error)}`, { cause: error });
  }
  const first = last.frame ?? 0;
  try {
    await expect
      .poll(
        async () => {
          last = await linkLook(page, within);
          return last.frame ?? 0;
        },
        { message: why, timeout: 10_000 },
      )
      .toBeGreaterThan(first + 10);
  } catch (error) {
    // Said with the players' joins and clocks as they were at the last look.
    throw new Error(`${said()} (from frame ${String(first)}): ${String(error)}`, { cause: error });
  }
  last = await linkLook(page, within);
  expect(last.luma, `${said()}: never black`).toBeGreaterThan(40);
}

async function hallAndLink(extra: Record<string, string> = {}) {
  const standIn = await liveStandIn();
  const { app, userData } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', ...extra });
  logFile = join(userData, 'logs', 'drashti.log');
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app);
  if (!hall) throw new Error('a screen expected');
  await expect(hall.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  await expect.poll(() => standIn.ready(), { timeout: 30_000 }).toBe(true);
  return { standIn, app, userData, win, hall };
}

async function closeAll(app: ElectronApplication, standIn: LiveStandIn): Promise<void> {
  await app.close();
  await standIn.close();
}

for (const earlyError of [false, true]) {
  test(`Show a Stream Link… puts a live stream on the hall’s screen and LIVE, moving; Drashti’s own stream shows the Wallpaper; Clear background takes it off and its folder goes${earlyError ? ' (an early-loaded native player fails)' : ''}`, async () => {
    test.setTimeout(180_000);
    const { standIn, app, userData, win, hall } = await hallAndLink();

    if (earlyError) {
      await hall.evaluate(() => {
        // The failed native players stayed unsupported, including replacement failures at 0.00 s. Keep
        // every player loaded before its joined moment unsupported until it is replaced; allowing its
        // next play call through would not model a native decode error (the first probe, CI31753).
        const prototype = HTMLMediaElement.prototype;
        const load = Object.getOwnPropertyDescriptor(prototype, 'load')?.value as
          ((this: HTMLMediaElement) => void) | undefined;
        const play = Object.getOwnPropertyDescriptor(prototype, 'play')?.value as
          ((this: HTMLMediaElement) => Promise<void>) | undefined;
        if (!load || !play) throw new Error('The native media methods are missing.');
        const probe = { loadedEarly: 0, failed: 0 };
        (globalThis as typeof globalThis & { linkPictureProbe?: typeof probe }).linkPictureProbe = probe;
        const early = new WeakSet<HTMLMediaElement>();
        prototype.load = function () {
          if (
            this.getAttribute('src') &&
            this.closest('[data-kind="link"]') !== null &&
            Number(this.dataset['startAt']) > Date.now()
          ) {
            early.add(this);
            probe.loadedEarly++;
          }
          load.call(this);
        };
        prototype.play = function () {
          if (!early.has(this)) return play.call(this);
          probe.failed++;
          Object.defineProperty(this, 'error', {
            configurable: true,
            get: () => ({ code: 4, message: 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE (injected)' }),
          });
          this.dispatchEvent(new Event('error'));
          return Promise.reject(
            new DOMException('The injected native HLS load failed.', 'NotSupportedError'),
          );
        };
      });
    }
    await showLink(win, standIn.url, true);
    expect((await background(win)).layers.background).toMatchObject({ kind: 'link', name: '127.0.0.1' });
    try {
      if (earlyError)
        await expect
          .poll(() =>
            hall.evaluate(() => {
              const page = globalThis as { linkPictureProbe?: { failed: number } };
              return page.linkPictureProbe?.failed ?? 0;
            }),
          )
          .toBeGreaterThan(0);
      await expect(hall.locator('[data-kind="link"]')).toHaveAttribute('data-link-state', 'live', {
        timeout: 15_000,
      });
    } catch (error) {
      throw new Error(`the first link picture: ${JSON.stringify(await linkLook(hall))} Main: ${mainSaid()}`, {
        cause: error,
      });
    } finally {
      await test.info().attach('Link picture startup', {
        body: JSON.stringify({
          earlyError,
          look: await linkLook(hall),
          probe: await hall.evaluate(
            () => (globalThis as typeof globalThis & { linkPictureProbe?: unknown }).linkPictureProbe ?? null,
          ),
        }),
        contentType: 'application/json',
      });
    }
    await moving(hall, 'the hall’s screen');
    await moving(win, 'LIVE', '[data-testid="live-preview"]');
    await expect(win.getByTestId('stream-link-notice')).toHaveAttribute('data-state', 'playing');

    // Drashti's own stream never carries it: the Wallpaper, and no player of it there.
    await win.getByTestId('open-stream').click();
    const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 60_000,
    });
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
    await expect(program.getByTestId('wallpaper')).toBeVisible({ timeout: 15_000 });
    await expect(program.locator('[data-kind="link"]')).toHaveCount(0);
    await win.getByRole('button', { name: 'Close stream' }).click();

    // Its own clear (F3, the background) takes it off: no player left, its local stream's folder gone.
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearLayer', layer: 'background' }),
    );
    await expect(hall.locator('[data-kind="link"]')).toHaveCount(0);
    await expect(win.getByTestId('stream-link-notice')).toHaveCount(0);
    const folder = join(userData, 'Stream links');
    await expect
      .poll(() => (existsSync(folder) ? readdirSync(folder).length : 0), { timeout: 15_000 })
      .toBe(0);
    await closeAll(app, standIn);
  });
}

for (const heldJump of [false, true]) {
  test(`a stream link’s sound plays in the hall at the Video level, and none of it in Drashti’s own stream${heldJump ? ' (a held timeline jumps ahead)' : ''}`, async () => {
    test.setTimeout(180_000);
    const { standIn, app, win, hall } = await hallAndLink();
    const audio = await audioPage(app);
    if (heldJump) {
      await audio.evaluate(() => {
        // CI x67-1121-122650-81592: the native HLS timeline jumps forward through its hold, repeatedly ahead,
        // while the actual sound stays paused. Deliver that state on its first hold, until its source is rejoined.
        const prototype = HTMLMediaElement.prototype;
        const pause = Object.getOwnPropertyDescriptor(prototype, 'pause')?.value as
          ((this: HTMLMediaElement) => void) | undefined;
        const load = Object.getOwnPropertyDescriptor(prototype, 'load')?.value as
          ((this: HTMLMediaElement) => void) | undefined;
        if (!pause || !load) throw new Error('The native media methods are missing.');
        const probe = { held: false, delivered: false, rejoined: false };
        (globalThis as typeof globalThis & { linkHoldProbe?: typeof probe }).linkHoldProbe = probe;
        const held = new WeakSet<HTMLMediaElement>();
        prototype.pause = function () {
          const from = this.currentTime;
          pause.call(this);
          if (probe.held || !this.dataset['key']?.startsWith('link:') || !this.getAttribute('src')) return;
          probe.held = true;
          held.add(this);
          const at = Date.now();
          Object.defineProperty(this, 'currentTime', {
            configurable: true,
            get: () => {
              probe.delivered = true;
              return from + 2 + (Date.now() - at) / 1000;
            },
          });
        };
        prototype.load = function () {
          if (held.has(this)) {
            Reflect.deleteProperty(this, 'currentTime');
            if (this.getAttribute('src')) probe.rejoined = true;
          }
          load.call(this);
        };
      });
    }
    const soundConsole: string[] = [];
    audio.on('console', (message) => soundConsole.push(`${message.type()}: ${message.text()}`));
    await audio.evaluate(() => {
      const prototype = AudioContext.prototype;
      const original = Object.getOwnPropertyDescriptor(prototype, 'createMediaElementSource')?.value as
        ((this: AudioContext, element: HTMLMediaElement) => MediaElementAudioSourceNode) | undefined;
      if (!original) throw new Error('The sound source method is missing.');
      prototype.createMediaElementSource = function (element) {
        const source = original.call(this, element);
        (globalThis as typeof globalThis & { linkSoundContext?: AudioContext }).linkSoundContext = this;
        return source;
      };
    });
    await showLink(win, standIn.url);
    await moving(hall, 'the hall’s screen');
    // The stand-in's tone through the audio player, under Video's level.
    const sound = audio.locator('audio[data-key^="link:"]');
    await expect(sound).toHaveCount(1);
    await expect(sound).toHaveAttribute('data-kind', 'video');
    const soundLooks: unknown[] = [];
    try {
      await expect
        .poll(
          async () => {
            const look = await audio.evaluate(() => {
              const el = document.querySelector<HTMLAudioElement>('audio[data-key^="link:"]');
              const context = (globalThis as typeof globalThis & { linkSoundContext?: AudioContext })
                .linkSoundContext;
              return {
                level: Number(document.body.dataset['level']),
                context: context ? { state: context.state, time: context.currentTime } : null,
                player: el
                  ? {
                      ...Object.fromEntries(Object.entries(el.dataset)),
                      time: el.currentTime,
                      paused: el.paused,
                      ready: el.readyState,
                      volume: el.volume,
                      muted: el.muted,
                      error: el.error?.message ?? null,
                    }
                  : null,
              };
            });
            soundLooks.push(look);
            return look.level;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(-50);
    } catch (error) {
      // Said with the hall's sound player as it was: its join, clock, events and how it failed, if it did.
      const player = await sound.evaluate((el: HTMLAudioElement) =>
        JSON.stringify({
          ...Object.fromEntries(Object.entries(el.dataset)),
          t: el.currentTime.toFixed(2),
          paused: el.paused,
          readyState: el.readyState,
          error: el.error ? el.error.code : null,
          now: Date.now(),
        }),
      );
      throw new Error(`the hall’s sound: ${player} Main: ${mainSaid()}: ${String(error)}`, { cause: error });
    } finally {
      await test.info().attach('Link sound state', {
        body: JSON.stringify({ heldJump, looks: soundLooks, console: soundConsole }, null, 2),
        contentType: 'application/json',
      });
    }
    if (heldJump)
      expect(
        await audio.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                linkHoldProbe?: { held: boolean; delivered: boolean; rejoined: boolean };
              }
            ).linkHoldProbe,
        ),
      ).toEqual({ held: true, delivered: true, rejoined: true });
    // Video's mute takes it away; unmuted, it is back.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.sound.setMuted('video', true));
    await expect.poll(async () => Number(await sound.getAttribute('data-gain'))).toBe(0);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.sound.setMuted('video', false));
    await expect.poll(async () => Number(await sound.getAttribute('data-gain'))).toBeGreaterThan(0);
    // Drashti's own stream mixes none of it.
    await win.getByTestId('open-stream').click();
    const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 60_000,
    });
    await letTimePass(program, 2000, 'the stream’s page has had its state');
    await expect(program.locator('audio[data-key^="link:"]')).toHaveCount(0);
    await win.getByRole('button', { name: 'Close stream' }).click();
    await closeAll(app, standIn);
  });
}

test('a stream link that drops: its last picture held while Drashti reconnects, the Wallpaper after 20 s, back by itself; never back once something else went up', async () => {
  test.setTimeout(300_000);
  const { standIn, app, win, hall } = await hallAndLink();
  await showLink(win, standIn.url);
  await moving(hall, 'the hall’s screen');

  // It drops: LIVE says so, and the screen keeps its last picture (the same frame, never black) until the Wallpaper.
  standIn.drop();
  const notice = win.getByTestId('stream-link-notice');
  await expect(notice).toHaveAttribute('data-state', 'reconnecting', { timeout: 15_000 });
  // The screen plays out the few seconds it had (it plays a little behind the stream), then keeps its last picture
  // (CI x54-1120-233555-18462: still moving as LIVE first said Reconnecting…).
  const held = await cameToRest(hall, 'the hall’s screen comes to rest on its last picture');
  expect(held.luma, `the last picture, never black: ${JSON.stringify(held)}`).toBeGreaterThan(40);
  for (let i = 0; i < 4; i++) {
    await letTimePass(hall, 1000, 'the link stays gone');
    const now = await linkLook(hall);
    if ((await background(win)).wallpaper) break;
    expect(now.frame, 'the same picture held').toBe(held.frame);
    expect(now.luma, 'never black').toBeGreaterThan(40);
  }
  await expect.poll(async () => (await background(win)).wallpaper, { timeout: 30_000 }).toBe(true);
  expect((await background(win)).layers.background).toBeNull();
  await expect(hall.getByTestId('wallpaper')).toBeVisible();
  await expect(notice).toHaveAttribute('data-state', 'wallpaper');

  // It comes back: up again by itself, the Wallpaper off, moving.
  standIn.back();
  await expect
    .poll(async () => (await background(win)).layers.background?.kind, { timeout: 45_000 })
    .toBe('link');
  expect((await background(win)).wallpaper).toBe(false);
  await moving(hall, 'the hall’s screen, back');
  await expect(notice).toHaveAttribute('data-state', 'playing');

  // It drops again; the Wallpaper goes up; the operator puts a slide up meanwhile: it never comes back over that.
  standIn.drop();
  await expect.poll(async () => (await background(win)).wallpaper, { timeout: 45_000 }).toBe(true);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
  standIn.back();
  await letTimePass(win, 15_000, 'the stand-in back long enough to have come back');
  const after = await background(win);
  expect(after.layers.background).toBeNull();
  expect(after.layers.slide).not.toBeNull();
  await expect(hall.locator('[data-kind="link"]')).toHaveCount(0);
  await closeAll(app, standIn);
});

test('a YouTube live link through Drashti’s yt-dlp (the fake): never looked at while the stream is on air; shown once off air', async () => {
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-stream-link-yt-'));
  const log = join(work, 'fake.log');
  const standIn = await liveStandIn();
  const { app, win, hall } = await (async () => {
    const launched = await launchApp({
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_TEST_ON_AIR_HOOK: '1',
      DRASHTI_TEST_FAKE_YT_DLP: FAKE,
      DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
        log,
        title: 'Placeholder live',
        live: 'is_live',
        liveUrl: standIn.url,
      }),
    });
    logFile = join(launched.userData, 'logs', 'drashti.log');
    const page = await operatorPage(launched.app);
    await operatorReady(page);
    await setUpScreen(page, 'Main Hall', 0);
    await expect.poll(() => outputPages(launched.app).length).toBe(1);
    const [out] = outputPages(launched.app);
    if (!out) throw new Error('a screen expected');
    // Ready to draw the show (its warm-up over), as hallAndLink waits.
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
    return { app: launched.app, win: page, hall: out };
  })();
  await expect.poll(() => standIn.ready(), { timeout: 30_000 }).toBe(true);
  const setOnAir = (on: boolean) =>
    app.evaluate((_electron, value) => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(value);
    }, on);
  const LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';

  // On air: refused, saying why; yt-dlp never started.
  await setOnAir(true);
  await openSection(win, 'show-a-stream-link');
  await win.getByTestId('show-a-stream-link').click();
  const dialog = win.getByTestId('stream-link-dialog');
  await dialog.getByTestId('stream-link-text').fill(LINK);
  await dialog.getByTestId('stream-link-show').click();
  await expect(dialog.getByTestId('stream-link-problem')).toContainText(
    'only while the stream is off air and not recording',
  );
  expect(existsSync(log) ? readFileSync(log, 'utf8') : '').not.toContain('start look');
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Off air: looked at once, and its stream shown.
  await setOnAir(false);
  await showLink(win, LINK);
  expect(readFileSync(log, 'utf8')).toContain('start look AAAAAAAAAAA');
  expect((await background(win)).layers.background).toMatchObject({ kind: 'link', name: 'YouTube live' });
  await moving(hall, 'the hall’s screen');
  await closeAll(app, standIn);
});

test('a link to anywhere but this computer is refused in a test run; Simple Mode cannot show one; after an unexpected stop it is not put back, and the notice says so', async () => {
  test.setTimeout(180_000);
  const { standIn, app, userData, win, hall } = await hallAndLink();
  // Never the internet from a test: refused before anything is asked.
  await openSection(win, 'show-a-stream-link');
  await win.getByTestId('show-a-stream-link').click();
  const dialog = win.getByTestId('stream-link-dialog');
  await dialog.getByTestId('stream-link-text').fill('https://media.example.org/live/placeholder.m3u8');
  await dialog.getByTestId('stream-link-show').click();
  await expect(dialog.getByTestId('stream-link-problem')).toContainText('Test guard');
  // Checked as typed: not a stream's link.
  await dialog.getByTestId('stream-link-text').fill('https://media.example.org/placeholder.mp4');
  await expect(dialog).toContainText('does not end in .m3u8');
  await expect(dialog.getByTestId('stream-link-show')).toBeDisabled();
  await win.keyboard.press('Escape');

  await showLink(win, standIn.url);
  await moving(hall, 'the hall’s screen');
  await expect
    .poll(() => {
      const file = join(userData, 'live-state.json');
      if (!existsSync(file)) return null;
      return (JSON.parse(readFileSync(file, 'utf8')) as { background: { kind?: string } | null }).background
        ?.kind;
    })
    .toBe('link');
  await killApp(app);
  const again = await relaunchApp(userData, { DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await expect(win2.getByTestId('recovery-notice')).toContainText(
    'The stream link from “127.0.0.1” was on the screens and was not put back: Show a Stream Link… shows it again.',
  );
  expect((await background(win2)).layers.background).toBeNull();

  // Simple Mode: no Show a Stream Link…, and the main process refuses one from the window too.
  await win2.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win2.getByTestId('simple-mode')).toBeVisible();
  expect(
    await win2.evaluate((url) => (globalThis as PageGlobals).drashti.liveLink.show(url), standIn.url),
  ).toMatchObject({ ok: false });
  expect((await background(win2)).layers.background).toBeNull();
  await closeAll(again.app, standIn);
});
