import { describe, expect, it } from 'vitest';
import type { TextElement } from './model';
import { nfc, nfcDeep, nfcElement, sameText } from './nfc';

/* Text in one form, NFC (Sessions 31–36, I18N-6). Placeholder words only. */

const QA = '\u0958';
const KA_NUKTA = '\u0915\u093c';

const box = (text: string, runs?: TextElement['runs']): TextElement => ({
  id: 'b',
  kind: 'text',
  frame: { x: 0, y: 0, width: 100, height: 100 },
  text,
  lang: null,
  style: {
    fontFamily: null,
    fontSize: 72,
    fontWeight: 500,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.35,
    shadow: true,
  },
  ...(runs ? { runs } : {}),
});

describe('NFC', () => {
  it('stores क़ one way, typed as U+0958 or as U+0915 U+093C, and compares both ways alike', () => {
    expect(nfc(QA)).toBe(KA_NUKTA);
    expect(nfc(KA_NUKTA)).toBe(KA_NUKTA);
    expect(sameText(`नमूना ${QA}`, `नमूना ${KA_NUKTA}`)).toBe(true);
    expect(sameText('नमूना', 'नमूने')).toBe(false);
  });

  it('a box’s words and its runs’, but never words typed in a legacy font', () => {
    expect(nfcElement(box(`नमूना ${QA}`)).text).toBe(`नमूना ${KA_NUKTA}`);
    const legacy = 'Á';
    const mixed = nfcElement(
      box(`${QA}${legacy}`, [
        { text: QA, lang: 'hi' },
        { text: legacy, legacy: true, font: 'Placeholder Legacy' },
      ]),
    );
    expect(mixed.runs?.map((r) => r.text)).toEqual([KA_NUKTA, legacy]);
    expect(mixed.text).toBe(`${KA_NUKTA}${legacy}`);
  });

  it('every string in plain data, keys and all else as they are', () => {
    expect(nfcDeep({ words: { hi: QA }, attribution: '', count: 2, list: [QA, null] })).toEqual({
      words: { hi: KA_NUKTA },
      attribution: '',
      count: 2,
      list: [KA_NUKTA, null],
    });
  });
});
