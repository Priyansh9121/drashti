import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { CaptionsService } from './captions-service';
import type { SpeechEngine } from './hub';
import { spellingFixer } from './spelling-fixer';

/*
 * Live captions with the admin's caption words (alpha.22): every phrase from the engine, partials too, goes through
 * the spelling fixer before the screens and a sound recording's draft see it. Without caption words, captions are
 * exactly as before. A stand-in engine; invented placeholder words only.
 */

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'drashti-captions-words-'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 23, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(userData, { recursive: true, force: true });
});

function setup(spell?: (h: Heard) => Heard) {
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  const engine: SpeechEngine = {
    start(language, to) {
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        out = null;
      };
    },
  };
  const shown: (CaptionsShown | null)[] = [];
  const finals: Heard[] = [];
  const service = new CaptionsService({
    userData,
    platform: 'darwin',
    arch: 'arm64',
    repo: { get: () => ({ ...DEFAULT_CAPTION_SETTINGS, language: 'en' }), set: () => undefined },
    engine,
    engineProblem: () => null,
    modelReady: () => true,
    download: () => Promise.resolve(),
    show: (c) => shown.push(c),
    onFinalPhrase: (p) => finals.push(p),
    changed: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
    ...(spell ? { spell } : {}),
  });
  const say = (text: string, final: boolean, language: SpeechLanguage = 'en') => {
    const endAt = Date.now() - 1_000;
    const words = text.split(' ');
    const startAt = endAt - words.length * 400 + 100;
    out?.heard({
      id: 's1',
      final,
      language,
      languageConfidence: null,
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
  return { service, shown, finals, say };
}

describe('live captions with caption words', () => {
  it('show a word heard close to a caption word as written, in partials and finals and the recording’s draft', async () => {
    const { service, shown, finals, say } = setup(spellingFixer([{ language: 'en', word: 'Zentrova' }]));
    service.start();
    await service.setOn(true);
    say('alpha Zentroba', false);
    expect(shown.at(-1)?.lines).toEqual(['alpha Zentrova']);
    vi.advanceTimersByTime(400);
    say('alpha Zentroba beta', true);
    vi.advanceTimersByTime(400);
    expect(shown.at(-1)?.lines).toEqual(['alpha Zentrova beta']);
    expect(finals.map((f) => f.text)).toEqual(['alpha Zentrova beta']);
    expect(finals[0]?.words.map((w) => w.text)).toEqual(['alpha', 'Zentrova', 'beta']);
    service.close();
  });

  it('are exactly as before without caption words', async () => {
    const { service, shown, finals, say } = setup();
    service.start();
    await service.setOn(true);
    say('alpha Zentroba beta', true);
    expect(shown.at(-1)?.lines).toEqual(['alpha Zentroba beta']);
    expect(finals.map((f) => f.text)).toEqual(['alpha Zentroba beta']);
    service.close();
  });
});
