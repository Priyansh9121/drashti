import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { YOUTUBE_KEY_STILL_GOES, YOUTUBE_WORDS } from '../../src/shared/youtube';
import {
  googleStandIn,
  STANDIN_CHANNEL,
  STANDIN_CLIENT_ID,
  STANDIN_CLIENT_SECRET,
  type GoogleStandIn,
} from '../youtube-standin';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import { launchApp, letTimePass, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { logText } from './log-lines';
import { filesUnder, findSecrets } from './secrets';
import { freePort, readFlv, rtmpListener, streamPage, testFfmpeg } from './stream-helpers';

/*
 * Scheduling a YouTube stream from Drashti (x31), against a stand-in for Google on this computer (127.0.0.1:
 * tests/youtube-standin.ts: its sign-in page, token endpoint and YouTube's calls) and FFmpeg listening for the stream
 * on this computer: nothing ever reaches Google or YouTube, and no browser opens (the test plays the person's
 * browser). Made-up clients, tokens and keys, placeholder words, Chromium's fake camera and microphone.
 */

const ffmpeg = testFfmpeg();
// CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1', DRASHTI_TEST_YOUTUBE_STATE_MS: '1000' };
const listeners: ChildProcess[] = [];
const stands: GoogleStandIn[] = [];

test.afterEach(async () => {
  for (const l of listeners.splice(0)) l.kill('SIGKILL');
  for (const s of stands.splice(0)) await s.close();
});

async function google(ingestion: string): Promise<GoogleStandIn> {
  const s = await googleStandIn({ ingestion });
  stands.push(s);
  return s;
}

const status = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());

/** The person's browser: Drashti hands it Google's address; the test keeps each one, and opens nothing. */
async function noBrowser(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { openedAddresses?: string[] }).openedAddresses = opened;
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
  return () =>
    app.evaluate(() => [...((globalThis as { openedAddresses?: string[] }).openedAddresses ?? [])]);
}

/** Stream settings open, the stream's page ready, the fake camera and microphone chosen. */
async function openSettings(app: ElectronApplication, win: Page): Promise<void> {
  await win.getByTestId('open-stream').click();
  await streamPage(app);
  await expect
    .poll(async () => {
      const s = await status(win);
      return s.inputs.cameras.length > 0 && s.inputs.microphones.length > 0;
    })
    .toBe(true);
  const chosen = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const s = await d.stream.status();
    const r = await d.stream.setInputs(s.inputs.cameras[0] ?? null, s.inputs.microphones[0] ?? null);
    return r.ok ? 'ok' : r.message;
  });
  expect(chosen).toBe('ok');
  await win.getByTestId('open-stream-settings').click();
  await expect(win.getByTestId('youtube-settings')).toBeVisible();
}

/** Set up the made-up client and sign in, the test playing the browser. */
async function signIn(win: Page, standIn: GoogleStandIn, opened: () => Promise<string[]>): Promise<void> {
  const youtube = win.getByTestId('youtube-settings');
  await youtube.getByTestId('youtube-set-up').click();
  await youtube.getByTestId('youtube-client-id').fill(STANDIN_CLIENT_ID);
  await youtube.getByTestId('youtube-client-secret').fill(STANDIN_CLIENT_SECRET);
  await youtube.getByTestId('youtube-client-save').click();
  await youtube.getByTestId('youtube-sign-in').click();
  await expect(youtube.getByTestId('youtube-signing-in')).toBeVisible();
  await expect.poll(async () => (await opened()).length).toBe(1);
  const [address] = await opened();
  // Google's page, on the stand-in: never Google's own.
  expect(new URL(address ?? '').origin).toBe(standIn.base);
  const browsed = await standIn.browse(address ?? '');
  expect(browsed).toMatchObject({ status: 200, reachedDrashti: true });
  expect(browsed.page).toContain('Signed in to YouTube');
  await expect(youtube.getByTestId('youtube-signed-in')).toHaveText(
    `Signed in to YouTube: ${STANDIN_CHANNEL}`,
  );
}

