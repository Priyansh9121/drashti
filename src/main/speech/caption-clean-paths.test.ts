import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionTranslation, CaptionTranslationRequest } from '../../shared/caption-coordinator';
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings, type CaptionsShown } from '../../shared/captions';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import { CaptionCleanService } from './caption-clean-service';
import { CaptionsService } from './captions-service';
import type { SpeechEngine } from './hub';
import { spellingFixer } from './spelling-fixer';

/*
 * Every way a caption leaves the pipeline passes the words-left-out seam (alpha.24, QA24-CAPCLEAN-1), wired as
 * src/main/index.ts wires it: each phrase heard after the caption words' spelling fixer (the service's spell), and
 * the screens' lines last (showCaptions, for the captions service and the coordinator alike). Today's captions,
 * caption AI, the recording's draft, the operator's correction panel, translated captions after translating and an
 * operator's correction. Invented placeholder words from the test switch's list only, never a real bad word.
 */

const PLACEHOLDERS = ['zqvorn', 'ढ़ुम्पक', 'vexmor quill'];
const BAD = /zqvorn|ढ़ुम्पक|ढुम्पक|ઢુમ્પક|vexmor/iu;

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'drashti-caption-clean-paths-'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 26, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(userData, { recursive: true, force: true });
});

function seam() {
  const logs: string[] = [];
  const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };
  const clean = new CaptionCleanService({
    repo: { get: () => [], set: () => undefined },
    own: { gu: [], hi: [], sa: [], en: [] },
    testWords: PLACEHOLDERS,
    pickImport: () => Promise.resolve(null),
    pickExport: () => Promise.resolve(null),
    changed: () => undefined,
    log,
  });
  const screens: (CaptionsShown | null)[] = [];
  // index.ts: const showCaptions = (shown) => engine.setCaptions(captionClean.shown(shown)).
  const showCaptions = (c: CaptionsShown | null) => {
    screens.push(clean.shown(c));
  };
  return { clean, screens, showCaptions, logs, log };
}

function heard(text: string, final: boolean, id: string, language: SpeechLanguage): Heard {
  const words = text.split(' ');
  const endAt = Date.now() - 500;
  const startAt = endAt - words.length * 300;
  return {
    id,
    final,
    language,
    languageConfidence: null,
    words: words.map((w, i) => ({
      text: w,
      startAt: startAt + i * 300,
      endAt: startAt + i * 300 + 250,
      confidence: 0.9,
    })),
    text,
    startAt,
    endAt,
    heardAt: Date.now(),
  };
}

function captions(o: { language: SpeechLanguage; ai?: boolean }) {
  const s = seam();
  let settings: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS, audience: true, language: o.language };
  let out: { heard(h: Heard): void; state(st: SpeechState): void } | null = null;
  const engine: SpeechEngine = {
    start(language, to) {
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        out = null;
      };
    },
  };
  const coordinator = new CaptionCoordinator({
    clock: () => Date.now(),
    settings: () => settings,
    show: s.showCaptions,
    changed: () => undefined,
  });
  const finals: Heard[] = [];
  // The admin's caption words (cap-glossary) run first: a caption word may never bring a bad word back.
  const fixer = spellingFixer([{ language: 'en', word: 'Zentrova' }]);
  const service = new CaptionsService({
    userData,
    platform: 'win32',
    arch: 'x64',
    repo: {
      get: () => settings,
      set: (next) => {
        settings = next;
      },
    },
    engine,
    engineProblem: () => null,
    modelReady: () => true,
    download: () => Promise.resolve(),
    show: s.showCaptions,
    onFinalPhrase: (p) => finals.push(p),
    spell: (p) => s.clean.heard(fixer(p)),
    changed: () => undefined,
    log: s.log,
    ...(o.ai
      ? {
          aiPath: {
            on: () => true,
            route: () => 'whisper',
            recognizer: () => ({ route: 'whisper', modelId: 'placeholder', engine }),
            coordinator,
          },
        }
      : {}),
  });
  const say = (text: string, final: boolean, id = 's1') => out?.heard(heard(text, final, id, o.language));
  return { ...s, service, coordinator, finals, say };
}

