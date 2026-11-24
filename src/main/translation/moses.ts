// English punctuation normaliser, tokeniser and detokeniser: a port of sacremoses 0.2.0 (MIT; itself a port of
// the Moses scripts) exactly as IndicTransToolkit 1.1.1 uses them: MosesPunctNormalizer() with its defaults,
// MosesTokenizer(lang="en").tokenize(text, escape=False) and MosesDetokenizer(lang="en").detokenize(tokens).
// Character classes are Python's (python-classes.ts), not JavaScript's.
// Third-party notice: sacremoses, Copyright (c) 2020 alvations, MIT licence: LICENSES/translation/sacremoses-LICENSE.txt.
import { EN_NONBREAKING_PREFIXES, EN_NUMERIC_ONLY_PREFIXES } from './python-classes';
import { cls, inClass, pySplit, pyStrip } from './python-text';

type Rule = [RegExp, string];
const g = (source: string): RegExp => new RegExp(source, 'gu');

let normalizeRules: Rule[] | null = null;
function punctRules(): Rule[] {
  const d = cls('re_d');
  // MosesPunctNormalizer(lang="en", penn=True, norm_quote_commas=True, norm_numbers=True): its substitutions in order.
  return [
    [g('\\r'), ''],
    [g('\\('), ' ('],
    [g('\\)'), ') '],
    [g(' +'), ' '],
    [g('\\) ([.!:?;,])'), ')$1'],
    [g('\\( '), '('],
    [g(' \\)'), ')'],
    [g(`([${d}]) %`), '$1%'],
    [g(' :'), ':'],
    [g(' ;'), ';'],
    [g('`'), "'"],
    [g("''"), ' " '],
    [g('\u201e'), '"'],
    [g('\u201c'), '"'],
    [g('\u201d'), '"'],
    [g('\u2013'), '-'],
    [g('\u2014'), ' - '],
    [g(' +'), ' '],
    [g('\u00b4'), "'"],
    [g('([a-zA-Z])\u2018([a-zA-Z])'), "$1'$2"],
    [g('([a-zA-Z])\u2019([a-zA-Z])'), "$1'$2"],
    [g('\u2018'), "'"],
    [g('\u201a'), "'"],
    [g('\u2019'), "'"],
    [g("''"), '"'],
    [g('\u00b4\u00b4'), '"'],
    [g('\u2026'), '...'],
    [g('\u00a0\u00ab\u00a0'), '"'],
    [g('\u00ab\u00a0'), '"'],
    [g('\u00ab'), '"'],
    [g('\u00a0\u00bb\u00a0'), '"'],
    [g('\u00a0\u00bb'), '"'],
    [g('\u00bb'), '"'],
    [g('\u00a0%'), '%'],
    [g('n\u00ba\u00a0'), 'n\u00ba '],
    [g('\u00a0:'), ':'],
    [g('\u00a0\u00baC'), ' \u00baC'],
    [g('\u00a0cm'), ' cm'],
    [g('\u00a0\\?'), '?'],
    [g('\u00a0!'), '!'],
    [g('\u00a0;'), ';'],
    [g(',\u00a0'), ', '],
    [g(' +'), ' '],
    [g('"([,.]+)'), '$1"'],
    [g(`([${d}])\u00a0([${d}])`), '$1.$2'],
  ];
}

/** MosesPunctNormalizer().normalize(text). */
export function mosesNormalize(text: string): string {
  normalizeRules ??= punctRules();
  for (const [pattern, replacement] of normalizeRules) text = text.replace(pattern, replacement);
  return pyStrip(text);
}

