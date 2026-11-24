import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_CAPTION_TIMING,
  type CaptionModelId,
  type CaptionSettings,
  type CaptionsShown,
} from '../../shared/captions';
import type { Heard, SpeechState } from '../../shared/speech';
import { CaptionsService, type CaptionsStatus } from './captions-service';
import { readCaptionsSwitch, readCaptionsTuning } from './captions-switch';
import type { SpeechEngine } from './hub';
import type { LanguageModelEntry } from './language-models';

/** The value, or the test stops here with a plain reason (no non-null assertion). */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value here');
  return value;
}

/* Live captions as an admin turns them on (Part 10): a stand-in engine and download; placeholder words only. */

/** A stand-in for the language models on this computer: one placeholder Gujarati model Drashti knows. */
function languageStore() {
  const entry: LanguageModelEntry = {
    id: 'placeholder-gu',
    language: 'gu',
    name: 'Placeholder Gujarati',
    bytes: 4_096,
    sha256: 'a'.repeat(64),
    licence: 'MIT',
    fallback: true,
    timestamps: false,
  };
  let phase: 'ready' | 'missing' | 'changed' = 'missing';
  let onDisk: 'ready' | 'missing' | 'changed' = 'missing';
  return {
    entry,
    set: (now: 'ready' | 'missing' | 'changed', whole = now) => {
      phase = now;
      onDisk = whole;
    },
    store: {
      known: () => [entry],
      file: (e: LanguageModelEntry) => `/placeholder/${e.id}.bin`,
      check: () => phase,
      verify: () => {
        phase = onDisk;
        return Promise.resolve(onDisk);
      },
    },
  };
}

function setup(
  o: {
    engine?: boolean;
    failDownload?: boolean;
    controlDownload?: boolean;
    languageModels?: ReturnType<typeof languageStore>['store'];
    processors?: number;
  } = {},
) {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-captions-service-'));
  let settings: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS };
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const started: string[] = [];
  let stopped = 0;
  const engine: SpeechEngine = {
    start(language, to) {
      started.push(language);
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        stopped += 1;
        out = null;
      };
    },
  };
  const ready = new Set<CaptionModelId>();
  const pending: { signal: AbortSignal; finish: () => void }[] = [];
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
    ...(o.processors === undefined ? {} : { processors: () => o.processors ?? 0 }),
    engineProblem: () => ((o.engine ?? true) ? null : 'This copy of Drashti has no captions engine.'),
    modelReady: (id) => ready.has(id),
    download: async (id, progress, signal) => {
      downloads.push(id);
      progress(100, 200);
      if (o.controlDownload) await new Promise<void>((finish) => pending.push({ signal, finish }));
      await Promise.resolve();
      if (o.failDownload)
        throw new Error('No internet: the captions model downloads once, when this computer is online.');
      progress(200, 200);
      if (!signal.aborted) ready.add(id);
    },
    show: (c) => shown.push(c),
    changed: (v) => views.push(v),
    log: { info: () => undefined, warn: () => undefined },
    ...(o.languageModels ? { languageModels: o.languageModels } : {}),
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
  return {
    service,
    userData,
    started,
    downloads,
    pending,
    shown,
    views,
    say,
    getSettings: () => settings,
    /** What the engine says it is doing (cap-threads: its rests). */
    state: (s: SpeechState) => out?.state(s),
    stops: () => stopped,
  };
}

