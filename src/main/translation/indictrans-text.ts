// IndicTrans2's text pipeline around the model, ported exactly from what x74's trial measured and a reader graded:
// IndicTransToolkit 1.1.1's IndicProcessor (MIT) with the ORIGINAL indic-nlp-library 0.92 (MIT) normaliser,
// tokeniser, detokeniser and script converter; the models' IndicTransTokenizer decode (MIT) with Hugging Face's
// clean-up (Apache-2.0); and the trial's narrow clock-spacing repair. Only Gujarati, Hindi and English.
// The model itself (SentencePiece + CTranslate2) runs in drashti-translate; see translation-helper.ts.
// Third-party notices (texts in LICENSES/translation/): IndicTransToolkit, Copyright (c) Varun Gumma, MIT
// (IndicTransToolkit-LICENSE.txt); indic-nlp-library, Copyright (c) 2013-present Anoop Kunchukuttan, MIT
// (indic-nlp-library-LICENSE.txt); the IndicTrans2 tokenizer's decode, AI4Bharat, MIT; Hugging Face Transformers'
// clean_up_tokenization, Copyright The Hugging Face team, Apache-2.0 (the text in sentencepiece-LICENSE.txt).
import { mosesDetokenize, mosesNormalize, mosesTokenize } from './moses';
import { cls, pyLen, pyStrip } from './python-text';

export type FloresTag = 'eng_Latn' | 'guj_Gujr' | 'hin_Deva';
export type Iso = 'en' | 'gu' | 'hi';
export const ISO_OF: Record<FloresTag, Iso> = { eng_Latn: 'en', guj_Gujr: 'gu', hin_Deva: 'hi' };
export const TAG_OF: Record<Iso, FloresTag> = { en: 'eng_Latn', gu: 'guj_Gujr', hi: 'hin_Deva' };
export type Route = 'en-indic' | 'indic-en' | 'indic-indic';
export const routeFor = (from: Iso, to: Iso): Route =>
  from === 'en' ? 'en-indic' : to === 'en' ? 'indic-en' : 'indic-indic';

const g = (source: string): RegExp => new RegExp(source, 'gu');

// ---------------------------------------------------------------- indic-nlp-library 0.92

const SCRIPT_START: Record<'gu' | 'hi', number> = { gu: 0x0a80, hi: 0x0900 };

/** UnicodeIndicTransliterator.transliterate(text, from, to) for Gujarati and Devanagari. */
export function transliterate(text: string, from: 'gu' | 'hi', to: 'gu' | 'hi'): string {
  let out = '';
  for (const c of text) {
    const offset = (c.codePointAt(0) ?? 0) - SCRIPT_START[from];
    out +=
      offset >= 0 && offset <= 0x6f && c !== '\u0964' && c !== '\u0965'
        ? String.fromCodePoint(SCRIPT_START[to] + offset)
        : c;
  }
  return out;
}

function baseNormalize(text: string): string {
  // BaseNormalizer.normalize with remove_nuktas=False, nasals_mode='do_nothing', no chandras, no vowel endings.
  text = text
    .replaceAll('\ufeff', '')
    .replaceAll('\ufffe', '')
    .replaceAll('\u2060', '')
    .replaceAll('\u00ad', '')
    .replaceAll('\u200b', ' ')
    .replaceAll('\u00a0', ' ')
    .replaceAll('\u200c', '')
    .replaceAll('\u200d', '');
  // NormalizerI._normalize_punctuations
  return text
    .replaceAll('\ufeff', '')
    .replaceAll('\u201e', '"')
    .replaceAll('\u201c', '"')
    .replaceAll('\u201d', '"')
    .replaceAll('\u2013', '-')
    .replaceAll('\u2014', ' - ')
    .replaceAll('\u00b4', "'")
    .replaceAll('\u2018', "'")
    .replaceAll('\u201a', "'")
    .replaceAll('\u2019', "'")
    .replaceAll("''", '"')
    .replaceAll('\u00b4\u00b4', '"')
    .replaceAll('\u2026', '...');
}

