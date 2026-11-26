// Drashti's own list of words left out of captions (alpha.24, QA24-CAPCLEAN-1; lead 2's QA24-CAPCLEAN-1a A): the
// public repo holds each word only as a hash, in src/shared/caption-clean/list.ts. This script adds words to it or
// takes them off, hashing each exactly as the captions look a word up (src/shared/caption-clean/key.ts, run here as
// it is), and says what it did in counts only, never a word.
//
//   node scripts/caption-clean-hash.mjs add <words.csv>
//   node scripts/caption-clean-hash.mjs remove <words.csv>
//
// The words file: a language (Gujarati, Hindi, Sanskrit or English, or gu, hi, sa, en), a comma and the word, a
// line each (Caption Words' file). Keep it OUTSIDE the repo: the words never go into Git, a commit message, a test or
// a report. Node 22.18 or later (it runs key.ts as TypeScript).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTION_CLEAN_HASH_PREFIX, cleanPhraseKey } from '../src/shared/caption-clean/key.ts';

const LANGUAGES = ['gu', 'hi', 'sa', 'en'];
const NAMES = { gujarati: 'gu', hindi: 'hi', sanskrit: 'sa', english: 'en' };
const LIST_NAMES = { gu: 'GU', hi: 'HI', sa: 'SA', en: 'EN' };

const COMMENT = `/*
 * Drashti’s own list of words left out of captions (alpha.24, QA24-CAPCLEAN-1): common, clearly offensive words in
 * Gujarati, Hindi and English (with their common Latin spellings), each kept ONLY as SHA-256 of Drashti’s prefix and
 * its key (shared/caption-clean/key.ts), never as a word. Sanskrit has none of its own: every caption is checked
 * against every language’s words. Written by scripts/caption-clean-hash.mjs (add or remove), never by hand.
 */
`;

/** SHA-256 of Drashti's prefix and the word's key, as the captions look it up. */
export function hashWord(word) {
  return createHash('sha256')
    .update(`${CAPTION_CLEAN_HASH_PREFIX}${cleanPhraseKey(word)}`, 'utf8')
    .digest('hex');
}

/** A words file: a language and a word a line; the lines it cannot read by number only. */
export function readWords(text) {
  const words = [];
  const problems = [];
  text
    .replace(/^\uFEFF/u, '')
    .split(/\r\n|\n|\r/u)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const comma = line.indexOf(',');
      const name = (comma < 0 ? line : line.slice(0, comma)).trim().toLowerCase();
      const word = comma < 0 ? '' : line.slice(comma + 1).trim();
      if (name === 'language' && word.toLowerCase() === 'word') return;
      const language = LANGUAGES.includes(name) ? name : NAMES[name];
      if (!language || cleanPhraseKey(word) === '') problems.push(i + 1);
      else words.push({ language, word: word.normalize('NFC') });
    });
  return { words, problems };
}

/** The list file for these lists, as prettier keeps it: each language's hashes sorted, once each. */
export function listSource(lists) {
  const blocks = LANGUAGES.map((language) => {
    const hashes = [...new Set(lists[language])].sort();
    const name = `CAPTION_CLEAN_${LIST_NAMES[language]}`;
    if (hashes.length === 0) return `export const ${name}: readonly string[] = [];\n`;
    return `export const ${name}: readonly string[] = [\n${hashes.map((h) => `  '${h}',\n`).join('')}];\n`;
  });
  return `${COMMENT}\n${blocks.join('')}`;
}

/** The lists in a list file. */
export function readLists(source) {
  const lists = { gu: [], hi: [], sa: [], en: [] };
  for (const language of LANGUAGES) {
    const found = new RegExp(
      `CAPTION_CLEAN_${LIST_NAMES[language]}: readonly string\\[\\] = \\[([^\\]]*)\\]`,
      'u',
    ).exec(source);
    if (!found) throw new Error(`The list file has no ${language} list.`);
    lists[language] = [...(found[1] ?? '').matchAll(/'([0-9a-f]{64})'/gu)].map((m) => m[1]);
  }
  return lists;
}

/** The list file with these words' hashes added or taken off, and how many changed. */
export function updateList(source, words, mode) {
  const lists = readLists(source);
  let changed = 0;
  let unchanged = 0;
  for (const { language, word } of words) {
    const hash = hashWord(word);
    const has = lists[language].includes(hash);
    if (mode === 'add' ? has : !has) {
      unchanged += 1;
      continue;
    }
    lists[language] = mode === 'add' ? [...lists[language], hash] : lists[language].filter((h) => h !== hash);
    changed += 1;
  }
  return { source: listSource(lists), counts: { changed, unchanged } };
}

/** The command: what it says, counts only. */
export function runHash(args, io, listFile) {
  const [mode, file] = args;
  if ((mode !== 'add' && mode !== 'remove') || !file)
    return [
      'Use: node scripts/caption-clean-hash.mjs add|remove <words.csv> (a language and a word a line).',
    ];
  const read = readWords(io.read(file));
  const updated = updateList(io.read(listFile), read.words, mode);
  io.write(listFile, updated.source);
  const { changed, unchanged } = updated.counts;
  const what =
    mode === 'add'
      ? `Added ${String(changed)} ${changed === 1 ? 'word' : 'words'} (${String(unchanged)} ${unchanged === 1 ? 'was' : 'were'} on the list already).`
      : `Removed ${String(changed)} ${changed === 1 ? 'word' : 'words'} (${String(unchanged)} ${unchanged === 1 ? 'was' : 'were'} not on the list).`;
  const lines = read.problems.map(String);
  const unread =
    lines.length === 0
      ? ''
      : ` ${lines.length === 1 ? 'Line' : 'Lines'} ${lines.join(', ')} could not be read.`;
  return [`${what}${unread}`];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const listFile = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'shared',
    'caption-clean',
    'list.ts',
  );
  const said = runHash(
    process.argv.slice(2),
    { read: (path) => readFileSync(path, 'utf8'), write: (path, text) => writeFileSync(path, text, 'utf8') },
    listFile,
  );
  for (const line of said) console.log(line);
}