describe('live captions as an admin turns them on (Part 10)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 4, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('say how many logical processors this computer has (cap-threads), as Node counts them unless told', () => {
    expect(setup({ processors: 2 }).service.view().processors).toBe(2);
    const counted = setup().service.view().processors;
    expect(Number.isInteger(counted) && counted >= 1).toBe(true);
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

  it('stops the download when captions turn off and ignores its late progress and completion', async () => {
    const { service, pending, started } = setup({ controlDownload: true });
    const turningOn = service.setOn(true);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await service.setOn(false);
    expect(pending[0]?.signal.aborted).toBe(true);
    pending[0]?.finish();
    await turningOn;
    expect(service.view()).toMatchObject({
      on: false,
      download: { phase: 'missing' },
      speech: { phase: 'off' },
    });
    expect(started).toEqual([]);
  });

  it('only marks the selected model ready when its own download completes', async () => {
    const { service, pending, downloads, started, views } = setup({ controlDownload: true });
    const turningOn = service.setOn(true);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const switching = service.setModel('turbo');
    expect(pending[0]?.signal.aborted).toBe(true);
    pending[0]?.finish();
    await turningOn;
    await vi.waitFor(() => expect(downloads).toEqual(['small', 'turbo']));
    expect(views.some((v) => v.model === 'turbo' && v.download.phase === 'ready')).toBe(false);
    expect(started).toEqual([]);
    pending[1]?.finish();
    await switching;
    expect(service.view()).toMatchObject({ model: 'turbo', download: { phase: 'ready' } });
    expect(started).toEqual(['auto']);
  });

  it('waits while the stream is in use and resumes a stopped download afterwards', async () => {
    const { service, pending, downloads, started } = setup({ controlDownload: true });
    service.setStreamInUse(true);
    await service.setOn(true);
    await service.retry();
    expect(downloads).toEqual([]);
    expect(service.view().download.message).toMatch(/waits until/);
    service.setStreamInUse(false);
    await vi.waitFor(() => expect(downloads).toEqual(['small']));
    service.setStreamInUse(true);
    expect(pending[0]?.signal.aborted).toBe(true);
    pending[0]?.finish();
    await service.retry();
    expect(downloads).toEqual(['small']);
    service.setStreamInUse(false);
    await vi.waitFor(() => expect(downloads).toEqual(['small', 'small']));
    pending[1]?.finish();
    await vi.waitFor(() => expect(started).toEqual(['auto']));
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

describe('a model per language and live timing (alpha.22)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 23, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start as captions always were: the general model for every language, and the timing they always had', async () => {
    const { service, started } = setup();
    service.start();
    await service.setOn(true);
    const view = service.view();
    expect(view.languageModels.map((m) => [m.language, m.phase, m.chosen, m.known.length])).toEqual([
      ['gu', 'general', null, 0],
      ['hi', 'general', null, 0],
      ['en', 'general', null, 0],
    ]);
    expect(view.timing).toEqual(DEFAULT_CAPTION_TIMING);
    expect(service.timing()).toEqual(DEFAULT_CAPTION_TIMING);
    expect(started).toEqual(['auto']);
    expect(service.languageModelFor('gu')).toBeNull();
  });

  it('a chosen model of its own hears its language once it is here and checked; the general model hears the others', async () => {
    const lm = languageStore();
    const { service, started, userData } = setup({ languageModels: lm.store });
    service.start();
    await service.setOn(true);
    lm.set('ready');
    service.setLanguageModel('gu', 'placeholder-gu');
    expect(readCaptionsTuning(userData).languageModels).toEqual({ gu: 'placeholder-gu' });
    service.setSettings({ ...DEFAULT_CAPTION_SETTINGS, language: 'gu' });
    expect(started).toEqual(['auto', 'gu']);
    expect(service.languageModelFor('gu')).toEqual(lm.entry);
    expect(service.languageModelFor('hi')).toBeNull();
    expect(service.languageModelFor('auto')).toBeNull();
    expect(service.languageModelFor('sa')).toBeNull();
    expect(service.view().languageModels[0]).toMatchObject({
      language: 'gu',
      chosen: 'placeholder-gu',
      phase: 'ready',
      known: [{ id: 'placeholder-gu', name: 'Placeholder Gujarati', bytes: 4_096, here: true }],
    });
    // Back to the general model for Gujarati: chosen on this computer, listening starts again with it.
    service.setLanguageModel('gu', null);
    expect(service.languageModelFor('gu')).toBeNull();
    expect(started).toEqual(['auto', 'gu', 'gu']);
    // An id this copy does not know for the language is not taken.
    service.setLanguageModel('hi', 'placeholder-gu');
    expect(service.view().languageModels[1]).toMatchObject({ chosen: null, phase: 'general' });
  });

  it('never hears with a file changed since it was checked, nor with the general model instead: it says so', async () => {
    const lm = languageStore();
    const { service, started } = setup({ languageModels: lm.store });
    service.start();
    await service.setOn(true);
    lm.set('ready');
    service.setLanguageModel('gu', 'placeholder-gu');
    lm.set('changed', 'changed');
    service.setSettings({ ...DEFAULT_CAPTION_SETTINGS, language: 'gu' });
    expect(started).toEqual(['auto']);
    const message =
      'The Gujarati model’s file has changed since Drashti checked it, so captions do not use it. Check it again, or import the model pack again (Help › Caption and Translation Models…).';
    expect(service.view().speech).toEqual({ phase: 'failed', message });
    expect(service.view().languageModels[0]).toMatchObject({ phase: 'changed', message });
    expect(service.languageModelFor('gu')).toBeNull();
    // The engine asks again before each start (a restart after a rest too).
    expect(service.modelProblem('gu')).toBe(message);
    expect(service.modelProblem('hi')).toBeNull();
    // Checked again whole and still changed: still not used.
    await service.checkLanguageModel('gu');
    expect(started).toEqual(['auto']);
    // Only touched: checked whole, it is used again.
    lm.set('changed', 'ready');
    await service.checkLanguageModel('gu');
    expect(service.view().languageModels[0]).toMatchObject({ phase: 'ready', message: null });
    expect(started).toEqual(['auto', 'gu']);
  });

  it('says so when the chosen model is not on this computer', async () => {
    const lm = languageStore();
    const { service, started } = setup({ languageModels: lm.store });
    service.start();
    await service.setOn(true);
    service.setLanguageModel('gu', 'placeholder-gu');
    service.setSettings({ ...DEFAULT_CAPTION_SETTINGS, language: 'gu' });
    const message =
      'The Gujarati model is not on this computer: import the model pack that holds it (Help › Caption and Translation Models…).';
    expect(service.view().speech).toEqual({ phase: 'failed', message });
    expect(service.view().languageModels[0]).toMatchObject({ phase: 'missing', message });
    expect(started).toEqual(['auto']);
  });

  it('keeps the live timing on this computer and starts listening again with it', async () => {
    const { service, started, userData } = setup();
    service.start();
    await service.setOn(true);
    const quicker = { ...DEFAULT_CAPTION_TIMING, stepMs: 1_000, longestMs: 8_000, threads: 2 } as const;
    expect(service.setTiming(quicker).timing).toEqual(quicker);
    expect(readCaptionsTuning(userData).timing).toEqual(quicker);
    expect(service.timing()).toEqual(quicker);
    expect(started).toEqual(['auto', 'auto']);
    // Off, a change is kept and nothing starts.
    await service.setOn(false);
    service.setTiming(DEFAULT_CAPTION_TIMING);
    expect(started).toEqual(['auto', 'auto']);
  });
});

describe('phase D prototype alongside the existing captions service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 23, 9));
  });
  afterEach(() => vi.useRealTimers());
  it('uses no real engine or model download and clears its words before the normal path resumes', async () => {
    const { service, started, downloads, shown } = setup();
    service.start();
    expect(service.prototypeView().on).toBe(false);
    service.setPrototypeOn(true);
    service.advancePrototype();
    service.advancePrototype();
    vi.advanceTimersByTime(300);
    expect(shown.at(-1)?.lines).toEqual(['The green box is beside a round shape.']);
    expect(started).toEqual([]);
    expect(downloads).toEqual([]);
    expect(JSON.stringify(service.view())).not.toContain('green box');
    expect(service.view().on).toBe(false);
    service.setPrototypeOn(false);
    expect(service.prototypeView()).toMatchObject({ on: false, current: null, previous: null });
    expect(shown.at(-1)).toBeNull();
    await service.setOn(true);
    expect(downloads).toEqual(['small']);
    expect(started).toEqual(['auto']);
    service.close();
  });
  it('stops Whisper while the prototype is selected; settings/language changes clear edits, and off is immediate', async () => {
    const { service, started, shown, say } = setup();
    await service.setOn(true);
    service.setPrototypeOn(true);
    say('Normal path must be stopped');
    service.advancePrototype();
    service.advancePrototype();
    const old = must(service.prototypeView().current);
    service.setSettings({ ...DEFAULT_CAPTION_SETTINGS, language: 'hi' });
    expect(service.prototypeView().current).toBeNull();
    expect(service.correctPrototype({ ...old, text: 'Stale correction' })).toBe(false);
    await service.setOn(false);
    expect(service.prototypeView().on).toBe(false);
    expect(shown.at(-1)).toBeNull();
    expect(started).toEqual(['auto']);
    service.close();
  });
});