const linesOf = (screens: (CaptionsShown | null)[]) => screens.flatMap((c) => c?.lines ?? []);

describe('the words-left-out seam on every caption path', () => {
  it('today’s captions: the screens and the recording’s draft, partials and finals', async () => {
    const t = captions({ language: 'en' });
    t.service.start();
    await t.service.setOn(true);
    t.say('alpha zqvorn', false);
    vi.advanceTimersByTime(400);
    t.say('alpha zqvorn Zentroba vexmor quill beta', true);
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['alpha Zentrova beta']);
    expect(linesOf(t.screens).join(' ')).not.toMatch(BAD);
    expect(t.finals.map((f) => f.text)).toEqual(['alpha Zentrova beta']);
    expect(t.finals[0]?.words.map((w) => w.text)).toEqual(['alpha', 'Zentrova', 'beta']);
    t.service.close();
  });

  it('today’s Sanskrit captions, shown in Gujarati letters', async () => {
    const t = captions({ language: 'sa' });
    t.service.start();
    await t.service.setOn(true);
    t.say('नमूना ढ़ुम्पक नमूना', true);
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)).toMatchObject({ language: 'sa', lines: ['નમૂના નમૂના'] });
    expect(t.finals.map((f) => f.text).join(' ')).not.toMatch(BAD);
    t.service.close();
  });

  it('caption AI: the screens, the draft and the operator’s correction panel', async () => {
    const t = captions({ language: 'gu', ai: true });
    t.service.start();
    await t.service.setOn(true);
    t.say('નમૂનો ઢુમ્પક', false);
    t.say('નમૂનો ઢુમ્પક બીજો', true);
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['નમૂનો બીજો']);
    expect(linesOf(t.screens).join(' ')).not.toMatch(BAD);
    expect(t.finals.map((f) => f.text)).toEqual(['નમૂનો બીજો']);
    const review = t.coordinator.view();
    expect(JSON.stringify([review.current, review.previous])).not.toMatch(BAD);
    expect(review.current?.sourceText).toBe('નમૂનો બીજો');
    t.service.close();
  });

  it('translated captions, after translating, and an operator’s correction', async () => {
    const s = seam();
    const requests: {
      clause: Readonly<CaptionTranslationRequest>;
      resolve: (r: CaptionTranslation) => void;
    }[] = [];
    const coordinator = new CaptionCoordinator({
      mayTranslate: () => true,
      clock: () => Date.now(),
      settings: () => DEFAULT_CAPTION_SETTINGS,
      show: s.showCaptions,
      changed: () => undefined,
      output: 'translation',
      translation: {
        identity: {
          modelIdentity: 'placeholder@1',
          routeId: 'en-hi-placeholder',
          processorId: 'placeholder@1',
          glossaryRevision: 'none',
        },
        translate: (clause) => new Promise((resolve) => requests.push({ clause, resolve })),
      },
    });
    const sessionId = coordinator.start();
    const clause = {
      sessionId,
      phraseId: 's1',
      revision: 1,
      sourceLanguage: 'en' as const,
      targetLanguage: 'hi' as const,
      sourceText: 'A blue box',
      startAt: Date.now() - 1_000,
      endAt: Date.now(),
      status: 'settled' as const,
    };
    expect(coordinator.accept(clause)).toBe(true);
    // The translator brings in a bad word the speaker never said.
    const first = requests[0];
    first?.resolve({ ...first.clause, text: 'पहला ढ़ुम्पक नमूना', status: 'ok', processingMs: 1 });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.screens.at(-1)).toMatchObject({ lines: ['पहला नमूना'], language: 'hi' });
    // The operator's correction, translated again: the same.
    expect(coordinator.correct({ sessionId, phraseId: 's1', revision: 1, text: 'A green box' })).toBe(true);
    const second = requests[1];
    second?.resolve({ ...second.clause, text: 'zqvorn दूसरा नमूना', status: 'ok', processingMs: 1 });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.screens.at(-1)?.lines).toEqual(['दूसरा नमूना']);
    expect(linesOf(s.screens).join(' ')).not.toMatch(BAD);
    coordinator.stop();
  });

  it('an operator’s correction shown as typed, on captions in the speaker’s language', async () => {
    const s = seam();
    const coordinator = new CaptionCoordinator({
      clock: () => Date.now(),
      settings: () => DEFAULT_CAPTION_SETTINGS,
      show: s.showCaptions,
      changed: () => undefined,
    });
    const sessionId = coordinator.start();
    coordinator.accept({
      sessionId,
      phraseId: 's1',
      revision: 1,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      sourceText: 'A blue box',
      startAt: Date.now() - 1_000,
      endAt: Date.now(),
      status: 'settled',
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(coordinator.correct({ sessionId, phraseId: 's1', revision: 1, text: 'A zqvorn box' })).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.screens.at(-1)?.lines).toEqual(['A box']);
    coordinator.stop();
  });

  it('a phrase left out whole, on today’s captions: what showed of it goes, nothing reaches the draft, nothing reads as a fault (review F4)', async () => {
    const t = captions({ language: 'en' });
    t.service.start();
    await t.service.setOn(true);
    t.say('alpha beta', true, 's1');
    vi.advanceTimersByTime(400);
    // The engine's first try at the next phrase, then the phrase as it settles: nothing but listed words.
    t.say('gamma', false, 's2');
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['alpha beta', 'gamma']);
    t.say('zqvorn', true, 's2');
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['alpha beta']);
    expect(t.finals.map((f) => f.text)).toEqual(['alpha beta']);
    expect(t.logs.join('\n')).not.toMatch(/not passed on/u);
    // The next phrase comes as ever.
    t.say('delta', true, 's3');
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['delta']);
    t.service.close();
  });

  it('a phrase left out whole, on caption AI: what showed of it comes off the screens (review F4)', async () => {
    const t = captions({ language: 'gu', ai: true });
    t.service.start();
    await t.service.setOn(true);
    t.say('નમૂનો', false, 's1');
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['નમૂનો']);
    t.say('ઢુમ્પક', true, 's1');
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)).toBeNull();
    expect(t.finals).toEqual([]);
    expect(t.logs.join('\n')).not.toMatch(/not passed on/u);
    t.say('બીજો', true, 's2');
    vi.advanceTimersByTime(400);
    expect(t.screens.at(-1)?.lines).toEqual(['બીજો']);
    t.service.close();
  });

  it('the coordinator takes a phrase being heard off the screens when it is withdrawn, never a settled one', async () => {
    const s = seam();
    const coordinator = new CaptionCoordinator({
      clock: () => Date.now(),
      settings: () => DEFAULT_CAPTION_SETTINGS,
      show: s.showCaptions,
      changed: () => undefined,
    });
    const sessionId = coordinator.start();
    const clause = (phraseId: string, sourceText: string, status: 'provisional' | 'settled') => ({
      sessionId,
      phraseId,
      revision: 1,
      sourceLanguage: 'en' as const,
      targetLanguage: 'en' as const,
      sourceText,
      startAt: Date.now() - 1_000,
      endAt: Date.now(),
      status,
    });
    coordinator.accept(clause('s1', 'A blue box', 'settled'));
    await vi.advanceTimersByTimeAsync(300);
    expect(coordinator.withdraw('s1')).toBe(false);
    expect(s.screens.at(-1)?.lines).toEqual(['A blue box']);
    coordinator.accept(clause('s2', 'A green', 'provisional'));
    await vi.advanceTimersByTimeAsync(300);
    expect(s.screens.at(-1)?.lines).toEqual(['A green']);
    expect(coordinator.withdraw('s3')).toBe(false);
    expect(coordinator.withdraw('s2')).toBe(true);
    expect(s.screens.at(-1)).toBeNull();
    expect(coordinator.view()).toMatchObject({ current: null, previous: { phraseId: 's1' } });
    coordinator.stop();
  });

  it('puts no word left out into any log line', async () => {
    const t = captions({ language: 'en' });
    t.service.start();
    await t.service.setOn(true);
    t.say('alpha zqvorn vexmor quill beta', true);
    vi.advanceTimersByTime(7_000);
    await t.service.setOn(false);
    t.service.close();
    expect(t.logs.length).toBeGreaterThan(0);
    for (const line of t.logs) expect(line).not.toMatch(BAD);
  });
});
