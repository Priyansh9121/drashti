import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionRevision } from '../../shared/caption-coordinator';
import {
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_CAPTION_TIMING,
  type CaptionModelId,
  type CaptionSettings,
  type CaptionsShown,
} from '../../shared/captions';
import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { CaptionCoordinator } from './caption-coordinator';
import type { CaptionSpelling } from './caption-flow';
import { CaptionsService, type CaptionsServiceDeps } from './captions-service';
import type { SpeechEngine } from './hub';

/*
 * Caption AI inside the captions service (cap-integration): a model from the offline pack (cap-pack's "is it
 * installed and checked, and where", a stand-in here) -> the speaker's language chosen -> the recognizer started in
 * that language with that model -> its words through the coordinator (Codex x90) and the glossary's fixer
 * (cap-glossary, a stand-in) -> the lines on the screens. And off (the default): today's captions exactly as now.
 * Placeholder words only; no sound, no model, no download.
 */

/** The Gujarati model in the placeholder pack, as a route made its recognizer (Route W here; Route C plugs in alike). */
const GU = 'gu-small-placeholder';

const SPELLING: CaptionSpelling = (h) => {
  if (h.language !== 'gu') return h;
  const words = h.words.map((w) => (w.text === 'ખોખુ' ? { ...w, text: 'ખોખું' } : w));
  return { ...h, words, text: words.map((w) => w.text).join(' ') };
};

function setup(o: { ai?: boolean; aiWired?: boolean; pack?: Partial<Record<SpeechLanguage, string>> } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-captions-ai-'));
  let settings: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS, audience: true };
  let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
  /** Which recognizer started, in which language: today's engine, or the one a route made from a pack model. */
  const started: { engine: string; language: string }[] = [];
  const shown: (CaptionsShown | null)[] = [];
  const downloads: string[] = [];
  const accepted: CaptionRevision[] = [];
  const ai = { on: o.ai ?? false };
  const coordinator = new CaptionCoordinator({
    settings: () => settings,
    show: (c) => shown.push(c),
    changed: () => undefined,
  });
  const accept = coordinator.accept.bind(coordinator);
  coordinator.accept = (clause) => {
    accepted.push(clause);
    return accept(clause);
  };
  const recognizer = (name: string): SpeechEngine => ({
    start(language, to) {
      started.push({ engine: name, language });
      out = to;
      to.state({ phase: 'listening', language });
      return () => {
        out = null;
      };
    },
  });
  const engine = recognizer('today');
  const made = new Map<string, SpeechEngine>();
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
    modelReady: (id: CaptionModelId) => id === 'small',
    download: async (id) => {
      downloads.push(id);
      await Promise.resolve();
    },
    show: (c) => shown.push(c),
    changed: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
  };
  const service = new CaptionsService(
    (o.aiWired ?? true)
      ? {
          ...deps,
          aiPath: {
            on: () => ai.on,
            recognizer: (language) => {
              const modelId = o.pack?.[language];
              if (modelId === undefined) return null;
              if (!made.has(modelId)) made.set(modelId, recognizer(modelId));
              return { route: 'whisper', modelId, engine: made.get(modelId) ?? recognizer(modelId) };
            },
            coordinator,
            spelling: SPELLING,
          },
        }
      : deps,
  );
  const say = (text: string, final: boolean, id = 's1', language: SpeechLanguage = 'gu') => {
    const words = text.split(' ');
    const endAt = Date.now() - 500;
    const startAt = endAt - words.length * 300;
    out?.heard({
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
    });
  };
  const choose = (language: SpeechLanguage | 'auto') => service.setSettings({ ...settings, language });
  return {
    service,
    ai,
    say,
    choose,
    started,
    shown,
    downloads,
    accepted,
    coordinator,
    lines: () => shown.at(-1)?.lines ?? null,
  };
}

/** Two phrases, each half then whole, Gujarati chosen; then off. */
async function twoPhrases(t: ReturnType<typeof setup>): Promise<void> {
  t.choose('gu');
  await t.service.setOn(true);
  t.say('લીલું', false, 's1');
  t.say('લીલું ખોખુ', true, 's1');
  vi.advanceTimersByTime(300);
  t.say('ગોળ', false, 's2');
  vi.advanceTimersByTime(300);
  t.say('ગોળ આકાર', true, 's2');
  vi.advanceTimersByTime(7_000);
  await t.service.setOn(false);
  t.service.close();
}

/** Today's screens for them, on a service with no caption AI wired at all. */
async function todays(): Promise<(CaptionsShown | null)[]> {
  const t = setup({ aiWired: false });
  await twoPhrases(t);
  return t.shown;
}