it('cancels the rehearsal at an access stop without restarting Whisper or downloads', async () => {
  vi.useFakeTimers();
  try {
    const { service, started, downloads, shown } = setup();
    await service.setOn(true);
    service.setPrototypeOn(true);
    service.advancePrototype();
    service.advancePrototype();
    service.cancelPrototype();
    expect(service.prototypeView().on).toBe(false);
    expect(service.prototypeView().current).toBeNull();
    vi.advanceTimersByTime(300);
    expect(shown.at(-1)).toBeNull();
    expect(started).toEqual(['auto']);
    expect(downloads).toEqual(['small']);
    service.close();
  } finally {
    vi.useRealTimers();
  }
});

it('starts a fresh prototype session when the selected normal model changes, without loading it', async () => {
  vi.useFakeTimers();
  try {
    const { service, started, downloads } = setup();
    await service.setOn(true);
    service.setPrototypeOn(true);
    service.advancePrototype();
    service.advancePrototype();
    const old = service.prototypeView().sessionId;
    await service.setModel('turbo');
    expect(service.prototypeView().sessionId).not.toBe(old);
    expect(service.prototypeView().current).toBeNull();
    expect(started).toEqual(['auto']);
    expect(downloads).toEqual(['small']);
    service.close();
  } finally {
    vi.useRealTimers();
  }
});