/** Tomorrow's date as a date field holds it. */
function tomorrow(): string {
  const at = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

test('schedule on YouTube, the key in the profile by itself, go live on that broadcast and end it there; nothing secret left anywhere', async () => {
  test.setTimeout(240_000);
  const port = await freePort();
  const ingestion = `rtmp://127.0.0.1:${String(port)}/live2`;
  const standIn = await google(ingestion);
  const { app, userData } = await launchApp({ ...FAKE, DRASHTI_TEST_GOOGLE_STANDIN: standIn.base });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const opened = await noBrowser(app);
  await openSettings(app, win);
  const settings = win.getByTestId('stream-settings');
  await expectNoSeriousA11yIssues(win, 'the stream settings with YouTube not set up');
  await signIn(win, standIn, opened);
  await expect(settings.getByTestId('youtube-sign-out-note')).toHaveText(YOUTUBE_WORDS.signOutNote);
  // The channel's list is asked once as it signs in, never again and again (CI x31-1120-004519-9080: each answer
  // sent a status, and the window asked again on every status).
  await expect(settings.getByTestId('youtube-refresh')).toBeEnabled();
  const listed = () => standIn.calls.filter((c) => c === 'GET /youtube/v3/liveBroadcasts').length;
  await letTimePass(win, 3000, 'time for the list to be asked again, were it asked in a loop');
  expect(listed()).toBeGreaterThanOrEqual(1);
  expect(listed()).toBeLessThanOrEqual(2);

  // Schedule it: Unlisted and not made for children to begin with, and streamed to from this profile.
  await settings.getByTestId('youtube-schedule-open').click();
  const dialog = win.getByTestId('youtube-schedule');
  await expect(dialog.getByTestId('youtube-privacy')).toHaveValue('unlisted');
  await expect(dialog.getByTestId('youtube-for-kids')).toHaveValue('no');
  await dialog.getByTestId('youtube-title').fill('Placeholder sabha');
  await dialog.getByTestId('youtube-description').fill('Placeholder words.');
  await dialog.getByTestId('youtube-date').fill(tomorrow());
  await dialog.getByTestId('youtube-time').fill('18:30');
  await expectNoSeriousA11yIssues(win, 'Schedule a stream');
  await expectFits(dialog, 'Schedule a stream at 1280 x 720');
  await dialog.getByTestId('youtube-schedule-save').click();
  await expect(dialog).toHaveCount(0);

  // On the stand-in: as asked, starting by itself and never ending by itself, with a one-use stream bound.
  await expect.poll(() => standIn.broadcasts.size).toBe(1);
  const [broadcast] = [...standIn.broadcasts.values()];
  expect(broadcast).toMatchObject({
    title: 'Placeholder sabha',
    description: 'Placeholder words.',
    privacyStatus: 'unlisted',
    selfDeclaredMadeForKids: false,
    enableAutoStart: true,
    enableAutoStop: false,
    lifeCycleStatus: 'ready',
  });
  const starts = new Date(Date.parse(broadcast?.scheduledStartTime ?? ''));
  expect([starts.getHours(), starts.getMinutes()]).toEqual([18, 30]);
  const stream = standIn.streams.get(broadcast?.boundStreamId ?? '');
  expect(stream?.isReusable).toBe(false);
  const key = stream?.key ?? '';

  // The profile: the broadcast's address and a saved key, never shown; it names the broadcast.
  await expect(settings.getByTestId('youtube-link')).toContainText('Placeholder sabha');
  await expect(settings.getByTestId('youtube-link')).toContainText('Unlisted');
  await expect(settings.getByTestId('stream-key-saved')).toBeVisible();
  await expect(settings.getByTestId('stream-url')).toHaveValue(ingestion);
  await expect(settings.getByTestId('youtube-broadcast')).toHaveCount(1);
  await expect(settings.getByTestId('youtube-broadcast')).toContainText('This profile streams here');
  await expectNoSeriousA11yIssues(win, 'the stream settings, signed in, with a broadcast');
  await expectFits(settings, 'the stream settings signed in at 1280 x 720');
  expect(await win.evaluate(() => document.documentElement.outerHTML)).not.toContain(key);
  await settings.getByRole('button', { name: 'Close stream settings' }).click();

  // Go live: today's Go live, naming the broadcast; FFmpeg on this computer receives it at the broadcast's key.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-youtube-'));
  const got = join(dir, 'received.flv');
  listeners.push(rtmpListener(ffmpeg ?? '', port, got, undefined, key));
  const panel = win.getByTestId('stream-panel');
  await expect(panel.getByTestId('youtube-panel-link')).toContainText('Placeholder sabha');
  await panel.getByTestId('go-live').click();
  const confirm = win.getByTestId('go-live-confirm');
  await expect(confirm).toContainText('“Placeholder sabha”');
  const calls = standIn.calls.length;
  await confirm.getByRole('button', { name: 'Go live' }).click();
  await expect.poll(async () => (await status(win)).live.state, { timeout: 60_000 }).toBe('live');
  // Going live asked Google nothing (the state is asked only after it, every second in this test).
  expect(standIn.calls.slice(calls).filter((c) => c !== 'GET /youtube/v3/liveBroadcasts')).toEqual([]);
  await expect.poll(() => existsSync(got) && statSync(got).size > 0, { timeout: 30_000 }).toBe(true);
  await expect.poll(() => readFlv(got).videoFrames, { timeout: 30_000 }).toBeGreaterThan(30);

  // YouTube hears the stream and starts the broadcast by itself; the panel says so.
  standIn.streamArrived(key);
  await expect(panel.getByTestId('youtube-state')).toHaveText('Live on YouTube', { timeout: 30_000 });
  await expectNoSeriousA11yIssues(win, 'the Stream panel on air to a broadcast');

  // End the stream… ends it on YouTube too.
  await panel.getByTestId('end-stream').click();
  const end = win.getByTestId('end-confirm');
  await expect(end).toContainText('This also ends “Placeholder sabha” on YouTube.');
  await end.getByRole('button', { name: 'End the stream' }).click();
  await expect.poll(async () => (await status(win)).live.state).toBe('off');
  await expect.poll(() => broadcast?.lifeCycleStatus, { timeout: 30_000 }).toBe('complete');
  await expect(panel.getByTestId('youtube-state')).toHaveText('Ended on YouTube');
  await app.close();

  // Nothing secret anywhere Drashti wrote: the stream key, the tokens and the client secret (all made up here).
  const found = findSecrets(filesUnder(userData), standIn.secrets());
  expect(found).toEqual([]);
  expect(filesUnder(userData).some((f) => f.endsWith('youtube-sign-in.json'))).toBe(true);
});

test('Google’s failures are plain sentences, and the saved key still goes live: no internet, the day’s quota, a sign-in Google no longer takes', async () => {
  test.setTimeout(180_000);
  const port = await freePort();
  const standIn = await google(`rtmp://127.0.0.1:${String(port)}/live2`);
  const { app } = await launchApp({ ...FAKE, DRASHTI_TEST_GOOGLE_STANDIN: standIn.base });
  const win = await operatorPage(app);
  await operatorReady(win);
  const opened = await noBrowser(app);
  await openSettings(app, win);
  const settings = win.getByTestId('stream-settings');
  await signIn(win, standIn, opened);
  const studio = standIn.addBroadcast({ title: 'Placeholder from Studio' });
  await settings.getByTestId('youtube-refresh').click();
  await expect(settings.getByTestId('youtube-broadcast')).toContainText('Placeholder from Studio');
  await settings.getByTestId('youtube-use').click();
  await expect(settings.getByTestId('youtube-link')).toContainText('Placeholder from Studio');
  const key = standIn.streams.get(studio.boundStreamId ?? '')?.key ?? '';

  standIn.mode = 'offline';
  await settings.getByTestId('youtube-refresh').click();
  await expect(settings.getByTestId('youtube-message')).toHaveText(
    `${YOUTUBE_WORDS.offline} ${YOUTUBE_KEY_STILL_GOES}`,
  );
  standIn.mode = 'quota';
  await settings.getByTestId('youtube-refresh').click();
  await expect(settings.getByTestId('youtube-message')).toContainText(
    'YouTube’s daily allowance for your Google project is used up. It starts again at',
  );
  standIn.mode = 'answer';
  standIn.refuseRefreshTokens();
  await settings.getByTestId('youtube-refresh').click();
  await expect(settings.getByTestId('youtube-message')).toHaveText(YOUTUBE_WORDS.signedOut);
  await expect(settings.getByTestId('youtube-sign-in')).toBeVisible();
  // The broadcast's key is still the profile's, and still goes live, with Google out of reach.
  await expect(settings.getByTestId('youtube-link')).toContainText('Placeholder from Studio');
  await settings.getByRole('button', { name: 'Close stream settings' }).click();
  standIn.mode = 'offline';
  const dir = mkdtempSync(join(tmpdir(), 'drashti-youtube-'));
  const got = join(dir, 'received.flv');
  listeners.push(rtmpListener(ffmpeg ?? '', port, got, undefined, key));
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.goLive({ confirmed: true });
  });
  await expect.poll(async () => (await status(win)).live.state, { timeout: 60_000 }).toBe('live');
  await expect.poll(() => existsSync(got) && statSync(got).size > 0, { timeout: 30_000 }).toBe(true);
  await win.evaluate(async () => {
    await (globalThis as PageGlobals).drashti.stream.end({ confirmed: true });
  });
  await expect.poll(async () => (await status(win)).live.state).toBe('off');
  // Ending could not reach YouTube: it says so, and offers to end it there later.
  await expect(win.getByTestId('youtube-end-there')).toBeVisible({ timeout: 30_000 });
  await app.close();
});

