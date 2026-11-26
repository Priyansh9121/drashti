import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SpeechLanguage } from '../../../shared/speech';
import { CaptionWordText } from './CaptionWordsDialog';

/*
 * The Caption Words dialog's entry (alpha.24, review F2 and lead 2): an entry under Gujarati, Hindi or Sanskrit typed
 * in letters that are not that language's says so beside it, as it is kept (the owner: "Leave it out": captions with
 * a language chosen keep to its letters, so such an entry never shows). Invented placeholder words only.
 */

const GU = 'ઝેન્ટ્રોવા';
const HI = 'वेल्मोरिन';
const render = (language: SpeechLanguage, word: string): string =>
  renderToStaticMarkup(createElement(CaptionWordText, { word: { language, word } }));

describe('a caption word in the dialog', () => {
  it('says when it is typed in other letters than its language’s, for Gujarati, Hindi and Sanskrit, and keeps it as typed', () => {
    const english = render('gu', 'Zentrova');
    expect(english).toContain('Zentrova');
    expect(english).toContain(
      'Typed in English letters: it won’t show in Gujarati captions while Gujarati is chosen.',
    );
    expect(render('gu', HI)).toContain(
      'Typed in Devanagari letters: it won’t show in Gujarati captions while Gujarati is chosen.',
    );
    expect(render('hi', GU)).toContain(
      'Typed in Gujarati letters: it won’t show in Hindi captions while Hindi is chosen.',
    );
    expect(render('hi', 'Person Q7')).toContain(
      'Typed in English letters: it won’t show in Hindi captions while Hindi is chosen.',
    );
    expect(render('sa', 'Zentrova')).toContain(
      'Typed in English letters: it won’t show in Sanskrit captions while Sanskrit is chosen.',
    );
  });

  it('says nothing for an entry in its language’s letters: Sanskrit in either script, digits in any, English as it is', () => {
    for (const [language, word] of [
      ['gu', GU],
      ['gu', '108'],
      ['hi', HI],
      ['sa', 'વેલ્મોરિન'],
      ['sa', HI],
      ['en', 'Zentrova'],
    ] as const) {
      const html = render(language, word);
      expect(html).toContain(word);
      expect(html).not.toContain('Typed in');
    }
  });
});
