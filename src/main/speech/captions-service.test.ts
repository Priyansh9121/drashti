import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings, type CaptionsShown } from '../../shared/captions';
import type { Heard, SpeechState } from '../../shared/speech';
import { CaptionsService, type CaptionsStatus } from './captions-service';
import { readCaptionsSwitch } from './captions-switch';
import type { SpeechEngine } from './hub';

/* Live captions as an admin turns them on (Part 10): a stand-in engine and download; placeholder words only. */

function setup(o: { engine?: boolean; failDownload?: boolean } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-captions-service-'));
  let settings: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS };
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const started: string[] = [];
  const engine: SpeechEngine = {
    start(language, to) {
      started.push(language);
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        out = null;
      };
    },
  };
  let ready = false;
  const downloads: string[] = [];
  const shown: (CaptionsShown | null)[] = [];
  const views: CaptionsStatus[] = [];
  const service = new CaptionsService({
    userData,
    platform: 'win32',
    arch: 'x64',
    repo: {
      get: () => settings,
      set: (s) => {
        settings = s;
      },
    },
    engine,
    engineFound: () => o.engine ?? true,
    modelReady: () => ready,
    download: async (id, progress) => {
      downloads.push(id);
      progress(100, 200);
      await Promise.resolve();
      if (o.failDownload)
        throw new Error('No internet: the captions model downloads once, when this computer is online.');
      progress(200, 200);
      ready = true;
    },
    show: (c) => shown.push(c),
    changed: (v) => views.push(v),
    log: { info: () => undefined, warn: () => undefined },
  });
  const say = (text: string, id = 's1') => {
    const endAt = Date.now() - 1_000;
    const words = text.split(' ');
    const startAt = endAt - words.length * 400 + 100;
    out?.heard({
      id,
      final: true,
      language: 'en',
      languageConfidence: 0.9,
      words: words.map((w, i) => ({
        text: w,
        startAt: startAt + i * 400,
        endAt: startAt + i * 400 + 300,
        confidence: 0.9,
      })),
      text,
      startAt,
      endAt,
      heardAt: Date.now(),
    });
  };
  return { service, userData, started, downloads, shown, views, say, getSettings: () => settings };
}

describe('live captions as an admin turns them on (Part 10)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 4, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('are off at first: nothing listens, nothing is downloaded, and they are marked Trial', () => {
    const { service, started, downloads } = setup();
    service.start();
    const view = service.view();
    expect(view).toMatchObject({
      on: false,
      model: 'small',
      engine: true,
      trial: true,
      speech: { phase: 'off' },
    });
    expect(view.download.phase).toBe('missing');
    expect(started).toEqual([]);
    expect(downloads).toEqual([]);
  });

  it('turned on, download the model once with progress, then listen and show what is heard', async () => {
    const { service, userData, started, downloads, shown, views, say } = setup();
    service.start();
    await service.setOn(true);
    expect(readCaptionsSwitch(userData, 'win32', 'x64').on).toBe(true);
    expect(downloads).toEqual(['small']);
    expect(views.some((v) => v.download.phase === 'downloading')).toBe(true);
    expect(service.view().download.phase).toBe('ready');
    expect(started).toEqual(['auto']);
    say('alpha beta');
    expect(shown.at(-1)?.lines).toEqual(['alpha beta']);
    await service.setOn(false);
    expect(shown.at(-1)).toBeNull();
    expect(service.view().speech).toEqual({ phase: 'off' });
    // On again: the model is here, so nothing is downloaded again.
    await service.setOn(true);
    expect(downloads).toEqual(['small']);
  });

  it('say plainly when the model could not be downloaded, and stay held until it is', async () => {
    const { service, started } = setup({ failDownload: true });
    service.start();
    await service.setOn(true);
    const view = service.view();
    expect(view.download).toMatchObject({ phase: 'failed' });
    expect(view.download.message).toMatch(/No internet/);
    expect(started).toEqual([]);
    expect(view.speech).toEqual({ phase: 'held', reason: 'no-model' });
  });

  it('keep the settings in the library; a language starts the engine again in it', async () => {
    const { service, started, getSettings } = setup();
    service.start();
    await service.setOn(true);
    service.setSettings({ ...DEFAULT_CAPTION_SETTINGS, language: 'hi', audience: true });
    expect(getSettings()).toMatchObject({ language: 'hi', audience: true });
    expect(started).toEqual(['auto', 'hi']);
  });

  it('do nothing where this copy of Drashti has no captions engine, and say so', async () => {
    const { service, started, downloads } = setup({ engine: false });
    service.start();
    await service.setOn(true);
    expect(service.view().engine).toBe(false);
    expect(started).toEqual([]);
    expect(downloads).toEqual([]);
  });
});
