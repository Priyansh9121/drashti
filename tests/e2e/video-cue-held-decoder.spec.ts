import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { letTimePass } from './helpers';
import type { PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';

/*
 * A cue held past Chromium's idle release (a24-cue306). Chromium lets go of a paused media player's decoder once it has
 * been idle 15 s (looked at every 5 s), unless its video fills most of its page: LIVE's preview in the operator window
 * does not, nor does the sound window's audio. Go then had to set them up again inside its 120 ms lead, and LIVE started
 * up to 207 ms late on CI's Mac (video-cue-crossfade.spec.ts:306, which a slower rebuild fails). Read here from
 * Chromium's own media trace, with no timing bound: no page's player is set up again from Cue ready to every page
 * moving after Go.
 */

/** Past Chromium's 15 s idle time and its next look, 5 s on. */
const HOLD_MS = 22_000;

const video = (page: Page, id: string) => page.locator(`video[data-media-id="${id}"]`).first();

interface TraceEvent {
  pid?: number;
  ph?: string;
  name?: string;
  args?: { rate?: number };
}

test('A cue held past Chromium’s idle release keeps every page’s player: Go sets none up again', async () => {
  test.setTimeout(120_000);
  const { app, win, hall, stream, audio, ids, dir } = await setupVideoCue();
  const tracePath = join(dir, 'held-decoder-media-trace.json');
  let tracing = false;
  try {
    const id = ids[1] ?? '';
    await win.evaluate(
      ({ id, startMs }) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(id, { startMs, endMs: 7000, markers: [] }),
      { id, startMs: 1000 },
    );
    await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#205020' } });
    expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
    await cueReady(win);
    const cue = (await snapshot(win)).videoCue;
    if (!cue) throw new Error('No video cue');
    // Every page's player is set up by now: from here on, Chromium's media trace shows any set up again.
    await app.evaluate(async ({ contentTracing }) => {
      await contentTracing.startRecording({ included_categories: ['media'] });
    });
    tracing = true;
    await letTimePass(
      win,
      HOLD_MS,
      "the operator's wait between Cue and Go, past Chromium's idle release of a paused player",
    );
    expect((await snapshot(win)).videoCue?.id).toBe(cue.id);
    // Still held: paused on its trimmed frame on every picture page, its sound paused.
    for (const page of [hall, win, stream]) {
      await expect(video(page, id)).toHaveJSProperty('paused', true);
      expect(await video(page, id).evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 2);
    }
    const sound = audio.locator(`audio[data-media-id="${id}"]`);
    await expect(sound).toHaveJSProperty('paused', true);
    await win.getByRole('button', { name: 'Go cued video', exact: true }).click();
    for (const page of [hall, win, stream])
      await expect
        .poll(() => video(page, id).evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 1.1))
        .toBe(true);
    await expect(sound).toHaveJSProperty('paused', false);
    await app.evaluate(async ({ contentTracing }, path) => contentTracing.stopRecording(path), tracePath);
    tracing = false;
    await test
      .info()
      .attach('held-decoder-media-trace.json', { path: tracePath, contentType: 'application/json' });
    const events =
      (JSON.parse(readFileSync(tracePath, 'utf8')) as { traceEvents?: TraceEvent[] }).traceEvents ?? [];
    const pages = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        page: w.webContents.getURL().split('/').pop()?.split('?')[0] ?? '',
        pid: w.webContents.getOSProcessId(),
      })),
    );
    const setUpAgain = events
      .filter((e) => e.name === 'RendererImpl::Initialize' && (e.ph === 'b' || e.ph === 'B' || e.ph === 'X'))
      .map((e) => ({ pid: e.pid, page: pages.find((p) => p.pid === e.pid)?.page ?? null }));
    const rateSets = events.filter(
      (e) => e.name === 'RendererImpl::SetPlaybackRate' && (e.args?.rate ?? 0) >= 1,
    ).length;
    await test.info().attach('held-decoder.json', {
      body: Buffer.from(JSON.stringify({ holdMs: HOLD_MS, pages, setUpAgain, rateSets })),
      contentType: 'application/json',
    });
    // The trace saw Go (each player's rate set for it), so an empty list below is read, not missed.
    expect(rateSets, "Chromium's media trace covers Go").toBeGreaterThan(0);
    expect(
      setUpAgain,
      'no page’s player is set up again between Cue ready and every page moving: Go only sets their rates',
    ).toEqual([]);
  } finally {
    if (tracing)
      await app
        .evaluate(async ({ contentTracing }, path) => contentTracing.stopRecording(path), tracePath)
        .catch(() => null);
    await app.close();
  }
});