describe('a computer too slow for live captions (cap-threads, the owner: “Say so and stop”)', () => {
  const rest = (rests: number, stops = false): SpeechState => ({
    phase: 'held',
    reason: 'busy',
    slow: { answerMs: 15_500, behindMs: 16_000, threads: 2, processors: 2, rests, keptUp: false, stops },
  });

  it('after 3 rests in a row captions stop: off on this computer with the reason, the engine stopped; on again tries again', async () => {
    const { service, started, userData, views, state, stops } = setup();
    service.start();
    await service.setOn(true);
    expect(started).toEqual(['auto']);
    state(rest(1));
    state(rest(2));
    await new Promise((wait) => setTimeout(wait, 20));
    expect(service.view()).toMatchObject({ on: true, stopped: null });
    state(rest(3, true));
    await vi.waitFor(() => {
      expect(service.view().on).toBe(false);
    });
    expect(readCaptionsSwitch(userData, 'win32', 'x64').on).toBe(false);
    expect(service.view()).toMatchObject({
      speech: { phase: 'off' },
      stopped: { language: 'auto', slow: { rests: 3, answerMs: 15_500, threads: 2, processors: 2 } },
    });
    // The engine was stopped (Route W gives its pack's file back on that stop), and the dialog was told.
    expect(stops()).toBe(1);
    expect(views.at(-1)).toMatchObject({ on: false, stopped: { slow: { rests: 3 } } });
    // On again: it tries again, and the reason has gone.
    await service.setOn(true);
    expect(started).toEqual(['auto', 'auto']);
    expect(service.view()).toMatchObject({ on: true, stopped: null });
  });

  it('a lighter model chosen after the stop clears the reason; the switch stays Off (cap-review-threads n2)', async () => {
    const { service, state } = setup();
    service.start();
    await service.setOn(true);
    state(rest(3, true));
    await vi.waitFor(() => {
      expect(service.view().stopped).not.toBeNull();
    });
    await service.setModel('turbo');
    expect(service.view()).toMatchObject({ on: false, stopped: null });
  });

  it('only the engine’s decision stops them: never a count of rests (it has kept up), and never a rest it measured nothing for', async () => {
    const { service, state, stops } = setup();
    service.start();
    await service.setOn(true);
    state(rest(1));
    state(rest(2));
    // A third and a fourth rest the engine does not stop for (it heard a phrase whole earlier: busy for a while).
    state(rest(3));
    state(rest(4));
    state({ phase: 'listening', language: 'auto' });
    state(rest(1));
    state({ phase: 'held', reason: 'busy' });
    await new Promise((wait) => setTimeout(wait, 20));
    expect(service.view()).toMatchObject({ on: true, stopped: null });
    expect(stops()).toBe(0);
  });
});
