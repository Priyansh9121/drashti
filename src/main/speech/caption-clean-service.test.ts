import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionWord } from '../../shared/caption-words';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsShown } from '../../shared/captions';
import { cleanPhraseKey } from '../../shared/caption-clean/key';
import type { CaptionCleanCount } from '../../shared/caption-clean/words';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import type { VideoCaptionTrack } from '../../shared/video-captions';
import { heardProblem } from './speech-hub';
import { captionCleanHash, CaptionCleanService, type CaptionCleanList } from './caption-clean-service';

/*
 * Words left out of captions in the main process (alpha.24, QA24-CAPCLEAN-1): Drashti's own list (hashes only), the
 * admin's words and, in tests, a placeholder list; each phrase heard and each caption shown on the screens with them
 * left out; the count since captions were turned on; never a word in a log line. Invented placeholder words only,
 * never a real bad word.
 */

const hash = (word: string): string => captionCleanHash(cleanPhraseKey(word));
/** Drashti's own list in this test: placeholder words, as hashes, as the real list holds them. */
const OWN: CaptionCleanList = {
  gu: [],
  hi: [hash('ढ़ुम्पक'), hash('dhumpak')],
  sa: [],
  en: [hash('zqvorn'), hash('vexmor quill')],
};
/** Every placeholder word this file uses as a bad word, for the log checks. */
const WORDS = [
  'zqvorn',
  'vexmor',
  'quill',
  'ढ़ुम्पक',
  'ढुंपक',
  'dhumpak',
  'ठंगोप',
  'ઠંગોપ',
  'flimbat',
  'qelmar',
];

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'drashti-caption-clean-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function setup(o: { words?: CaptionWord[]; testWords?: string[]; hash?: (key: string) => string } = {}) {
  let stored: CaptionWord[] = o.words ?? [];
  const logs: string[] = [];
  const listChanges: number[] = [];
  const counts: CaptionCleanCount[] = [];
  const picks: { open: string | null; save: string | null } = { open: null, save: null };
  const clean = new CaptionCleanService({
    repo: {
      get: () => stored,
      set: (words) => {
        stored = [...words];
      },
    },
    own: OWN,
    ...(o.testWords ? { testWords: o.testWords } : {}),
    ...(o.hash ? { hash: o.hash } : {}),
    pickImport: () => Promise.resolve(picks.open),
    pickExport: () => Promise.resolve(picks.save),
    changed: (count) => counts.push(count),
    listChanged: () => listChanges.push(listChanges.length + 1),
    log: {
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
    },
  });
  return { clean, logs, counts, picks, listChanges, stored: () => stored };
}

let at = Date.UTC(2026, 10, 26, 12, 0, 0);
function phrase(text: string, final = true, id = 's1', language: SpeechLanguage = 'en'): Heard {
  const words = text === '' ? [] : text.split(' ');
  const startAt = (at += 10_000);
  return {
    id,
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
    endAt: startAt + words.length * 400,
    heardAt: startAt + words.length * 400 + 100,
  };
}

const shown = (lines: string[], language: SpeechLanguage = 'en'): CaptionsShown => ({
  ...DEFAULT_CAPTION_SETTINGS,
  lines,
  language,
});

