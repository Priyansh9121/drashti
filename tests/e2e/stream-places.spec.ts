import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import { freePort, rtmpListener, setUpStream, TEST_KEY, testFfmpeg } from './stream-helpers';

/*
 * Several platforms at once (Session 28, decision 18): one encode, up to three places, each with its own
 * key and its own connection. Every place here is FFmpeg listening on this computer (a test never streams
 * to the internet: the guard below refuses any other address). Made-up keys only.
 */

const FAKE = { DRASHTI_TEST_FAKE_DEVICES: '1' };
const ffmpeg = testFfmpeg();

test.skip(!ffmpeg, 'needs the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs)');

const listeners: ChildProcess[] = [];
test.afterEach(() => {
  for (const l of listeners.splice(0)) l.kill('SIGKILL');
});

test('one stream to two places at once: both receive it; one dropping leaves the other going, ON AIR says 1 of 2 and the panel names it, and it comes back', async () => {
  test.setTimeout(180_000);
  const [portA, portB] = [await freePort(), await freePort()];
  const dir = mkdtempSync(join(tmpdir(), 'drashti-places-'));
  const first = rtmpListener(ffmpeg ?? '', portA, join(dir, 'first.flv'));
  listeners.push(first, rtmpListener(ffmpeg ?? '', portB, join(dir, 'second.flv')));
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUpStream(app, win, portA, dir);
  // A second place, with its own key.
  const added = await win.evaluate(
    async ({ port, key }) => {
      const d = (globalThis as PageGlobals).drashti;
      const { profiles, activeId } = await d.stream.profiles();
      const p = profiles.find((x) => x.id === activeId);
      if (!p) return 'no profile';
      const { id, hasKey: _hasKey, more: _more, ...input } = p;
      const saved = await d.stream.saveProfile(id, {
        ...input,
        preset: 'weak',
        more: [{ url: `rtmp://127.0.0.1:${String(port)}/live2` }],
      });
      if (!saved.ok) return saved.message;
      const place = saved.profiles.profiles.find((x) => x.id === id)?.more[0];
      if (!place) return 'no place';
      const kept = await d.stream.setKey(id, key, place.id);
      return kept.ok ? 'ok' : kept.message;
    },
    { port: portB, key: TEST_KEY },
  );
  expect(added).toBe('ok');

  const panel = win.getByTestId('stream-panel');
  await panel.getByTestId('go-live').click();
  const confirm = win.getByTestId('go-live-confirm');
  await expect(confirm).toContainText('Go live on the stream server (2 places)?');
  await confirm.getByRole('button', { name: 'Go live' }).click();
  const onAir = win.getByTestId('on-air');
  await expect(onAir).toHaveText('On air · 2 of 2', { timeout: 40_000 });
  await expect(panel.getByTestId('stream-place')).toHaveCount(2);

  // The first place goes away: the stream stays on air on the other, and says which one is reconnecting.
  first.kill('SIGKILL');
  await expect(onAir).toHaveText('On air · 1 of 2', { timeout: 30_000 });
  await expect(panel.getByTestId('stream-live-message')).toContainText('the stream server');
  await expect(panel.locator('[data-testid="stream-place"][data-state="reconnecting"]')).toHaveCount(1);
  // Back: both again.
  listeners.push(rtmpListener(ffmpeg ?? '', portA, join(dir, 'first-again.flv')));
  await expect(onAir).toHaveText('On air · 2 of 2', { timeout: 40_000 });
  await letTimePass(win, 3000, 'both places carry the stream a few seconds again');

  await panel.getByTestId('end-stream').click();
  await win.getByTestId('end-confirm').getByRole('button', { name: 'End the stream' }).click();
  await expect(onAir).toHaveCount(0);
  await app.close();
  // Both places received the stream.
  await expect
    .poll(() => statSync(join(dir, 'second.flv')).size, { timeout: 10_000 })
    .toBeGreaterThan(10_000);
  await expect
    .poll(() => statSync(join(dir, 'first-again.flv')).size, { timeout: 10_000 })
    .toBeGreaterThan(1000);
});

test('a test streams only to 127.0.0.1: any other address is refused before anything starts', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp(FAKE);
  const win = await operatorPage(app);
  await operatorReady(win);
  const refused = await win.evaluate(async (key) => {
    const d = (globalThis as PageGlobals).drashti;
    const { profiles, activeId } = await d.stream.profiles();
    const p = profiles.find((x) => x.id === activeId);
    if (!p) return ['no profile'];
    const { id, hasKey: _hasKey, more: _more, ...input } = p;
    const answers: string[] = [];
    // Addresses that are not 127.0.0.1, yet on this computer, so that even a Drashti without the guard (its
    // red run) never reaches the internet: as the profile's own, then as a second place.
    for (const more of [[], [{ url: 'rtmps://localhost:1936/rtmp' }]]) {
      const url = more.length === 0 ? 'rtmp://127.0.0.2:1935/live2' : 'rtmp://127.0.0.1:1935/live2';
      const saved = await d.stream.saveProfile(id, { ...input, url, more });
      if (!saved.ok) return [saved.message];
      await d.stream.setKey(id, key);
      const place = saved.profiles.profiles.find((x) => x.id === id)?.more[0];
      if (place) await d.stream.setKey(id, key, place.id);
      const live = await d.stream.goLive({ confirmed: true });
      answers.push(live.ok ? 'went live' : live.message);
      if (live.ok) await d.stream.end({ confirmed: true });
    }
    return answers;
  }, TEST_KEY);
  expect(refused).toEqual([
    'A test streams only to this computer (127.0.0.1).',
    'A test streams only to this computer (127.0.0.1).',
  ]);
  await app.close();
});