describe('caption AI in the captions service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('off (the default): exactly today’s captions, the phrase before kept above the next; the coordinator hears nothing', async () => {
    const before = await todays();
    expect(before.filter((c) => c !== null).map((c) => c.lines)).toEqual([
      ['લીલું'],
      ['લીલું ખોખુ'],
      ['લીલું ખોખુ', 'ગોળ'],
      ['ગોળ આકાર'],
    ]);
    const t = setup({ ai: false, pack: { gu: GU } });
    await twoPhrases(t);
    expect(t.shown).toEqual(before);
    expect(t.accepted).toEqual([]);
    expect(t.coordinator.view().on).toBe(false);
    expect(t.started).toEqual([{ engine: 'today', language: 'gu' }]);
    expect(t.service.aiRecognizer()).toBeNull();
  });

  it('on, Gujarati chosen, its checked model in the pack: the recognizer a route made from it starts in Gujarati; one clause at a time, the glossary’s spelling', async () => {
    const t = setup({ ai: true, pack: { gu: GU } });
    t.choose('gu');
    await t.service.setOn(true);
    expect(t.started).toEqual([{ engine: GU, language: 'gu' }]);
    expect(t.service.aiRecognizer()).toEqual({ route: 'whisper', modelId: GU });
    expect(t.service.view().speech).toEqual({ phase: 'listening', language: 'gu' });
    // No general model is fetched for caption AI: its models come from the pack.
    expect(t.downloads).toEqual([]);
    t.say('લીલું', false, 's1');
    expect(t.lines()).toEqual(['લીલું']);
    t.say('લીલું ખોખુ', true, 's1');
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['લીલું ખોખું']);
    expect(t.accepted.map((c) => [c.phraseId, c.revision, c.status, c.sourceText])).toEqual([
      ['s1', 1, 'provisional', 'લીલું'],
      ['s1', 2, 'settled', 'લીલું ખોખું'],
    ]);
    // The next phrase replaces it whole (no roll-up of the one before).
    t.say('ગોળ આકાર', true, 's2');
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['ગોળ આકાર']);
    expect(t.shown.at(-1)).toMatchObject({ language: 'gu', audience: true, size: 'medium', place: 'bottom' });
    await t.service.setOn(false);
    expect(t.shown.at(-1)).toBeNull();
    expect(t.coordinator.view().on).toBe(false);
    t.service.close();
  });

  it('on, but no checked model for the language chosen, or "auto": no words, a plain reason, nothing downloaded', async () => {
    const t = setup({ ai: true, pack: { gu: GU } });
    t.choose('hi');
    await t.service.setOn(true);
    expect(t.started).toEqual([]);
    expect(t.service.view().speech).toEqual({
      phase: 'failed',
      message:
        'Caption AI has no checked model for Hindi: import the model pack (Help › Caption and Translation Models…).',
    });
    t.choose('auto');
    expect(t.started).toEqual([]);
    expect(t.service.view().speech).toEqual({
      phase: 'failed',
      message: 'Caption AI listens for one language: choose the speaker’s language.',
    });
    expect(t.downloads).toEqual([]);
    expect(t.shown.filter((c) => c !== null)).toEqual([]);
    // Gujarati chosen again: listening, with the pack's model.
    t.choose('gu');
    expect(t.started).toEqual([{ engine: GU, language: 'gu' }]);
    t.service.close();
  });

  it('turned off while listening: today’s captions take over at once and the coordinator’s session closes; on again, a new session', async () => {
    const t = setup({ ai: true, pack: { gu: GU } });
    t.choose('gu');
    await t.service.setOn(true);
    t.say('લીલું ખોખુ', true, 's1');
    const first = t.coordinator.view().sessionId;
    expect(first).not.toBeNull();
    t.ai.on = false;
    t.service.aiPathChanged();
    expect(t.coordinator.view().on).toBe(false);
    expect(t.started.map((s) => s.engine)).toEqual([GU, 'today']);
    expect(t.service.aiRecognizer()).toBeNull();
    t.say('લીલું ખોખુ', true, 's1');
    vi.advanceTimersByTime(300);
    // Today's feed, as it is: the glossary's fixer is not part of it.
    expect(t.lines()).toEqual(['લીલું ખોખુ']);
    expect(t.accepted).toHaveLength(1);
    t.ai.on = true;
    t.service.aiPathChanged();
    expect(t.coordinator.view().sessionId).not.toBeNull();
    expect(t.coordinator.view().sessionId).not.toBe(first);
    t.service.close();
  });

  it('the path follows the speaker’s language and its own model at once: a language change or a relisten re-chooses it', async () => {
    const t = setup({ ai: true, pack: { gu: GU } });
    // Caption AI is on only for Gujarati here (its own model); Hindi has none.
    t.ai.on = false;
    t.choose('hi');
    await t.service.setOn(true);
    expect(t.started.map((s) => s.engine)).toEqual(['today']);
    // Gujarati chosen: caption AI takes over without captions being turned off and on.
    t.ai.on = true;
    t.choose('gu');
    expect(t.started.at(-1)).toEqual({ engine: GU, language: 'gu' });
    expect(t.coordinator.view().on).toBe(true);
    // Its own model taken away (a relisten, as cap-whisper's choice of the general model does): today's captions.
    t.ai.on = false;
    t.service.setTiming(DEFAULT_CAPTION_TIMING);
    expect(t.started.at(-1)).toEqual({ engine: 'today', language: 'gu' });
    expect(t.coordinator.view().on).toBe(false);
    t.service.close();
  });

  it('while caption AI runs, the operator’s review shows its phrase and a correction goes to the screens', async () => {
    const t = setup({ ai: true, pack: { gu: GU } });
    t.choose('gu');
    await t.service.setOn(true);
    t.say('લીલું ખોખુ', true, 's1');
    vi.advanceTimersByTime(300);
    const review = t.service.prototypeView();
    expect(review.on).toBe(true);
    expect(review.current).toMatchObject({ phraseId: 's1', status: 'settled', sourceText: 'લીલું ખોખું' });
    const current = review.current;
    if (!current) throw new Error('No phrase to correct');
    expect(
      t.service.correctPrototype({
        sessionId: current.sessionId,
        phraseId: current.phraseId,
        revision: current.revision,
        text: 'વાદળી ખોખું',
      }),
    ).toBe(true);
    vi.advanceTimersByTime(300);
    expect(t.lines()).toEqual(['વાદળી ખોખું']);
    expect(t.service.prototypeView().current).toMatchObject({ status: 'corrected' });
    t.service.close();
  });
});
