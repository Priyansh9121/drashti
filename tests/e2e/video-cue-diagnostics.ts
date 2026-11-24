import type { Page, TestInfo } from '@playwright/test';

/** Native evidence only: no player state, observer limit or acceptance bound is changed. */
export async function beginCueDiagnostics(pages: Page[], options: { lag?: boolean } = {}): Promise<void> {
  for (const page of pages)
    await page.evaluate((watchLag) => {
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
          const frame = new NativeFrame(...args);
          // Which frame a cued picture's read got (a22-cue: LIVE's cue never matched its presented frame).
          const source = args[0];
          if (source instanceof HTMLVideoElement && source.dataset['cueId'] && events.length < 6000)
            events.push({ t: Date.now(), event: 'videoframe', timestamp: frame.timestamp, ...media(source) });
          return frame;
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
      // Each frame Chromium presents to a held cued picture's frame callbacks (render/cue-presentation.ts waits for its
      // trimmed frame there): when, which frame, how many presented.
      const nativeCallback = Object.getOwnPropertyDescriptor(
        HTMLVideoElement.prototype,
        'requestVideoFrameCallback',
      );
      if (!nativeCallback) throw new Error('No native video frame callback');
      const askFrame = nativeCallback.value as HTMLVideoElement['requestVideoFrameCallback'];
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback: VideoFrameRequestCallback) {
        const observed: VideoFrameRequestCallback = (now, frame) => {
          // While it is held only: its frames after Go are the spec's own record.
          if (this.dataset['cueId'] && this.paused && events.length < 6000)
            events.push({
              t: Date.now(),
              event: 'presented',
              mediaTime: frame.mediaTime,
              presentedFrames: frame.presentedFrames,
              ...media(this),
            });
          callback(now, frame);
        };
        return askFrame.call(this, observed);
      };
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
      // How late this page's own event loop runs (a22-cue: the Mac's held cue got its Go late): each 20 ms tick more
      // than 35 ms after the last, and each change of the page's visibility.
      let tickAt = Date.now();
      const lag = watchLag
        ? setInterval(() => {
            const now = Date.now();
            if (now - tickAt > 35 && events.length < 6000)
              events.push({ t: now, event: 'lag', ms: now - tickAt });
            tickAt = now;
          }, 20)
        : undefined;
      document.addEventListener('visibilitychange', () =>
        events.push({ t: Date.now(), event: 'visibility', state: document.visibilityState }),
      );
      events.push({ t: Date.now(), event: 'visibility', state: document.visibilityState });
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
          Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', nativeCallback);
          if (reports === 'drashti') g.drashti = bridge;
          for (const name of names) document.removeEventListener(name, record, true);
          observer.disconnect();
          if (lag !== undefined) clearInterval(lag);
          return { events, samples };
        },
      };
    }, options.lag === true);
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