interface TokenizerRules {
  dedupeSpace: RegExp;
  asciiJunk: RegExp;
  padNotAlnum: RegExp;
  multidot: RegExp;
  multidotMarker: RegExp;
  comma: Rule[];
  apostrophes: Rule[];
  trailingDotApostrophe: RegExp;
  endsWithPeriod: RegExp;
  startsWithDigits: RegExp;
  alpha: RegExp;
  lower: RegExp;
}
let tokenizerRules: TokenizerRules | null = null;
function tokenizer(): TokenizerRules {
  const s = cls('re_s');
  const alnum = cls('IsAlnumTok');
  const alpha = cls('IsAlphaTok');
  const n = cls('IsN');
  return {
    dedupeSpace: g(`[${s}]+`),
    asciiJunk: g('[\\u0000-\\u001f]'),
    padNotAlnum: g(`([^${alnum}${s}.'\`,\\-])`),
    multidot: g('\\.{2,}'),
    multidotMarker: g('(?:DOT)+MULTI'),
    comma: [
      [g(`([^${n}])[,]`), '$1 , '],
      [g(`[,]([^${n}])`), ' , $1'],
      [g(`([${n}])[,]$`), '$1 , '],
    ],
    apostrophes: [
      [g(`([^${alpha}])[']([^${alpha}])`), "$1 ' $2"],
      [g(`([^${alpha}${n}])[']([${alpha}])`), "$1 ' $2"],
      [g(`([${alpha}])[']([^${alpha}])`), "$1 ' $2"],
      [g(`([${alpha}])[']([${alpha}])`), "$1 '$2"],
      [g(`([${n}])[']([s])`), "$1 '$2"],
    ],
    trailingDotApostrophe: g(`\\.' ?$`),
    endsWithPeriod: new RegExp(`^([^${s}]+)\\.$`, 'u'),
    startsWithDigits: /^[0-9]+/u,
    alpha: new RegExp(`[${alpha}]`, 'u'),
    lower: new RegExp(`^[${cls('IsLower')}]+$`, 'u'),
  };
}

function handlesNonbreakingPrefixes(text: string, rules: TokenizerRules): string {
  const tokens = pySplit(text);
  const count = tokens.length;
  tokens.forEach((token, i) => {
    const m = rules.endsWithPeriod.exec(token);
    if (!m) return;
    const prefix = m[1] ?? '';
    const next = i !== count - 1 ? tokens[i + 1] : undefined;
    if (
      (prefix.includes('.') && rules.alpha.test(prefix)) ||
      (EN_NONBREAKING_PREFIXES.includes(prefix) && !EN_NUMERIC_ONLY_PREFIXES.includes(prefix)) ||
      (next !== undefined && next !== '' && rules.lower.test(Array.from(next)[0] ?? ''))
    ) {
      // no change
    } else if (
      EN_NUMERIC_ONLY_PREFIXES.includes(prefix) &&
      i + 1 < count &&
      rules.startsWithDigits.test(tokens[i + 1] ?? '')
    ) {
      // no change
    } else {
      tokens[i] = `${prefix} .`;
    }
  });
  return tokens.join(' ');
}

/** MosesTokenizer(lang="en").tokenize(text, escape=False): the tokens. */
export function mosesTokenize(text: string): string[] {
  const r = (tokenizerRules ??= tokenizer());
  text = text.replace(r.dedupeSpace, ' ').replace(r.asciiJunk, '');
  text = pyStrip(text);
  text = text.replace(r.padNotAlnum, ' $1 ');
  // replace_multidots: the closure compares with the length of the text as it was before this substitution.
  const before = text;
  text = text.replace(r.multidot, (match: string, offset: number) => {
    const marker = ` ${'DOT'.repeat(match.length)}MULTI`;
    return offset + match.length < before.length ? `${marker} ` : marker;
  });
  for (const [pattern, replacement] of r.comma) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of r.apostrophes) text = text.replace(pattern, replacement);
  text = handlesNonbreakingPrefixes(text, r);
  text = pyStrip(text.replace(r.dedupeSpace, ' '));
  text = text.replace(r.trailingDotApostrophe, " . ' ");
  text = text.replace(r.multidotMarker, (match: string) => '.'.repeat(Math.floor((match.length - 5) / 3)));
  return pySplit(text);
}

