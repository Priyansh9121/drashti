import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAPTION_HINTS_ON, type CaptionWord } from '../../shared/caption-words';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import { CaptionWordsService } from './caption-words-service';

/*
 * Caption words as the admin keeps them (alpha.22): the list kept, the engine's hints and the spelling fixer made
 * again at each change, Import… and Export… with a small CSV file. The log says counts, never a word. Invented
 * placeholder words only.
 */

const GU = 'ઝેન્ટ્રોવા';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-caption-words-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function setup(kept: CaptionWord[] = []) {
  let stored = kept;
  let hintsOn: Partial<Record<SpeechLanguage, boolean>> = {};
  const logs: string[] = [];
  const picks: { open: string | null; save: string | null; saveNames: string[] } = {
    open: null,
    save: null,
    saveNames: [],
  };
  const service = new CaptionWordsService({
    repo: {
      get: () => stored,
      set: (w) => {
        stored = [...w];
      },
      hintsOn: () => ({ ...CAPTION_HINTS_ON, ...hintsOn }),
      setHintsOn: (language, on) => {
        hintsOn = { ...hintsOn, [language]: on };
      },
    },
    pickImport: () => Promise.resolve(picks.open),
    pickExport: (name) => {
      picks.saveNames.push(name);
      return Promise.resolve(picks.save);
    },
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  return { service, logs, picks, stored: () => stored, hintsOn: () => hintsOn };
}

const heard = (text: string, language: Heard['language'] = 'en'): Heard => ({
  id: 's1',
  final: true,
  language,
  languageConfidence: null,
  words: text.split(' ').map((w, i) => ({ text: w, startAt: i * 100, endAt: i * 100 + 50, confidence: 0.5 })),
  text,
  startAt: 0,
  endAt: (text.split(' ').length - 1) * 100 + 50,
  heardAt: 1_000,
});

describe('caption words as the admin keeps them', () => {
  it('starts with the library’s list, and a change is kept and used at once by the fixer and the hints', () => {
    const { service, stored } = setup([{ language: 'en', word: 'Zentrova' }]);
    expect(service.fix(heard('Zentroba beta')).text).toBe('Zentrova beta');
    expect(service.view()).toEqual({
      words: [{ language: 'en', word: 'Zentrova' }],
      hinted: { gu: 0, hi: 0, sa: 0, en: 1 },
      hintsOn: { gu: false, hi: true, sa: true, en: true },
    });
    const result = service.set([
      { language: 'en', word: ' Velmorin ' },
      { language: 'gu', word: GU },
      { language: 'en', word: 'velmorin' },
    ]);
    expect(result.ok).toBe(true);
    expect(stored()).toEqual([
      { language: 'en', word: 'Velmorin' },
      { language: 'gu', word: GU },
    ]);
    expect(service.fix(heard('Zentroba Velmorim')).text).toBe('Zentroba Velmorin');
    expect(service.hints.for('en').prompt).toBe('Velmorin');
    // Gujarati's hints are off until the admin turns them on; its spellings are fixed either way.
    expect(service.hints.for('gu').prompt).toBe('');
    expect(result.view.hinted).toEqual({ gu: 0, hi: 0, sa: 0, en: 1 });
  });

  it('gives a language’s words to the engine as hints only while its switch is on: Gujarati off at first', () => {
    const { service, hintsOn } = setup([
      { language: 'gu', word: GU },
      { language: 'en', word: 'Zentrova' },
    ]);
    expect(service.hints.for('gu').prompt).toBe('');
    expect(service.fix(heard('ઝેન્ટરોવા', 'gu')).text).toBe(GU);
    const on = service.setHints('gu', true);
    expect(on.view.hintsOn.gu).toBe(true);
    expect(on.view.hinted.gu).toBe(1);
    expect(hintsOn()).toEqual({ gu: true });
    expect(service.hints.for('gu').prompt).toBe(GU);
    expect(service.setHints('en', false).view.hinted.en).toBe(0);
    expect(service.hints.for('en').prompt).toBe('');
    // Anything else is refused, and changes nothing.
    expect(service.setHints('fr', true)).toMatchObject({ ok: false });
    expect(service.setHints('hi', 'yes')).toMatchObject({ ok: false });
    expect(hintsOn()).toEqual({ gu: true, en: false });
  });

  it('imports a file’s words onto the end of the list, saying what it added and which lines it could not read', async () => {
    const { service, picks, logs } = setup([{ language: 'en', word: 'Zentrova' }]);
    const file = join(dir, 'words.csv');
    writeFileSync(file, `\uFEFFLanguage,Word\r\nEnglish,Zentrova\r\nGujarati,${GU}\r\nFrench,Velmorin\r\n`);
    picks.open = file;
    const result = await service.importFile();
    expect(result.view.words).toEqual([
      { language: 'en', word: 'Zentrova' },
      { language: 'gu', word: GU },
    ]);
    expect(result.message).toBe(
      'Added 1 word. 1 word was in the list already. 1 line could not be read; line 4: The language is not Gujarati, Hindi, Sanskrit or English.',
    );
    // The log counts, never a word.
    expect(logs.join('\n')).not.toMatch(/Zentrova|Velmorin|ઝ/u);
    expect(logs.join('\n')).toMatch(/1 word added from a file/u);
  });

  it('reads a list saved as UTF-16 too, and refuses a file too large or not text', async () => {
    const { service, picks } = setup();
    const utf16 = join(dir, 'utf16.csv');
    writeFileSync(
      utf16,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`Hindi,वेल्मोरिन\r\n`, 'utf16le')]),
    );
    picks.open = utf16;
    expect((await service.importFile()).view.words).toEqual([{ language: 'hi', word: 'वेल्मोरिन' }]);
    const big = join(dir, 'big.csv');
    writeFileSync(big, `English,Zentrova\n`.repeat(20_000));
    picks.open = big;
    expect(await service.importFile()).toMatchObject({
      ok: false,
      message: 'That file is too large for a caption words list (256 KB at most).',
    });
    const binary = join(dir, 'picture.csv');
    writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xc3, 0x28, 0xa0, 0xa1]));
    picks.open = binary;
    expect(await service.importFile()).toMatchObject({
      ok: false,
      message: 'That file is not text. Save the list as CSV (UTF-8) and try again.',
    });
    // Cancelled: nothing changes, nothing said.
    picks.open = null;
    expect(await service.importFile()).toMatchObject({ ok: true, message: null });
  });

  it('exports the list as CSV where the admin chooses, ready to import on another Main', async () => {
    const { service, picks } = setup([
      { language: 'en', word: 'Zentrova' },
      { language: 'gu', word: GU },
    ]);
    picks.save = join(dir, 'out.csv');
    const result = await service.exportFile();
    expect(result).toMatchObject({ ok: true, message: 'Saved 2 words.' });
    expect(picks.saveNames).toEqual(['Caption words.csv']);
    expect(readFileSync(picks.save, 'utf8')).toBe(
      `\uFEFFLanguage,Word\r\nEnglish,Zentrova\r\nGujarati,${GU}\r\n`,
    );
    const other = setup();
    other.picks.open = picks.save;
    expect((await other.service.importFile()).view.words).toEqual(service.view().words);
    picks.save = join(dir, 'no-such-folder', 'out.csv');
    expect(await service.exportFile()).toMatchObject({
      ok: false,
      message: 'The list could not be saved there. Choose another place.',
    });
  });

  it('never stops the captions: a phrase the fixer cannot read goes on as heard (said once in the log)', () => {
    const { service, logs } = setup([{ language: 'en', word: 'Zentrova' }]);
    const broken = { ...heard('Zentroba'), words: undefined } as unknown as Heard;
    expect(service.fix(broken)).toBe(broken);
    expect(service.fix(broken)).toBe(broken);
    expect(logs.filter((l) => l.includes('spelling fixer failed'))).toHaveLength(1);
  });
});