test('Pro Mode’s: Simple Mode refuses it all but its status', async () => {
  const standIn = await google('rtmp://127.0.0.1:1935/live2');
  const { app } = await launchApp({ ...FAKE, DRASHTI_TEST_GOOGLE_STANDIN: standIn.base });
  const win = await operatorPage(app);
  await operatorReady(win);
  const answers = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const set = await d.app.setMode('simple');
    const status = await d.youtube.status();
    const tried = [
      await d.youtube.setClient('000000000000-x.apps.googleusercontent.com', 'test-made-up-secret'),
      await d.youtube.signIn(),
      await d.youtube.upcoming(),
      await d.youtube.schedule({
        title: 'Placeholder',
        description: '',
        startsAt: Date.now() + 3_600_000,
        privacy: 'unlisted',
        madeForKids: false,
        profileId: null,
      }),
    ];
    return { set: set.ok, client: status.client, tried: tried.map((r) => (r.ok ? 'done' : r.message)) };
  });
  expect(answers.set).toBe(true);
  expect(answers.client).toBe(false);
  expect(answers.tried).toEqual([
    SIMPLE_MODE_REFUSAL,
    SIMPLE_MODE_REFUSAL,
    SIMPLE_MODE_REFUSAL,
    SIMPLE_MODE_REFUSAL,
  ]);
  expect(standIn.calls).toEqual([]);
  await app.close();
});

test('a test reaches only the stand-in: without it, Google’s own page is never opened and nothing is sent', async () => {
  const { app, userData } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  const opened = await noBrowser(app);
  const said = await win.evaluate(
    async ({ id, secret }) => {
      const d = (globalThis as PageGlobals).drashti;
      const client = await d.youtube.setClient(id, secret);
      const signIn = await d.youtube.signIn();
      return [client.ok ? 'kept' : client.message, signIn.ok ? 'signing in' : signIn.message];
    },
    { id: STANDIN_CLIENT_ID, secret: STANDIN_CLIENT_SECRET },
  );
  expect(said).toEqual(['kept', YOUTUBE_WORDS.testGuard]);
  expect(await opened()).toEqual([]);
  await app.close();
  const log = logText(userData);
  expect(log).toContain('TEST GUARD: opening Google’s sign-in page was refused: not 127.0.0.1');
  expect(
    findSecrets(filesUnder(userData), [{ label: 'the made-up client secret', value: STANDIN_CLIENT_SECRET }]),
  ).toEqual([]);
});