/** IndicNormalizerFactory().get_normalizer(lang).normalize(text) for Hindi (Devanagari) and Gujarati. */
export function indicNormalize(text: string, lang: 'gu' | 'hi'): string {
  text = baseNormalize(text);
  if (lang === 'hi') {
    const nukta = '\u093c';
    text = text
      .replaceAll('\u0972', '\u090f')
      .replaceAll('\u0929', `\u0928${nukta}`)
      .replaceAll('\u0931', `\u0930${nukta}`)
      .replaceAll('\u0934', `\u0933${nukta}`)
      .replaceAll('\u0958', `\u0915${nukta}`)
      .replaceAll('\u0959', `\u0916${nukta}`)
      .replaceAll('\u095a', `\u0917${nukta}`)
      .replaceAll('\u095b', `\u091c${nukta}`)
      .replaceAll('\u095c', `\u0921${nukta}`)
      .replaceAll('\u095d', `\u0922${nukta}`)
      .replaceAll('\u095e', `\u092b${nukta}`)
      .replaceAll('\u095f', `\u092f${nukta}`)
      .replaceAll('|', '\u0964');
    return text.replace(/([\u0900-\u097f]):/gu, '$1\u0903');
  }
  text = text.replaceAll('\u0ae4', '\u0964').replaceAll('\u0ae5', '\u0965');
  return text.replace(/([\u0a80-\u0aff]):/gu, '$1\u0a83');
}

// Python's string.punctuation as indic_tokenize's character class reads it: its backslash escapes the "]" after
// it, so a backslash itself never splits a word. Plus the Indic marks it lists.
const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~';
const escapeClass = (chars: string): string =>
  Array.from(chars)
    .map((c) => `\\u{${c.codePointAt(0)?.toString(16)}}`)
    .join('');
const TOKENIZE_INDIC = g(
  `([${escapeClass(PUNCTUATION)}\\u0964\\u0965\\uaaf1\\uaaf0\\uabeb\\uabec\\uabed\\uabee\\uabef\\u1c7e\\u1c7f])`,
);
const NUM_SEQ = /([0-9]+ [,.:/] )+[0-9]+/gu;

/** indic_tokenize / indic_detokenize's number-sequence pass, including its skip of a match at the start. */
function joinNumberSequences(s: string): string {
  let out = '';
  let prev = 0;
  for (const m of s.matchAll(NUM_SEQ)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > prev) {
      out += s.slice(prev, start) + s.slice(start, end).replaceAll(' ', '');
      prev = end;
    }
  }
  return out + s.slice(prev);
}

/** indic_tokenize.trivial_tokenize(text, lang) for Gujarati and Hindi. */
export function trivialTokenize(text: string): string[] {
  const tokenized = text.replaceAll('\t', ' ').replace(TOKENIZE_INDIC, ' $1 ');
  const s = tokenized.replace(/[ ]+/gu, ' ').replace(/^ +| +$/gu, '');
  return joinNumberSequences(s).split(' ');
}

const LEFT_ATTACH = g('[ ]([!%)\\]},.:;>?\\u0964\\u0965])');
const RIGHT_ATTACH = g('([#$(\\[{<@])[ ]');
const BOTH_ATTACH = g('[ ]([\\-/\\\\])[ ]');

/** indic_detokenize.trivial_detokenize(text, lang). */
export function trivialDetokenize(text: string): string {
  let s = joinNumberSequences(text);
  s = s.replace(BOTH_ATTACH, '$1').replace(LEFT_ATTACH, '$1').replace(RIGHT_ATTACH, '$1');
  for (const punc of ["'", '"', '`']) {
    let count = 0;
    let marked = '';
    for (const c of s) {
      if (c === punc) {
        marked += count % 2 === 0 ? '@RA' : '@LA';
        count += 1;
      } else {
        marked += c;
      }
    }
    s = marked
      .replaceAll('@RA ', punc)
      .replaceAll(' @LA', punc)
      .replaceAll('@RA', punc)
      .replaceAll('@LA', punc);
  }
  return s;
}

