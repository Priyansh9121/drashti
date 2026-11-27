import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { letTimePass } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';

/*
 * Diagnostics only (goquiet, alpha.24; removed before the piece is READY): what the operator window's main thread runs
 * across a cued Go (video-cue-crossfade.spec.ts:303's steps, no hold). Chromium's Long Animation Frames name each
 * frame's scripts (their invoker, function and place in the bundle) and its style, layout and paint; the LIVE picture's
 * rate sets are noted as the crossfade spec notes them. No verdict: the test passes whatever it sees.
 */

test('Diagnostics only (goquiet): the operator window’s long frames across a cued Go', async () => {
  const { app, win, ids } = await setupVideoCue();
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
    await win.evaluate((id) => {
      const g = globalThis as { goQuiet?: { frames: unknown[]; rates: unknown[]; ticks: number[] } };
      const record: { frames: unknown[]; rates: unknown[]; ticks: number[] } = {
        frames: [],
        rates: [],
        ticks: [],
      };
      g.goQuiet = record;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) record.frames.push(entry.toJSON());
      }).observe({ type: 'long-animation-frame', buffered: false });
      // The page's own 20 ms timer, as the cue specs' lag record, on the page's steady clock.
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        if (now - last > 35 && record.ticks.length < 400) record.ticks.push(last, now);
        last = now;
      }, 20);
      const v = document.querySelector<HTMLVideoElement>(`video[data-media-id="${id}"]`);
      const rate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      if (v && rate?.set)
        Object.defineProperty(v, 'playbackRate', {
          configurable: true,
          get(this: HTMLMediaElement) {
            return rate.get?.call(this) as number;
          },
          set(this: HTMLMediaElement, value: number) {
            record.rates.push({ at: performance.now(), rate: value });
            rate.set?.call(this, value);
          },
        });
    }, id);
    await win.getByRole('button', { name: 'Go cued video', exact: true }).click();
    const bg = (await snapshot(win)).layers.background;
    if (bg?.kind !== 'media' || !bg.seek) throw new Error('No scheduled Go');
    const goAt = bg.seek.at;
    await letTimePass(win, 1500, 'the Go and the operator window’s work after it');
    const record = await win.evaluate(() => {
      const g = globalThis as { goQuiet?: unknown };
      // The page's steady clock against the engine's (Date.now on this computer).
      return { record: g.goQuiet, origin: performance.timeOrigin, now: performance.now(), wall: Date.now() };
    });
    await test.info().attach('go-quiet-frames.json', {
      body: Buffer.from(JSON.stringify({ goAt, ...record })),
      contentType: 'application/json',
    });
    // One line in the job log, green or not (a passing run keeps no report): every long frame near Go, from Go.
    const go = goAt - record.origin;
    const kept = record.record as {
      frames: {
        startTime: number;
        duration: number;
        renderStart: number;
        styleAndLayoutStart: number;
        blockingDuration: number;
        scripts: {
          startTime: number;
          duration: number;
          invoker: string;
          invokerType: string;
          sourceFunctionName: string;
          sourceURL: string;
          sourceCharPosition: number;
          forcedStyleAndLayoutDuration: number;
        }[];
      }[];
      rates: { at: number; rate: number }[];
      ticks: number[];
    };
    const ms = (t: number) => Math.round((t - go) * 10) / 10;
    const near = kept.frames.filter((f) => f.startTime + f.duration > go - 300 && f.startTime < go + 300);
    console.log(
      `GOQUIET ${JSON.stringify({
        rates: kept.rates.map((r) => [ms(r.at), r.rate]),
        held: kept.ticks.map(ms),
        frames: near.map((f) => ({
          at: ms(f.startTime),
          ms: Math.round(f.duration),
          render: f.renderStart ? ms(f.renderStart) : null,
          style: f.styleAndLayoutStart ? ms(f.styleAndLayoutStart) : null,
          scripts: f.scripts.map((s) => [
            ms(s.startTime),
            Math.round(s.duration),
            s.invokerType,
            s.invoker,
            s.sourceFunctionName,
            s.sourceURL.split('/').pop(),
            s.sourceCharPosition,
            Math.round(s.forcedStyleAndLayoutDuration),
          ]),
        })),
      })}`,
    );
  } finally {
    await app.close();
  }
});
