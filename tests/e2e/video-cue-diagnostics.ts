import type { Page, TestInfo } from '@playwright/test';

/** Native evidence only: no player state, observer limit or acceptance bound is changed. */
export async function beginCueDiagnostics(pages: Page[]): Promise<void> {
  for (const page of pages)
    await page.evaluate(() => {
      const events: unknown[] = [],
        samples: unknown[] = [],
        contexts = new Set<AudioContext>();
      const createGain = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'createGain');
      if (!createGain) throw new Error('No native gain factory');
      BaseAudioContext.prototype.createGain = function () {
        contexts.add(this as AudioContext);
        return (createGain.value as (this: BaseAudioContext) => GainNode).call(this);
      };
      const media = (v: HTMLMediaElement) => ({
        key: v.dataset['key'] ?? v.dataset['bgSlot'],
        tag: v.tagName,
        error: v.error ? { code: v.error.code, message: v.error.message } : null,
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
        'error',
        'abort',
        'emptied',
      ];
      for (const name of names) document.addEventListener(name, record, true);
      // Which page said a cue ready or not (a21-s5b): each first-frame report this page sends, as it sends it.
      const g = globalThis as {
        drashti?: { engine?: { videoCueReady?: (...a: [string, string, boolean]) => Promise<unknown> } };
      };
      const bridge = g.drashti;
      const send = bridge?.engine?.videoCueReady;
      let reports: 'drashti' | 'none' = 'none';
      if (bridge?.engine && send) {
        const observed = {
          ...bridge,
          engine: {
            ...bridge.engine,
            videoCueReady: (cueId: string, kind: string, ready: boolean) => {
              events.push({ t: Date.now(), event: 'cue-report', cueId, kind, ready });
              return send(cueId, kind, ready);
            },
          },
        };
        try {
          g.drashti = observed;
          if (g.drashti === observed) reports = 'drashti';
        } catch {
          // A bridge that cannot be replaced: recorded below as not observed.
        }
      }
      events.push({ t: Date.now(), event: 'cue-report-observer', observing: reports });
      // A cued picture's frame read that throws (render/cue-presentation.ts reports the cue not ready then).
      const NativeFrame = globalThis.VideoFrame;
      const ObservedFrame = function (this: unknown, ...args: ConstructorParameters<typeof VideoFrame>) {
        try {
          return new NativeFrame(...args);
        } catch (error) {
          const source = args[0];
          events.push({
            t: Date.now(),
            event: 'videoframe-error',
            message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            ...(source instanceof HTMLMediaElement ? media(source) : {}),
          });
          throw error;
        }
      } as unknown as typeof VideoFrame;
      ObservedFrame.prototype = NativeFrame.prototype;
      globalThis.VideoFrame = ObservedFrame;
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
          Object.defineProperty(BaseAudioContext.prototype, 'createGain', createGain);
          globalThis.VideoFrame = NativeFrame;
          if (reports === 'drashti') g.drashti = bridge;
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
