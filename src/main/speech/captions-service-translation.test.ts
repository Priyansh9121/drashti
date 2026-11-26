import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CaptionRevision,
  CaptionTranslation,
  CaptionTranslationPort,
} from '../../shared/caption-coordinator';
import {
  NO_CAPTION_TRANSLATION,
  TRANSLATED_LONGEST_MS,
  type CaptionTarget,
  type CaptionTranslationStatus,
} from '../../shared/caption-translation';
import {
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_CAPTION_TIMING,
  type CaptionSettings,
  type CaptionsShown,
} from '../../shared/captions';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import { CaptionsService, type CaptionsServiceDeps } from './captions-service';
import type { SpeechEngine } from './hub';

/*
 * "Captions in" inside the captions service (alpha.24, QA24-CAPLANG-2): a translation chosen sends what is heard
 * through the captions coordinator, whichever engine hears (today's general model, or a language's own model);
 * live translation begins for the pair when captions start (and only where it is offered, 2f), and ends when they
 * stop or the speaker's own words are chosen; a new pair starts a new session; while translating the longest phrase
 * is 8 s; the dialog reads how it stands. "Same as the speaker": today's captions exactly. Placeholder words only.
 */

function setup(o: { unavailable?: CaptionTranslationStatus['unavailable'] } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-captions-translation-'));
  let settings: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS, audience: true };
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const started: string[] = [];
  const shown: (CaptionsShown | null)[] = [];
  const accepted: CaptionRevision[] = [];
  const events: string[] = [];
  // As index.ts wires it: the coordinator may translate only while live translation runs for a pair.
  let begun = false;
  const port: CaptionTranslationPort = {
    identity: {
      modelIdentity: 'placeholder@1',
      routeId: 'live',
      processorId: 'p@1',
      glossaryRevision: 'none',
    },
    translate: (clause) =>
      Promise.resolve<CaptionTranslation>({
        ...clause,
        text: `[${clause.sourceLanguage}>${clause.targetLanguage}] placeholder`,
        status: 'ok',
        processingMs: 1,
      }),
  };
  const translation = {
    status: vi.fn(
      (speaker: SpeechLanguage | 'auto', target: CaptionTarget | undefined, tooSlow: boolean) => ({
        ...NO_CAPTION_TRANSLATION,
        target:
          target === undefined || target === 'same' || speaker === target ? null : (target as SpeechLanguage),
        offered: (o.unavailable ?? null) === null && !tooSlow,
        unavailable: o.unavailable ?? null,
      }),
    ),
    begin: vi.fn((from: SpeechLanguage, to: SpeechLanguage) => {
      begun = true;
      events.push(`begin ${from}>${to}`);
    }),
    end: vi.fn(() => {
      begun = false;
      events.push('end');
    }),
  };
  const coordinator = new CaptionCoordinator({
    clock: () => Date.now(),
    settings: () => settings,
    show: (c) => shown.push(c),
    changed: () => undefined,
    translation: port,
    output: 'translation',
    stage: true,
    pages: true,
    mayTranslate: () => begun,
  });
  const accept = coordinator.accept.bind(coordinator);
  coordinator.accept = (clause) => {
    accepted.push(clause);
    return accept(clause);
  };
  const engine: SpeechEngine = {
    start(language, to) {
      started.push(`today ${language}`);
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        out = null;
      };
    },
  };
  const deps: CaptionsServiceDeps = {
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
    engineProblem: () => null,
    modelReady: () => true,
    download: () => Promise.resolve(),
    show: (c) => shown.push(c),
    changed: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
    // No language has a model of its own here: today's general model hears.
    aiPath: {
      on: () => false,
      route: () => null,
      recognizer: () => null,
      coordinator,
    },
    translation,
  };
  const service = new CaptionsService(deps);
  const say = (text: string, final: boolean, id = 's1', language: SpeechLanguage = 'gu') => {
    const endAt = Date.now() - 500;
    const words = text.split(' ');
    out?.heard({
      id,
      final,
      language,
      languageConfidence: null,
      words: words.map((w, i) => ({
        text: w,
        startAt: endAt - 1_000 + i,
        endAt: endAt - 999 + i,
        confidence: 0.9,
      })),
      text,
      startAt: endAt - 1_000,
      endAt,
      heardAt: Date.now(),
    });
  };
  const choose = (s: Partial<CaptionSettings>) => service.setSettings({ ...settings, ...s });
  return {
    service,
    say,
    choose,
    started,
    shown,
    accepted,
    events,
    translation,
    last: () => shown.at(-1) ?? null,
  };
}

