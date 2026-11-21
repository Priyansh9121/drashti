import type { Page, TestInfo } from '@playwright/test';

/** Native evidence only: no player state, observer limit or acceptance bound is changed. */
export async function beginCueDiagnostics(pages: Page[]): Promise<void> {
  for (const page of pages)
    await page.evaluate(() => {
      const events: unknown[] = [],
        samples: unknown[] = [],
        contexts = new Set<AudioContext>();
      const createGain = BaseAudioContext.prototype.createGain;
      BaseAudioContext.prototype.createGain = function () {
        contexts.add(this as AudioContext);
        return createGain.call(this);
      };
      const media = (v: HTMLMediaElement) => ({
        key: v.dataset['key'] ?? v.dataset['bgSlot'],
        media: v.dataset['mediaId'],
        at: v.currentTime,
        rate: v.playbackRate,
        paused: v.paused,
        seeking: v.seeking,
        ready: v.readyState,
        opacity: v.style.opacity,
        wrapOpacity: v.closest<HTMLElement>('[data-bg-wrap]')?.style.opacity,
        buffered: Array.from({ length: v.buffered.length }, (_, i) => [
          v.buffered.start(i),
          v.buffered.end(i),
        ]),
      });
      const record = (event: Event) => {
        if (event.target instanceof HTMLMediaElement)
          events.push({ t: Date.now(), event: event.type, ...media(event.target) });
      };
      const names = [
        'loadedmetadata',
        'loadeddata',
        'play',
        'playing',
        'pause',
        'seeking',
        'seeked',
        'waiting',
        'stalled',
        'ratechange',
        'canplay',
      ];
      for (const name of names) document.addEventListener(name, record, true);
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          events.push({
            t: Date.now(),
            event: entry.entryType,
            began: entry.startTime,
            duration: entry.duration,
          });
      });
      observer.observe({ type: 'longtask', buffered: true });
      const sample = () => {
        if (samples.length >= 6000) return;
        samples.push({
          t: Date.now(),
          fade: document.querySelector<HTMLElement>('[data-video-crossfade]')?.dataset['videoCrossfade'],
          media: [
            ...document.querySelectorAll<HTMLMediaElement>('audio[data-media-id], video[data-media-id]'),
          ].map(media),
          contexts: [...contexts].map((c) => ({
            at: c.currentTime,
            state: c.state,
            output: c.getOutputTimestamp(),
          })),
        });
      };
      (globalThis as { s5Diagnostics?: { sample: () => void; stop: () => unknown } }).s5Diagnostics = {
        sample,
        stop: () => {
          BaseAudioContext.prototype.createGain = createGain;
          for (const name of names) document.removeEventListener(name, record, true);
          observer.disconnect();
          return { events, samples };
        },
      };
    });
}

export async function retainCueDiagnostics(pages: Page[], info: TestInfo): Promise<void> {
  for (const [index, page] of pages.entries()) {
    const evidence = await page
      .evaluate(() => {
        const g = globalThis as { s5Diagnostics?: { stop: () => unknown } };
        const result = g.s5Diagnostics?.stop();
        delete g.s5Diagnostics;
        return result;
      })
      .catch(() => null);
    if (evidence)
      await info.attach(`s5-decoder-${String(index)}.json`, {
        body: Buffer.from(JSON.stringify(evidence)),
        contentType: 'application/json',
      });
  }
}
