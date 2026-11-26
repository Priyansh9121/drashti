import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CaptionTranslation,
  CaptionTranslationPort,
  CaptionTranslationRequest,
} from '../../shared/caption-coordinator';
import { NO_CAPTION_TRANSLATION, type CaptionTarget } from '../../shared/caption-translation';
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings, type CaptionsShown } from '../../shared/captions';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { CaptionCleanService } from './caption-clean-service';
import { CaptionCoordinator } from './caption-coordinator';
import { CaptionsService } from './captions-service';
import type { SpeechEngine } from './hub';

/*
 * The alpha.24 captions join, end to end in Main as src/main/index.ts wires it: a Gujarati model of its own heard
 * through the captions service, its phrases with words left out (QA24-CAPCLEAN-1, the service's spell), caption AI's
 * flow and coordinator translating into Hindi ("Captions in", QA24-CAPLANG-2), and every caption cleaned again just
 * before the screens. The engine speaks as the early final (QA24-CAPFAST-1, QCF-1) does: once the speaker has been
 * quiet for 0.3 s a phrase comes whole but unsettled, at once, and the same words settle it when the pause ends; or the
 * speaker goes on and the phrase grows. Invented placeholder words only, never a real bad word.
 */

const PLACEHOLDERS = ['zqvorn', 'ढ़ुम्पक'];
const BAD = /zqvorn|ढ़ुम्पक|ढुम्पक|ઢુમ્પક/iu;

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'drashti-caption-join-'));
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-26T11:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(userData, { recursive: true, force: true });
});

function setup(reply: (sourceText: string) => string = () => 'प्लेसहोल्डर अनुवाद') {
  let settings: CaptionSettings = {
    ...DEFAULT_CAPTION_SETTINGS,
    audience: true,
    language: 'gu',
    captionLanguage: 'hi',
  };
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const clean = new CaptionCleanService({
    repo: { get: () => [], set: () => undefined },
    own: { gu: [], hi: [], sa: [], en: [] },
    testWords: PLACEHOLDERS,
    pickImport: () => Promise.resolve(null),
    pickExport: () => Promise.resolve(null),
    changed: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
  });
  const screens: (CaptionsShown | null)[] = [];
  // index.ts: const showCaptions = (shown) => engine.setCaptions(captionClean.shown(shown)).
  const showCaptions = (c: CaptionsShown | null) => {
    screens.push(clean.shown(c));
  };
  const asked: Readonly<CaptionTranslationRequest>[] = [];
  const port: CaptionTranslationPort = {
    identity: {
      modelIdentity: 'placeholder@1',
      routeId: 'live',
      processorId: 'p@1',
      glossaryRevision: 'none',
    },
    translate: (clause) => {
      asked.push(clause);
      return Promise.resolve<CaptionTranslation>({
        ...clause,
        text: reply(clause.sourceText),
        status: 'ok',
        processingMs: 1,
      });
    },
  };
  let begun = false;
  const coordinator = new CaptionCoordinator({
    clock: () => Date.now(),
    settings: () => settings,
    show: showCaptions,
    changed: () => undefined,
    translation: port,
    output: 'translation',
    stage: true,
    pages: true,
    mayTranslate: () => begun,
  });
  const own: SpeechEngine = {
    start(language, to) {
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        out = null;
      };
    },
  };
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
    engine: own,
    engineProblem: () => null,
    modelReady: () => true,
    download: () => Promise.resolve(),
    show: showCaptions,
    spell: (p) => clean.heard(p),
    cleanCorrection: (text, apply) => clean.correction(text, apply),
    changed: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
    aiPath: {
      on: () => settings.language === 'gu',
      route: () => 'conformer',
      recognizer: (language) =>
        language === 'gu' ? { route: 'conformer', modelId: 'gu-own-placeholder', engine: own } : null,
      coordinator,
    },
    translation: {
      status: (speaker: SpeechLanguage | 'auto', target: CaptionTarget | undefined, tooSlow: boolean) => ({
        ...NO_CAPTION_TRANSLATION,
        target: target === undefined || target === 'same' || speaker === target ? null : target,
        offered: !tooSlow,
        unavailable: null,
      }),
      begin: () => {
        begun = true;
      },
      end: () => {
        begun = false;
      },
      retry: () => undefined,
    },
  });
  /** One answer of the engine: the phrase `id` as heard now, whole (final) or not. */
  const say = (text: string, final: boolean, id: string) => {
    const endAt = Date.now() - 300;
    const words = text.split(' ');
    out?.heard({
      id,
      final,
      language: 'gu',
      languageConfidence: null,
      words: words.map((w, i) => ({
        text: w,
        startAt: endAt - 1_000 + i * 100,
        endAt: endAt - 950 + i * 100,
        confidence: 0.9,
      })),
      text,
      startAt: endAt - 1_000,
      endAt,
      heardAt: Date.now(),
    });
  };
  const last = () => screens.at(-1) ?? null;
  const everything = () =>
    JSON.stringify([
      screens,
      asked.map((a) => a.sourceText),
      coordinator.view().current,
      coordinator.view().previous,
    ]);
  return { service, coordinator, clean, say, screens, asked, last, everything };
}