describe('a phrase heard, with bad words left out', () => {
  it('leaves Drashti’s own words out, each other word kept with its times', () => {
    const { clean } = setup();
    const h = phrase('alpha zqvorn beta.');
    const out = clean.heard(h);
    expect(out.words.map((w) => w.text)).toEqual(['alpha', 'beta.']);
    expect(out.text).toBe('alpha beta.');
    expect(out.words[0]).toBe(h.words[0]);
    expect(out.words[1]).toBe(h.words[2]);
    expect({ id: out.id, final: out.final, startAt: out.startAt, endAt: out.endAt }).toEqual({
      id: h.id,
      final: h.final,
      startAt: h.startAt,
      endAt: h.endAt,
    });
    // A closing mark moves onto the word before, which keeps its times.
    const end = clean.heard(phrase('alpha zqvorn.'));
    expect(end.text).toBe('alpha.');
    expect(end.words[0]?.startAt).toBeDefined();
  });

  it('leaves out an entry of two words, a Latin spelling, and a word in the other Indian script', () => {
    const { clean } = setup();
    expect(clean.heard(phrase('alpha vexmor quill beta')).text).toBe('alpha beta');
    expect(clean.heard(phrase('नमूना dhumpak', true, 's1', 'gu')).text).toBe('नमूना');
    expect(clean.heard(phrase('નમૂનો ઢુમ્પક', true, 's1', 'gu')).text).toBe('નમૂનો');
    expect(clean.heard(phrase('नमूना ढुंपक', true, 's1', 'sa')).text).toBe('नमूना');
  });

  it('sends a final phrase left with nothing on as an empty partial of its own id, for the hub to pass on (review F4)', () => {
    const { clean, logs } = setup();
    const h = phrase('zqvorn vexmor quill', true, 's4');
    const out = clean.heard(h);
    expect(out).toMatchObject({
      id: 's4',
      final: false,
      words: [],
      text: '',
      startAt: h.startAt,
      endAt: h.endAt,
    });
    expect(heardProblem(out, { phase: 'listening', language: 'auto' }, new Set())).toBeNull();
    // Counted as the final phrase it was, and nothing said in the log.
    expect(clean.view().leftOut).toBe(2);
    expect(logs).toEqual([]);
    // A phrase that cannot be checked is not shown either way, final or not.
    const failing = setup({
      hash: () => {
        throw new Error('Placeholder failure');
      },
    });
    const failed = failing.clean.heard(phrase('alpha beta', true, 's5'));
    expect(failed).toMatchObject({ id: 's5', final: false, words: [], text: '' });
    expect(heardProblem(failed, { phase: 'listening', language: 'auto' }, new Set())).toBeNull();
  });

  it('passes a phrase with nothing to leave out on as it came', () => {
    const { clean } = setup();
    const h = phrase('alpha zqvornish beta');
    expect(clean.heard(h)).toBe(h);
  });

  it('leaves the words out of its text too, when a partial has no words yet', () => {
    const { clean } = setup();
    const h = { ...phrase('', false), text: 'alpha zqvorn' };
    expect(clean.heard(h)).toMatchObject({ words: [], text: 'alpha' });
  });

  it('leaves out the admin’s own words, whichever language they were added in', () => {
    const { clean } = setup();
    const set = clean.set([
      { language: 'gu', word: 'ઠંગોપ' },
      { language: 'en', word: 'Qelmar' },
    ]);
    expect(set.ok).toBe(true);
    expect(clean.heard(phrase('नमूना ठंगोप', true, 's1', 'hi')).text).toBe('नमूना');
    expect(clean.heard(phrase('alpha QELMAR beta', true, 's2', 'gu')).text).toBe('alpha beta');
    // Taken off the list: shown again.
    clean.set([{ language: 'en', word: 'Qelmar' }]);
    expect(clean.heard(phrase('नमूना ठंगोप', true, 's3', 'hi')).text).toBe('नमूना ठंगोप');
  });

  it('leaves out the test switch’s placeholder words as Drashti’s own', () => {
    const { clean } = setup({ testWords: ['flimbat'] });
    expect(clean.heard(phrase('alpha Flimbat beta')).text).toBe('alpha beta');
  });
});

describe('the lines shown on the screens, with bad words left out', () => {
  it('leaves words out of every line and across a line break; a line left empty goes; nothing left shows nothing', () => {
    const { clean } = setup();
    expect(clean.shown(shown(['alpha zqvorn beta']))?.lines).toEqual(['alpha beta']);
    expect(clean.shown(shown(['alpha vexmor', 'quill beta']))?.lines).toEqual(['alpha', 'beta']);
    expect(clean.shown(shown(['zqvorn.', 'beta']))?.lines).toEqual(['beta']);
    expect(clean.shown(shown(['पहला ढ़ुम्पक नमूना'], 'hi'))).toMatchObject({
      lines: ['पहला नमूना'],
      language: 'hi',
    });
    expect(clean.shown(shown(['zqvorn']))).toBeNull();
    expect(clean.shown(shown(['zqvorn', 'dhumpak']))).toBeNull();
    expect(clean.shown(null)).toBeNull();
  });

  it('gives lines with nothing to leave out back as they came', () => {
    const { clean } = setup();
    const c = shown(['alpha', 'beta zqvornish']);
    expect(clean.shown(c)).toBe(c);
  });
});

describe('the count of words left out', () => {
  it('counts each phrase once however often it is revised, and each caption once however often it is painted', () => {
    const { clean, counts } = setup();
    clean.captionsOn(true);
    clean.heard(phrase('alpha zqvorn', false, 's1'));
    clean.heard(phrase('alpha zqvorn beta', false, 's1'));
    expect(clean.view().leftOut).toBe(0);
    clean.heard(phrase('alpha zqvorn beta zqvorn', true, 's1'));
    expect(clean.view().leftOut).toBe(2);
    // A phrase never heard whole counts when the next one starts.
    clean.heard(phrase('zqvorn', false, 's2'));
    clean.heard(phrase('gamma', true, 's3'));
    expect(clean.view().leftOut).toBe(3);
    // A translation painted three times counts once; another caption counts again.
    for (let i = 0; i < 3; i += 1) clean.shown(shown(['पहला ढ़ुम्पक नमूना'], 'hi'));
    expect(clean.view().leftOut).toBe(4);
    clean.shown(shown(['दूसरा ढ़ुम्पक'], 'hi'));
    expect(clean.view().leftOut).toBe(5);
    expect(counts.at(-1)).toEqual({ leftOut: 5 });
    // From nothing again each time captions are turned on.
    clean.captionsOn(true);
    expect(clean.view().leftOut).toBe(5);
    clean.captionsOn(false);
    clean.captionsOn(true);
    expect(clean.view().leftOut).toBe(0);
    expect(counts.at(-1)).toEqual({ leftOut: 0 });
  });
});

