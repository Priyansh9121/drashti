import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { cleanPhraseKey } from '../../shared/caption-clean/key';
import {
  hashWord,
  listSource,
  readLists,
  readWords,
  runHash,
  updateList,
} from '../../../scripts/caption-clean-hash.mjs';
import { captionCleanHash } from './caption-clean-service';

/*
 * The script that keeps Drashti's own list of words left out of captions (alpha.24, QA24-CAPCLEAN-1a A): it hashes
 * words exactly as the captions look them up, writes src/shared/caption-clean/list.ts sorted, once each, as prettier
 * keeps it, and says what it did in counts, never a word. Invented placeholder words only, never a real bad word.
 */

const EMPTY = { gu: [], hi: [], sa: [], en: [] };

describe('the list’s script', () => {
  it('hashes a word as the captions look it up, in any script or spelling', () => {
    for (const word of [
      'zqvorn',
      'ZQVÖRN',
      'vexmor  quill',
      'ढ़ुम्पक',
      'ढुंपक',
      'ઢુમ્પક',
      'ઠઁગોપ',
      'dhumpak',
    ])
      expect(hashWord(word)).toBe(captionCleanHash(cleanPhraseKey(word)));
    expect(hashWord('ढ़ुम्पक')).toBe(hashWord('ઢુંપક'));
  });

  it('reads the words file: a language and a word a line, blank lines and # lines passed over', () => {
    const read = readWords(
      '\ufeffLanguage,Word\n# a note\n\nEnglish,Zqvorn\nhi,ढ़ुम्पक\nGujarati, ઠંગોપ \nFrench,Velmorin\nEnglish\n',
    );
    expect(read.words).toEqual([
      { language: 'en', word: 'Zqvorn' },
      { language: 'hi', word: 'ढ़ुम्पक' },
      { language: 'gu', word: 'ઠંગોપ' },
    ]);
    // The lines it cannot read, by number only (the word may be one to leave out).
    expect(read.problems).toEqual([7, 8]);
  });

  it('adds and removes words in the list, each language sorted and once each, and counts what it did', async () => {
    const added = updateList(
      listSource(EMPTY),
      [
        { language: 'en', word: 'zqvorn' },
        { language: 'en', word: 'ZQVORN' },
        { language: 'hi', word: 'ढ़ुम्पक' },
        { language: 'en', word: 'vexmor quill' },
      ],
      'add',
    );
    expect(added.counts).toEqual({ changed: 3, unchanged: 1 });
    const lists = readLists(added.source);
    expect(lists.en).toEqual([hashWord('zqvorn'), hashWord('vexmor quill')].sort());
    expect(lists.hi).toEqual([hashWord('ढ़ुम्पक')]);
    expect(lists.gu).toEqual([]);
    const removed = updateList(
      added.source,
      [
        { language: 'en', word: 'Zqvorn' },
        { language: 'gu', word: 'ઠંગોપ' },
      ],
      'remove',
    );
    expect(removed.counts).toEqual({ changed: 1, unchanged: 1 });
    expect(readLists(removed.source).en).toEqual([hashWord('vexmor quill')]);
    // As prettier keeps it, with nothing in it but hashes.
    const config = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '.prettierrc.json'), 'utf8'),
    ) as object;
    for (const source of [listSource(EMPTY), added.source, removed.source])
      expect(await format(source, { ...config, parser: 'typescript' })).toBe(source);
    expect(added.source).not.toMatch(/zqvorn|vexmor|ढ़ुम्पक/iu);
  });

  it('keeps the list file in the repo readable by itself', () => {
    const file = join(__dirname, '..', '..', 'shared', 'caption-clean', 'list.ts');
    const source = readFileSync(file, 'utf8');
    expect(listSource(readLists(source))).toBe(source);
  });

  it('says what it did in counts only, never a word', () => {
    const files: Record<string, string> = {
      'words.csv': 'English,Zqvorn\nEnglish,Vexmor quill\nKlingon,Flimbat\n',
      'list.ts': listSource(EMPTY),
    };
    const io = {
      read: (path: string) => files[path] ?? '',
      write: (path: string, text: string) => {
        files[path] = text;
      },
    };
    const said = [
      ...runHash(['add', 'words.csv'], io, 'list.ts'),
      ...runHash(['remove', 'words.csv'], io, 'list.ts'),
      ...runHash(['what'], io, 'list.ts'),
    ];
    expect(said.join('\n')).toBe(
      [
        'Added 2 words (0 were on the list already). Line 3 could not be read.',
        'Removed 2 words (0 were not on the list). Line 3 could not be read.',
        'Use: node scripts/caption-clean-hash.mjs add|remove <words.csv> (a language and a word a line).',
      ].join('\n'),
    );
    expect(readLists(files['list.ts'] ?? '')).toEqual(EMPTY);
  });
});