describe('the alpha.24 captions join: the early final, words left out and translated captions together', () => {
  it('an early final shows on the stage at once without the words left out; only its settled words are translated', async () => {
    const t = setup((source) => `zqvorn अनुवाद ${String(source.split(' ').length)}`);
    t.service.start();
    await t.service.setOn(true);
    // 0.3 s of quiet: the whole phrase at once, unsettled. The stage band shows it, cleaned; nothing is translated yet.
    t.say('નમૂનો ઢુમ્પક બીજો', false, 's1');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last()).toMatchObject({ kind: 'translation', lines: [], stage: { lines: ['નમૂનો બીજો'] } });
    expect(t.asked).toHaveLength(0);
    // The pause ends with the speaker still quiet: the same words settle it, and only now it is translated.
    await vi.advanceTimersByTimeAsync(400);
    t.say('નમૂનો ઢુમ્પક બીજો', true, 's1');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.asked.map((a) => a.sourceText)).toEqual(['નમૂનો બીજો']);
    // The translator's own listed word never shows either.
    expect(t.last()).toMatchObject({ lines: ['अनुवाद 2'], stage: { lines: ['નમૂનો બીજો'] } });
    expect(t.coordinator.view().current).toMatchObject({ phraseId: 's1', status: 'settled', revision: 2 });
    expect(t.everything()).not.toMatch(BAD);
    t.service.close();
  });

  it('an early final the speaker talks on after grows as before, and is translated once, when it settles', async () => {
    const t = setup();
    t.service.start();
    await t.service.setOn(true);
    t.say('પહેલો', false, 's1');
    await vi.advanceTimersByTimeAsync(300);
    // More was said: the phrase goes on with later words, its early final never its final.
    t.say('પહેલો બીજો', false, 's1');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({ lines: [], stage: { lines: ['પહેલો બીજો'] } });
    t.say('પહેલો બીજો ત્રીજો', false, 's1');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.asked).toHaveLength(0);
    t.say('પહેલો બીજો ત્રીજો', true, 's1');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.asked.map((a) => a.sourceText)).toEqual(['પહેલો બીજો ત્રીજો']);
    expect(t.last()).toMatchObject({
      lines: ['प्लेसहोल्डर अनुवाद'],
      stage: { lines: ['પહેલો બીજો ત્રીજો'] },
    });
    t.service.close();
  });

  it('an early final left out whole comes off the stage; the translation of the phrase before stays (J3)', async () => {
    const t = setup();
    t.service.start();
    await t.service.setOn(true);
    t.say('પહેલો', false, 's1');
    await vi.advanceTimersByTimeAsync(300);
    t.say('પહેલો', true, 's1');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: { lines: ['પહેલો'] } });
    // The next phrase: a clean early decode, then (the speaker went on and paused again) one with only a listed word.
    t.say('નમૂનો', false, 's2');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: { lines: ['નમૂનો'] } });
    t.say('ઢુમ્પક', false, 's2');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: null });
    // Its settle, still nothing but the listed word: nothing more changes, and nothing is translated for it.
    t.say('ઢુમ્પક', true, 's2');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: null });
    expect(t.asked.map((a) => a.sourceText)).toEqual(['પહેલો']);
    expect(t.coordinator.view()).toMatchObject({ current: null, previous: { phraseId: 's1' }, omitted: 0 });
    // The next phrase comes as ever, beside the translation before until its own settles.
    t.say('ત્રીજો', false, 's3');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: { lines: ['ત્રીજો'] } });
    t.say('ત્રીજો', true, 's3');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.asked.map((a) => a.sourceText)).toEqual(['પહેલો', 'ત્રીજો']);
    expect(t.everything()).not.toMatch(BAD);
    t.service.close();
  });

  it('an operator’s correction with a listed word never reaches the translator, the review or the stage band beside the translation (J1, S1)', async () => {
    const t = setup();
    t.service.start();
    await t.service.setOn(true);
    t.say('પહેલો બીજો', false, 's1');
    await vi.advanceTimersByTimeAsync(300);
    t.say('પહેલો બીજો', true, 's1');
    await vi.advanceTimersByTimeAsync(300);
    const current = t.coordinator.view().current;
    expect(current).toMatchObject({ phraseId: 's1', status: 'settled' });
    // Through the operator's own way in: Apply correction's IPC calls the captions service (caption-prototype-ipc.ts).
    expect(
      t.service.correctPrototype({
        sessionId: current?.sessionId ?? '',
        phraseId: 's1',
        revision: current?.revision ?? 0,
        text: 'પહેલો zqvorn ત્રીજો',
      }),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: { lines: ['પહેલો ત્રીજો'] } });
    expect(JSON.stringify(t.screens)).not.toMatch(BAD);
    // The translator is asked the corrected words without the listed one (review S1), so its rendering of that word
    // (a form not on the list) can never reach the hall or the stream; the operator's review holds them so too.
    expect(t.asked.map((a) => a.sourceText)).toEqual(['પહેલો બીજો', 'પહેલો ત્રીજો']);
    const corrected = t.coordinator.view().current;
    expect(corrected).toMatchObject({ phraseId: 's1', status: 'corrected', sourceText: 'પહેલો ત્રીજો' });
    expect(t.clean.view().leftOut).toBe(1);
    // A correction of nothing but listed words is refused, as an empty one is: nothing is asked, shown or counted.
    expect(
      t.service.correctPrototype({
        sessionId: corrected?.sessionId ?? '',
        phraseId: 's1',
        revision: corrected?.revision ?? 0,
        text: 'zqvorn ઢુમ્પક',
      }),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.asked.map((a) => a.sourceText)).toEqual(['પહેલો બીજો', 'પહેલો ત્રીજો']);
    expect(t.coordinator.view().current).toMatchObject({
      revision: corrected?.revision,
      status: 'corrected',
      sourceText: 'પહેલો ત્રીજો',
    });
    expect(t.last()).toMatchObject({ lines: ['प्लेसहोल्डर अनुवाद'], stage: { lines: ['પહેલો ત્રીજો'] } });
    expect(t.clean.view().leftOut).toBe(1);
    expect(t.everything()).not.toMatch(BAD);
    t.service.close();
  });
});