// ---------------------------------------------------------------- IndicTransToolkit 1.1.1 IndicProcessor

const PROCESSOR_DIGITS = new Map<string, string>();
for (const zero of [0x09e6, 0x0ae6, 0x0ce6, 0x0966, 0x0660, 0xabf0, 0x0b66, 0x0a66, 0x1c50, 0x06f0])
  PROCESSOR_DIGITS.set(String.fromCodePoint(zero), '0');
for (let d = 1; d <= 9; d++)
  for (const zero of [0x09e6, 0x0ae6, 0x0966, 0x0ce6, 0x06f0, 0xabf0, 0x0b66, 0x0a66, 0x1c50, 0x0c66])
    PROCESSOR_DIGITS.set(String.fromCodePoint(zero + d), String(d));

const INDIC_FAILURE_CASES = [
  '\u0622\u06cc \u0688\u06cc ',
  '\uabd1\uabe5\uabcf\uabd7\uabe4',
  '\u0906\u0908\u0921\u0940',
  '\u0906\u0908 . \u0921\u0940 . ',
  '\u0906\u0908 . \u0921\u0940 .',
  '\u0906\u0908. \u0921\u0940. ',
  '\u0906\u0908. \u0921\u0940.',
  '\u0906\u092f. \u0921\u0940. ',
  '\u0906\u092f. \u0921\u0940.',
  '\u0906\u092f . \u0921\u0940 . ',
  // The toolkit's list misses a comma here, so these two entries are one string.
  '\u0906\u092f . \u0921\u0940 .\u0906\u0907 . \u0921\u0940 . ',
  '\u0906\u0907 . \u0921\u0940 .',
  '\u0906\u0907. \u0921\u0940. ',
  '\u0906\u0907. \u0921\u0940.',
  '\u0910\u091f\u093f',
  '\u0622\u0626\u06cc \u0688\u06cc ',
  '\u1c5f\u1c6d\u1c70\u1c64 \u1c7e',
  '\u0906\u092f\u0921\u0940',
  '\u0910\u0921\u093f',
  '\u0906\u0907\u0921\u093f',
  '\u1c5f\u1c6d\u1c70\u1c64',
];

interface ProcessorRules {
  punc: [RegExp, string | ((m: string) => string)][];
  multispace: RegExp;
  endBracket: RegExp;
  digitSpacePercent: RegExp;
  doubleQuotePunc: RegExp;
  digitNbspDigit: RegExp;
  email: RegExp;
  url: RegExp;
  numeral: RegExp;
  other: RegExp;
  spaces: RegExp;
}
let processorRules: ProcessorRules | null = null;
function processor(): ProcessorRules {
  // The processor uses the regex module: its \s, \d and \w (and \b from its \w).
  const s = cls('regex_s');
  const d = cls('regex_d');
  const w = cls('regex_w');
  const b = `(?:(?<=[${w}])(?![${w}])|(?<![${w}])(?=[${w}]))`;
  return {
    punc: [
      [g('\\r'), ''],
      [g(`\\([${s}]*`), '('],
      [g(`[${s}]*\\)`), ')'],
      [g(`[${s}]:[${s}]?`), ':'],
      [g(`[${s}];[${s}]?`), ';'],
      [g('[`\u00b4\u2018\u201a\u2019]'), "'"],
      [g('[\u201e\u201c\u201d\u00ab\u00bb]'), '"'],
      [g('[\u2013\u2014]'), '-'],
      [g('\\.\\.\\.'), '...'],
      [g('\u00a0%'), '%'],
      [g('n\u00ba\u00a0'), 'n\u00ba '],
      [g('\u00a0\u00baC'), ' \u00baC'],
      [g('\u00a0[?!;]'), (m: string) => pyStrip(m)],
      [g(',\u00a0'), ', '],
    ],
    multispace: g('[ ]{2,}'),
    endBracket: g('\\) ([.!:?;,])'),
    digitSpacePercent: g(`([${d}]) %`),
    doubleQuotePunc: g('"([,.]+)'),
    digitNbspDigit: g(`([${d}])\u00a0([${d}])`),
    email: g('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}'),
    // (?:[...]+)+ is written [...]+ : the same matches, without the nested quantifier's runaway backtracking.
    url: g(
      `${b}(?<![${w}/.])(?:(?:https?|ftp)://)?(?:(?:[${w}-]+\\.)+(?!\\.))(?:[${w}/\\-?#&=%.]+)(?!\\.[${w}]+)${b}`,
    ),
    numeral: g(
      `(~?[${d}]+\\.?[${d}]*[${s}]?%?[${s}]?-?[${s}]?~?[${d}]+\\.?[${d}]*[${s}]?%|~?[${d}]+%|[${d}]+[-/.,:'][${d}]+[-/.,:'+][${d}]+(?:\\.[${d}]+)?|[${d}]+[-/.:'+][${d}]+(?:\\.[${d}]+)?)`,
    ),
    other: g(`[A-Za-z0-9]*[#|@][${w}]+`),
    spaces: g(`[${s}]+`),
  };
}