interface DetokenizerRules {
  hyphen: RegExp;
  unescape: Rule[];
  currency: RegExp;
  punct: RegExp;
  contraction: RegExp;
  openQuote: RegExp;
  curlyQuotes: RegExp;
  endsWithS: RegExp;
  oneSpace: RegExp;
}
let detokenizerRules: DetokenizerRules | null = null;
function detokenizer(): DetokenizerRules {
  return {
    hyphen: g(' @-@ '),
    unescape: [
      [g('&bar;'), '|'],
      [g('&#124;'), '|'],
      [g('&lt;'), '<'],
      [g('&gt;'), '>'],
      [g('&bra;'), '['],
      [g('&ket;'), ']'],
      [g('&quot;'), '"'],
      // The XML entity for an apostrophe, spelt with an escape so the word rules (strings.test.ts) read it as code.
      [g('&\u0061pos;'), "'"],
      [g('&#91;'), '['],
      [g('&#93;'), ']'],
      [g('&amp;'), '&'],
    ],
    currency: new RegExp(`^[${cls('IsSc')}\\(\\[\\{\u00bf\u00a1]+$`, 'u'),
    punct: /^[,.?!:;\\%}\])]+$/u,
    contraction: new RegExp(`^['][${cls('IsAlpha')}]`, 'u'),
    openQuote: /^['"\u201e\u201c`]+$/u,
    curlyQuotes: /^[\u201e\u201c\u201d]+$/u,
    endsWithS: /[s]$/u,
    oneSpace: / {2,}/gu,
  };
}

const isCjk = (char: string): boolean => {
  const cp = char.codePointAt(0) ?? 0;
  return inClass('cjk', String.fromCodePoint(cp));
};

/** MosesDetokenizer(lang="en").detokenize(tokens). */
export function mosesDetokenize(tokensIn: string[]): string {
  const r = (detokenizerRules ??= detokenizer());
  let text = ` ${tokensIn.join(' ')} `;
  text = text.replace(r.hyphen, '-');
  for (const [pattern, replacement] of r.unescape) text = text.replace(pattern, replacement);
  const quoteCounts = new Map<string, number>([
    ["'", 0],
    ['"', 0],
    ['``', 0],
    ['`', 0],
    ["''", 0],
  ]);
  let prepend = ' ';
  let out = '';
  const tokens = pySplit(text);
  tokens.forEach((token, i) => {
    const first = Array.from(token)[0] ?? '';
    if (isCjk(first)) {
      const prev = i > 0 ? Array.from(tokens[i - 1] ?? '').at(-1) : undefined;
      if (i > 0 && prev !== undefined && isCjk(prev)) out += token;
      else out += prepend + token;
      prepend = ' ';
    } else if (r.currency.test(token)) {
      out += prepend + token;
      prepend = '';
    } else if (r.punct.test(token)) {
      out += token;
      prepend = ' ';
    } else if (i > 0 && r.contraction.test(token)) {
      out += token;
      prepend = ' ';
    } else if (r.openQuote.test(token)) {
      const normalized = r.curlyQuotes.test(token) ? '"' : token;
      const count = quoteCounts.get(normalized) ?? 0;
      quoteCounts.set(normalized, count);
      if (count % 2 === 0) {
        if (token === "'" && i > 0 && r.endsWithS.test(tokens[i - 1] ?? '')) {
          out += token;
          prepend = ' ';
        } else {
          out += prepend + token;
          prepend = '';
          quoteCounts.set(normalized, count + 1);
        }
      } else {
        out += token;
        prepend = ' ';
        quoteCounts.set(normalized, count + 1);
      }
    } else {
      out += prepend + token;
      prepend = ' ';
    }
  });
  return pyStrip(out.replace(r.oneSpace, ' '));
}