describe('"Captions in" in the captions service (alpha.24, QA24-CAPLANG-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('translates what today’s engine hears through the coordinator: the stage keeps the words, the others get the translation', async () => {
    const t = setup();
    t.choose({ language: 'gu', captionLanguage: 'hi' });
    await t.service.setOn(true);
    expect(t.started).toEqual(['today gu']);
    expect(t.events).toEqual(['begin gu>hi']);
    t.say('લીલું ખોખું', false);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.accepted.at(-1)).toMatchObject({
      sourceLanguage: 'gu',
      targetLanguage: 'hi',
      status: 'provisional',
    });
    expect(t.last()).toMatchObject({ kind: 'translation', lines: [], stage: { lines: ['લીલું ખોખું'] } });
    t.say('લીલું ખોખું આજે', true);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({
      kind: 'translation',
      language: 'hi',
      lines: ['[gu>hi] placeholder'],
      stage: { lines: ['લીલું ખોખું આજે'], language: 'gu' },
    });
    expect(t.service.view().translation).toMatchObject({ target: 'hi', offered: true, unavailable: null });
    expect(t.translation.status).toHaveBeenLastCalledWith('gu', 'hi', false);
    await t.service.setOn(false);
    expect(t.events).toEqual(['begin gu>hi', 'end']);
    t.service.close();
  });

  it('starts a new session with the new pair when Captions in changes, and ends for the speaker’s own words', async () => {
    const t = setup();
    t.choose({ language: 'gu', captionLanguage: 'hi' });
    await t.service.setOn(true);
    t.say('પહેલું', true);
    t.choose({ captionLanguage: 'en' });
    // The engine listens on (its next phrase s2); the coordinator's session is new, for the new pair.
    t.say('બીજું', true, 's2');
    expect(t.accepted.at(-1)).toMatchObject({ phraseId: 's2', targetLanguage: 'en' });
    expect(t.events).toEqual(['begin gu>hi', 'end', 'begin gu>en']);
    // The speaker's own words: today's captions (no translation running, nothing for the coordinator to translate).
    t.choose({ captionLanguage: 'same' });
    expect(t.events.at(-1)).toBe('end');
    t.say('ત્રીજું', true, 's3');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()?.lines).toEqual(['ત્રીજું']);
    expect(t.last()?.kind).toBeUndefined();
    t.service.close();
  });

  it('cuts phrases at 8 s while translating (the dialog keeps the admin’s own choice), and not otherwise', async () => {
    const t = setup();
    expect(t.service.liveTiming()).toEqual(DEFAULT_CAPTION_TIMING);
    t.choose({ language: 'hi', captionLanguage: 'en' });
    expect(t.service.liveTiming()).toEqual({ ...DEFAULT_CAPTION_TIMING, longestMs: TRANSLATED_LONGEST_MS });
    expect(t.service.timing()).toEqual(DEFAULT_CAPTION_TIMING);
    expect(t.service.view().timing).toEqual(DEFAULT_CAPTION_TIMING);
    t.choose({ captionLanguage: 'hi' });
    expect(t.service.liveTiming()).toEqual(DEFAULT_CAPTION_TIMING);
    t.service.close();
  });

  it('begins nothing where it is not offered (2f), and says why; the screens never fall back to the speaker’s words', async () => {
    const t = setup({ unavailable: 'no-pack' });
    t.choose({ language: 'gu', captionLanguage: 'hi' });
    await t.service.setOn(true);
    expect(t.events).toEqual([]);
    expect(t.service.view().translation).toMatchObject({
      target: 'hi',
      offered: false,
      unavailable: 'no-pack',
    });
    t.say('લીલું', true);
    await vi.advanceTimersByTimeAsync(300);
    // The audience screens and the stream show nothing; the stage keeps the speaker's words.
    expect(t.last()).toMatchObject({ lines: [], stage: { lines: ['લીલું'] } });
    t.service.close();
  });
});