function puncNorm(text: string, r: ProcessorRules): string {
  for (const [pattern, replacement] of r.punc)
    text =
      typeof replacement === 'string'
        ? text.replace(pattern, replacement)
        : text.replace(pattern, replacement);
  text = text.replace(r.multispace, ' ');
  text = text.replace(r.endBracket, ')$1');
  text = text.replace(r.digitSpacePercent, '$1%');
  text = text.replace(r.doubleQuotePunc, '$1"');
  text = text.replace(r.digitNbspDigit, '$1.$2');
  return pyStrip(text);
}

/** Placeholders taken out of a sentence before translation, restored after it (the processor's entity map). */
export type PlaceholderMap = Map<string, string>;

/**
 * The order the processor numbers one pattern's matches in. Python iterates a set (its order follows the hash
 * seed); Drashti numbers them longest first, ties in the order they first appear, which is one of Python's orders and
 * the one where no placeholder cuts another ("example.org" inside "example.org/give", "1/12/2026" inside
 * "11/12/2026"). Tests pass Python's recorded order instead.
 */
export type PlaceholderOrder = (patternIndex: number, matches: string[]) => string[];
const longestFirst: PlaceholderOrder = (_i, matches) =>
  [...new Set(matches)]
    .map((match, at) => ({ match, at, length: pyLen(match) }))
    .sort((a, b) => b.length - a.length || a.at - b.at)
    .map(({ match }) => match);

function wrapWithPlaceholders(
  text: string,
  r: ProcessorRules,
  order: PlaceholderOrder,
): { text: string; map: PlaceholderMap } {
  const map: PlaceholderMap = new Map();
  let serial = 1;
  [r.email, r.url, r.numeral, r.other].forEach((pattern, index) => {
    const found = [...text.matchAll(pattern)].map((m) => m[0]);
    for (const match of order(index, found)) {
      if (pattern === r.url && pyLen(match.replaceAll('.', '')) < 4) continue;
      if (
        pattern === r.numeral &&
        pyLen(match.replaceAll(' ', '').replaceAll('.', '').replaceAll(':', '')) < 4
      )
        continue;
      const n = serial;
      for (const key of [
        `<ID${n}>`,
        `< ID${n} >`,
        `[ID${n}]`,
        `[ ID${n} ]`,
        `[ID ${n}]`,
        `<ID${n}]`,
        `< ID${n}]`,
        `<ID${n} ]`,
        `<id${n}>`,
        `< id${n} >`,
        `[id${n}]`,
        `[ id${n} ]`,
        `[id ${n}]`,
        `<id${n}]`,
        `< id${n}]`,
        `<id${n} ]`,
      ])
        map.set(key, match);
      for (const c of INDIC_FAILURE_CASES)
        for (const key of [
          `<${c}${n}>`,
          `< ${c}${n} >`,
          `< ${c} ${n} >`,
          `<${c} ${n}]`,
          `< ${c} ${n} ]`,
          `[${c}${n}]`,
          `[${c} ${n}]`,
          `[ ${c}${n} ]`,
          `[ ${c} ${n} ]`,
          `${c} ${n}`,
          `${c}${n}`,
        ])
          map.set(key, match);
      text = text.replaceAll(match, `<ID${n}>`);
      serial += 1;
    }
  });
  text = text.replace(r.spaces, ' ').replaceAll('>/', '>').replaceAll(']/', ']');
  return { text, map };
}