describe('when a caption cannot be checked', () => {
  it('shows nothing of it (never the words unchecked), said once in the log without a word', () => {
    const { clean, logs } = setup({
      hash: () => {
        throw new Error('Placeholder failure');
      },
    });
    expect(clean.heard(phrase('alpha zqvorn beta'))).toMatchObject({ words: [], text: '' });
    expect(clean.heard(phrase('alpha beta', true, 's2'))).toMatchObject({ words: [], text: '' });
    expect(clean.shown(shown(['alpha zqvorn']))).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/could not be checked/u);
  });
});

describe('the admin’s list', () => {
  it('keeps each word checked, per language in the admin’s order, a repeat (by key) or anything past 200 left out', () => {
    const { clean, stored } = setup();
    const result = clean.set([
      { language: 'gu', word: '  ઠંગોપ ' },
      { language: 'hi', word: 'ठंगोप' },
      { language: 'gu', word: 'ઠઁગોપ' },
      { language: 'en', word: 'Qelmar, Velmorin' },
      { language: 'en', word: 'Qelmar' },
      { language: 'en', word: 'QELMAR' },
    ]);
    expect(result.view.words).toEqual([
      { language: 'gu', word: 'ઠંગોપ' },
      { language: 'hi', word: 'ठंगोप' },
      { language: 'en', word: 'Qelmar' },
    ]);
    expect(stored()).toEqual(result.view.words);
    const many = Array.from({ length: 205 }, (_, i) => ({
      language: 'en' as const,
      word: `Qelmar${String(i)}`,
    }));
    expect(clean.set(many).view.words).toHaveLength(200);
  });

  it('says how many words Drashti’s own list has per language, never the words', () => {
    const { clean } = setup();
    const view = clean.view();
    expect(view.own).toEqual({ gu: 0, hi: 2, sa: 0, en: 2 });
    expect(JSON.stringify(view)).not.toMatch(/zqvorn|dhumpak|vexmor/u);
  });

  it('imports and exports Caption Words’ CSV file', async () => {
    const { clean, picks } = setup();
    const file = join(folder, 'words.csv');
    writeFileSync(
      file,
      'Language,Word\nGujarati,ઠંગોપ\nFrench,Velmorin\nEnglish,Qelmar\nEnglish,qelmar\n',
      'utf8',
    );
    picks.open = file;
    const imported = await clean.importFile();
    expect(imported.view.words).toEqual([
      { language: 'gu', word: 'ઠંગોપ' },
      { language: 'en', word: 'Qelmar' },
    ]);
    expect(imported.message).toBe(
      'Added 2 words. 1 word was in the list already. 1 line could not be read; line 3: The language is not Gujarati, Hindi, Sanskrit or English.',
    );
    const saved = join(folder, 'out.csv');
    picks.save = saved;
    const exported = await clean.exportFile();
    expect(exported).toMatchObject({ ok: true, message: 'Saved 2 words.' });
    expect(readFileSync(saved, 'utf8')).toBe('\ufeffLanguage,Word\r\nGujarati,ઠંગોપ\r\nEnglish,Qelmar\r\n');
    // Cancelled: nothing changes, nothing said.
    picks.open = null;
    expect((await clean.importFile()).message).toBeNull();
    // Not a file it can read.
    picks.open = join(folder, 'missing.csv');
    expect(await clean.importFile()).toMatchObject({
      ok: false,
      message: 'That file could not be read. Check it and try again.',
    });
  });
});

describe('the words themselves', () => {
  it('never reach a log line or the count told to the window, whatever happens', async () => {
    const console_ = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
    ];
    try {
      const { clean, logs, counts, picks } = setup({ testWords: ['flimbat'] });
      clean.captionsOn(true);
      clean.set([{ language: 'en', word: 'Qelmar' }]);
      const file = join(folder, 'words.csv');
      writeFileSync(file, 'English,Flimbat\nEnglish,Qelmar\nKlingon,zqvorn\n', 'utf8');
      picks.open = file;
      await clean.importFile();
      picks.save = join(folder, 'out.csv');
      await clean.exportFile();
      picks.save = join(folder, 'no-such-folder', 'out.csv');
      await clean.exportFile();
      for (const text of ['alpha zqvorn beta', 'vexmor quill', 'नमूना ढ़ुम्पक', 'qelmar flimbat dhumpak'])
        clean.heard(phrase(text));
      clean.shown(shown(['zqvorn ठंगोप']));
      const failing = setup({
        hash: () => {
          throw new Error('zqvorn');
        },
      });
      failing.clean.heard(phrase('alpha zqvorn'));
      failing.clean.shown(shown(['alpha zqvorn']));
      const said = [
        ...logs,
        ...failing.logs,
        ...counts.map((c) => JSON.stringify(c)),
        ...console_.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))),
      ];
      expect(logs.length).toBeGreaterThan(0);
      for (const line of said) {
        const low = line.toLowerCase();
        for (const word of WORDS) {
          expect(low, line).not.toContain(word.toLowerCase());
          expect(low, line).not.toContain(hash(word));
        }
      }
    } finally {
      for (const spy of console_) spy.mockRestore();
    }
  });
});

describe('Main’s memory (review F3)', () => {
  it('keeps no caption that had words left out, only its hash', () => {
    const { clean } = setup();
    clean.shown(shown(['alpha zqvorn beta']));
    clean.shown(shown(['alpha zqvorn beta']));
    clean.heard(phrase('gamma zqvorn', false, 's9'));
    clean.track(track(['alpha zqvorn']));
    const held = JSON.stringify(clean, (_key, value: unknown) =>
      value instanceof Set || value instanceof Map ? [...(value as Iterable<unknown>)] : value,
    );
    expect(held).not.toMatch(/zqvorn/u);
    expect(clean.view().leftOut).toBe(1);
  });
});

/** A video's caption track (a file beside it), as the library keeps it. */
function track(texts: string[]): VideoCaptionTrack {
  return {
    id: 'placeholder-track',
    language: 'en',
    automatic: true,
    name: 'English (automatic)',
    cues: texts.map((text, i) => ({ startMs: i * 1_000, endMs: i * 1_000 + 900, text })),
  };
}

describe('a video’s caption file, as the screens show it (the owner: "Yes, clean them too")', () => {
  it('leaves the words out of each cue, keeps its lines and times, and drops a cue left with nothing', () => {
    const { clean, counts } = setup();
    const t = track([
      'alpha zqvorn beta',
      'zqvorn',
      'gamma\nvexmor quill delta',
      'नमूना ढ़ुम्पक।',
      'epsilon',
    ]);
    const out = clean.track(t);
    expect(out?.cues).toEqual([
      { startMs: 0, endMs: 900, text: 'alpha beta' },
      { startMs: 2_000, endMs: 2_900, text: 'gamma\ndelta' },
      { startMs: 3_000, endMs: 3_900, text: 'नमूना।' },
      { startMs: 4_000, endMs: 4_900, text: 'epsilon' },
    ]);
    expect(out?.cues[3]).toBe(t.cues[4]);
    expect({ ...out, cues: [] }).toEqual({ ...t, cues: [] });
    // Never counted: the count is live captions'.
    expect(clean.view().leftOut).toBe(0);
    expect(counts).toEqual([]);
    expect(clean.track(null)).toBeNull();
  });

  it('gives the same track back while the track and the lists are unchanged, a new one after the list changes', () => {
    const { clean, listChanges } = setup();
    const t = track(['alpha qelmar beta', 'gamma']);
    const clean1 = clean.track(t);
    expect(clean.track(t)).toBe(clean1);
    expect(clean1).toBe(t);
    clean.set([{ language: 'en', word: 'Qelmar' }]);
    expect(listChanges).toEqual([1]);
    const clean2 = clean.track(t);
    expect(clean2).not.toBe(clean1);
    expect(clean2?.cues.map((c) => c.text)).toEqual(['alpha beta', 'gamma']);
    expect(clean.track(t)).toBe(clean2);
  });

  it('shows no cue that cannot be checked', () => {
    const { clean, logs } = setup({
      hash: () => {
        throw new Error('Placeholder failure');
      },
    });
    expect(clean.track(track(['alpha', 'beta']))?.cues).toEqual([]);
    expect(logs).toHaveLength(1);
  });
});

describe('a key’s hash', () => {
  it('is SHA-256 of Drashti’s prefix and the key, in lower-case hex', () => {
    expect(captionCleanHash('zqvorn')).toBe(
      '2593729c03fcfe0c513c98ba8b9693beb408f03829ebe46336c8c57a9cf53967',
    );
    expect(captionCleanHash('vexmor quill')).toBe(
      'ffb02afe17ef4ef9e54799abb63a8e09862c4fd53b3a91805649e7c435a05fb9',
    );
  });
});