export interface Prepared {
  /** The model's input after the two language tags (IndicTransTokenizer takes "<src> <tgt> <text>"). */
  text: string;
  placeholders: PlaceholderMap;
}

/** IndicProcessor(inference=True).preprocess_batch([sentence], src_lang, tgt_lang)[0], without the tags. */
export function preprocess(sentence: string, from: Iso, order: PlaceholderOrder = longestFirst): Prepared {
  const r = (processorRules ??= processor());
  sentence = puncNorm(sentence, r);
  sentence = Array.from(sentence, (c) => PROCESSOR_DIGITS.get(c) ?? c).join('');
  const wrapped = wrapWithPlaceholders(sentence, r, order);
  let processed: string;
  if (from === 'en') {
    processed = mosesTokenize(mosesNormalize(pyStrip(wrapped.text))).join(' ');
  } else {
    const joined = trivialTokenize(indicNormalize(pyStrip(wrapped.text), from)).join(' ');
    processed = transliterate(joined, from, 'hi').replaceAll(' \u094d ', '\u094d');
  }
  return { text: pyStrip(processed), placeholders: wrapped.map };
}

/** IndicProcessor.postprocess_batch([sentence], lang)[0] with the sentence's own placeholder map. */
export function postprocess(sentence: string, to: Iso, placeholders: PlaceholderMap): string {
  for (const [key, value] of placeholders) sentence = sentence.replaceAll(key, value);
  if (to === 'en') return mosesDetokenize(sentence.split(' '));
  return trivialDetokenize(transliterate(sentence, 'hi', to));
}

const SPECIAL_TOKENS = new Set(['<s>', '</s>', '<unk>', '<pad>']);

/**
 * IndicTransTokenizer.batch_decode([ids], skip_special_tokens=True, clean_up_tokenization_spaces=True)[0], from the
 * output tokens the helper returns.
 */
export function decodeTokens(tokens: readonly string[]): string {
  const kept = tokens.filter((t) => !SPECIAL_TOKENS.has(t));
  if (kept.length === 0) return '';
  const text = pyStrip(kept.join('').replaceAll('\u2581', ' '));
  return text
    .replaceAll(' .', '.')
    .replaceAll(' ?', '?')
    .replaceAll(' !', '!')
    .replaceAll(' ,', ',')
    .replaceAll(" ' ", "'")
    .replaceAll(' n\u0027t', 'n\u0027t')
    .replaceAll(" 'm", "'m")
    .replaceAll(" 's", "'s")
    .replaceAll(" 've", "'ve")
    .replaceAll(" 're", "'re");
}

/**
 * Whether prepared text holds one of the model's special tokens, which the tokenizer would read as the token itself.
 * Only a backstop: both tokenisers split "<", "/" and ">" apart, so text that names one ("Use <s> tags") never does,
 * and is translated as Python translates it.
 */
export const holdsSpecialToken = (text: string): boolean => [...SPECIAL_TOKENS].some((t) => text.includes(t));

let sourceClock: RegExp | null = null;
/** x74's clock_spacing.restore_source_clock_spacing: only the same valid clock time the source holds. */
export function restoreSourceClockSpacing(source: string, translated: string): string {
  const d = cls('re_d');
  const s = cls('re_s');
  sourceClock ??= g(`(?<![${d}])((?:[01]?[${d}]|2[0-3])):([0-5][${d}])(?![${d}])`);
  for (const m of source.matchAll(sourceClock)) {
    const [whole, hour = '', minute = ''] = m;
    const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = g(`(?<![${d}])${escape(hour)}[${s}]*:[${s}]*${escape(minute)}(?![${d}])`);
    translated = translated.replace(pattern, () => whole);
  }
  return translated;
}
