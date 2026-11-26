import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CAPTION_TARGET_NAMES,
  type CaptionTarget,
  type CaptionTranslationStatus,
  type CaptionTranslationUnavailable,
} from '../../../shared/caption-translation';
import {
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_CAPTION_TIMING,
  type CaptionSettings,
  type CaptionsStatus,
} from '../../../shared/captions';
import type { SpeechLanguage } from '../../../shared/speech';
import { CaptionTargetField } from './CaptionTargetField';
import {
  captionTargetWhyNot,
  skippedText,
  TRANSLATION_TRIAL_WARNING,
  translationStatusLine,
  unavailableText,
} from './caption-target-words';
import { captionsStatusLine } from './captions-words';

/*
 * "Captions in" in File › Live Captions… (alpha.24, QA24-CAPLANG-2, the owner's 2a-2f, all A), drawn as the operator
 * window draws it: the four choices under Speaker's language, greyed out with the reason while this computer cannot
 * translate, the Trial warning once a translation is chosen, the phrases skipped and the engine's last fault. The
 * status bar's line while a chosen translation cannot be made. Placeholder words only.
 */

const ALL_REASONS: CaptionTranslationUnavailable[] = [
  'no-engine',
  'no-pack',
  'unknown-model',
  'speaker-as-heard',
  'speaker-sanskrit',
  'too-slow',
  'engine-fault',
];
/** Choosing "Captions in" again tries once more after these (lead 2's contract, df4a47045): they stay choosable. */
const RETRIED: CaptionTranslationUnavailable[] = ['too-slow', 'engine-fault'];
const GREYED = ALL_REASONS.filter((reason) => !RETRIED.includes(reason));

const view = (
  over: {
    language?: SpeechLanguage | 'auto';
    target?: CaptionTarget;
    translation?: Partial<CaptionTranslationStatus> | null;
  } & Partial<Omit<CaptionsStatus, 'translation'>> = {},
): CaptionsStatus => {
  const { language = 'gu', target = 'same', translation, ...rest } = over;
  const settings: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS, language, captionLanguage: target };
  return {
    on: true,
    model: 'small',
    settings,
    download: { phase: 'ready', done: 1, total: 1, message: null },
    speech: { phase: 'listening', language },
    engine: true,
    engineProblem: null,
    trial: true,
    languageModels: [],
    timing: DEFAULT_CAPTION_TIMING,
    processors: 8,
    stopped: null,
    ...(translation === null
      ? {}
      : {
          translation: {
            target: null,
            offered: true,
            unavailable: null,
            skipped: 0,
            fault: null,
            ...translation,
          },
        }),
    ...rest,
  };
};

const field = (v: CaptionsStatus) =>
  renderToStaticMarkup(createElement(CaptionTargetField, { view: v, save: () => undefined }));
/** The text a person reads. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&#x27;/gu, '’')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
/** The <select> element's own tag. */
const selectTag = (html: string) => /<select[^>]*>/u.exec(html)?.[0] ?? '';
/** Each <option>: its value, whether it is disabled, its name. */
const options = (html: string) =>
  [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/gu)].map((m) => ({
    value: /value="([^"]*)"/u.exec(m[1] ?? '')?.[1],
    disabled: /\sdisabled=""/u.test(m[1] ?? ''),
    name: m[2],
  }));

describe('"Captions in" in the Live captions dialog (alpha.24, QA24-CAPLANG-2)', () => {
  it('offers the four choices by their names, the speaker’s own words first and chosen, with a visible label tied to it', () => {
    const html = field(view());
    expect(options(html).map((o) => [o.value, o.name])).toEqual([
      ['same', CAPTION_TARGET_NAMES.same],
      ['gu', CAPTION_TARGET_NAMES.gu],
      ['hi', CAPTION_TARGET_NAMES.hi],
      ['en', CAPTION_TARGET_NAMES.en],
    ]);
    expect(options(html).map((o) => o.name)).toEqual([
      'Same as the speaker',
      'Gujarati (trial)',
      'Hindi (trial)',
      'English (trial)',
    ]);
    const select = selectTag(html);
    expect(select).toContain('data-testid="captions-target"');
    expect(select).not.toMatch(/\sdisabled=""/u);
    // The label is the field's own <label for>, and the hint is read with it.
    const id = /\sid="([^"]+)"/u.exec(select)?.[1] ?? '';
    expect(id).not.toBe('');
    expect(html).toContain(`<label for="${id}"`);
    expect(words(html)).toContain('Captions in');
    expect(select).toMatch(/aria-describedby="[^"]+"/u);
    // The greyed-out speaker's own language says why (review N7).
    const hintId = /aria-describedby="([^"]+)"/u.exec(select)?.[1] ?? '';
    expect(words(`<p ${html.split(`id="${hintId}"`)[1]?.split('</p>')[0] ?? ''}`)).toBe(
      'Translate the speaker’s words for the audience screens and the stream. Gujarati is greyed out: it is the speaker’s own language.',
    );
    // The value chosen is the speaker's own words (the default, and every library from before alpha.24).
    expect(html).toMatch(/<option value="same" selected="">/u);
    // Nothing of a translation's warning, count or fault while the speaker's own words are chosen.
    expect(html).not.toContain('captions-target-trial');
    expect(html).not.toContain('captions-target-skipped');
    expect(html).not.toContain('captions-target-fault');
  });

  it('greys out the speaker’s own language: it would be the speaker’s words again', () => {
    const disabled = (language: SpeechLanguage | 'auto') =>
      options(field(view({ language })))
        .filter((o) => o.disabled)
        .map((o) => o.value);
    expect(disabled('gu')).toEqual(['gu']);
    expect(disabled('hi')).toEqual(['hi']);
    expect(disabled('en')).toEqual(['en']);
  });

  it('while this computer cannot translate: greyed out, with the reason in plain words for each one', () => {
    for (const reason of GREYED) {
      const language = reason === 'speaker-as-heard' ? 'auto' : reason === 'speaker-sanskrit' ? 'sa' : 'gu';
      const html = field(view({ language, translation: { offered: false, unavailable: reason } }));
      // Nothing to choose but the speaker's own words: the whole choice is greyed out, and says why.
      expect(selectTag(html), reason).toMatch(/\sdisabled=""/u);
      // The reason is the field's hint, so a screen reader reads it with the greyed-out choice.
      const described = /aria-describedby="([^"]+)"/u.exec(selectTag(html))?.[1] ?? '';
      expect(described, reason).not.toBe('');
      const hint = html.split(`id="${described}"`)[1]?.split('</p>')[0] ?? '';
      expect(words(`<p ${hint}`), reason).toContain(unavailableText(reason));
    }
    // Each reason has words of its own, and none is empty.
    const texts = ALL_REASONS.map((reason) => unavailableText(reason));
    expect(new Set(texts).size).toBe(ALL_REASONS.length);
    for (const text of texts) expect(text).toMatch(/^[A-Z].+\.$/u);
    expect(unavailableText('no-pack')).toContain('Help › Caption and Translation Models…');
    expect(unavailableText('speaker-as-heard')).toMatch(/speaker’s own words/u);
    expect(unavailableText('speaker-sanskrit')).toMatch(/Sanskrit/u);
    expect(unavailableText('too-slow')).toMatch(/keep up/u);
    expect(unavailableText('engine-fault')).toMatch(/translation engine stopped/u);
    // Choosing again tries once more only after slowness or the engine's fault (df4a47045), and says so only then.
    for (const reason of RETRIED)
      // The same in both places (a24-review F3): the dialog and File › Caption Language both choose again.
      expect(unavailableText(reason), reason).toMatch(
        /Choosing a language again, here or in File › Caption Language, tries once more\.$/u,
      );
    for (const reason of GREYED) expect(unavailableText(reason), reason).not.toMatch(/once more/u);
    expect(unavailableText(null)).not.toMatch(/once more/u);
    // A Drashti whose main side says nothing of translations (no status): greyed out, said plainly.
    const none = field(view({ translation: null }));
    expect(selectTag(none)).toMatch(/\sdisabled=""/u);
    expect(captionTargetWhyNot(view({ translation: null }))).toBe(unavailableText(null));
    expect(captionTargetWhyNot(view())).toBeNull();
  });

  it('after slowness or the engine’s fault: still choosable, since choosing again tries once more; a chosen one offers Try again', () => {
    for (const reason of RETRIED) {
      // The speaker's own words chosen: the translations can be chosen (it tries once more), the reason as the hint.
      const html = field(view({ translation: { offered: false, unavailable: reason } }));
      expect(selectTag(html), reason).not.toMatch(/\sdisabled=""/u);
      expect(
        options(html)
          .filter((o) => o.disabled)
          .map((o) => o.value),
        reason,
      ).toEqual(['gu']);
      expect(words(html), reason).toContain(unavailableText(reason));
      expect(html, reason).not.toContain('captions-target-retry');
      // Hindi chosen: the reason with what the screens show, and Try again (the same choice saved again).
      const chosen = field(
        view({
          target: 'hi',
          translation: { offered: false, unavailable: reason, fault: 'Placeholder fault words.' },
        }),
      );
      const notice =
        /data-testid="captions-target-unavailable"[^>]*>(.*?)<\/div><\/div><\/div>/u.exec(chosen)?.[1] ?? '';
      expect(words(notice), reason).toContain(unavailableText(reason));
      expect(words(notice), reason).toMatch(/audience screens and the stream show no captions/u);
      const retry = /<button[^>]*data-testid="captions-target-retry"[^>]*>/u.exec(chosen)?.[0] ?? '';
      expect(retry, reason).not.toBe('');
      expect(words(chosen), reason).toContain('Try again');
      expect(options(chosen).find((o) => o.value === 'hi')?.disabled, reason).toBe(false);
      // The engine's own words for its fault, under it.
      expect(chosen, reason).toContain('captions-target-fault');
    }
    // A reason choosing again cannot mend (the pack is missing): no Try again.
    expect(
      field(view({ target: 'hi', translation: { offered: false, unavailable: 'no-pack' } })),
    ).not.toContain('captions-target-retry');
    // Translating as it should: no Try again.
    expect(field(view({ target: 'hi', translation: { target: 'hi' } }))).not.toContain(
      'captions-target-retry',
    );
  });

  it('too slow because live captions themselves stopped: says so, and choosing again cannot mend it, so no Try again (review N3)', () => {
    const stopped = {
      slow: {
        answerMs: 9100,
        behindMs: 0,
        limitMs: 2250,
        threads: 2,
        processors: 2,
        rests: 3,
        keptUp: false,
        stops: true,
      },
      language: 'gu' as const,
    };
    const v = view({
      on: false,
      stopped,
      target: 'hi',
      translation: { offered: false, unavailable: 'too-slow' },
    });
    expect(captionTargetWhyNot(v)).toBe(
      'Live captions stopped on this computer as too slow, so they cannot be translated now. Turning captions on again tries once more.',
    );
    const html = field(v);
    expect(html).not.toContain('captions-target-retry');
    expect(words(html)).not.toMatch(/Choosing a language again/u);
    // Still choosable, as File › Caption Language allows: the choice is kept for when captions are on again.
    expect(options(html).find((o) => o.value === 'hi')?.disabled).toBe(false);
    // Translations that came late (captions still on): choosing again mends it, as before.
    expect(captionTargetWhyNot(view({ translation: { offered: false, unavailable: 'too-slow' } }))).toBe(
      unavailableText('too-slow'),
    );
  });

  it('a translation chosen but not possible now: the choice stays open to go back, the reason shown, no screen of the audience falls back to the speaker’s words', () => {
    const html = field(view({ target: 'hi', translation: { offered: false, unavailable: 'no-pack' } }));
    // Still open, so the speaker's own words can be chosen again; the translations are greyed out.
    expect(selectTag(html)).not.toMatch(/\sdisabled=""/u);
    expect(
      options(html)
        .filter((o) => o.disabled)
        .map((o) => o.value),
    ).toEqual(['gu', 'hi', 'en']);
    const notice =
      /data-testid="captions-target-unavailable"[^>]*>(.*?)<\/div><\/div>/u.exec(html)?.[1] ?? '';
    expect(words(notice)).toContain(unavailableText('no-pack'));
    expect(words(notice)).toMatch(/audience screens and the stream show no captions/u);
    expect(words(notice)).toContain('Same as the speaker');
    expect(html).toMatch(/role="alert"[^>]*data-testid="captions-target-unavailable"/u);
    // As heard or Sanskrit: the speaker's own words show, and it says so (a warning, not a failure).
    const heard = field(
      view({
        language: 'auto',
        target: 'hi',
        translation: { offered: false, unavailable: 'speaker-as-heard' },
      }),
    );
    expect(words(heard)).toContain(unavailableText('speaker-as-heard'));
    expect(heard).not.toMatch(/audience screens and the stream show no captions/u);
    // Nothing is translated as heard: no Trial warning and no count of skipped phrases.
    expect(heard).not.toContain('captions-target-trial');
    expect(heard).not.toContain('captions-target-skipped');
  });

  it('a translation chosen: the Trial warning, that it is a machine translation and a reader checks a rehearsal first', () => {
    const html = field(view({ target: 'hi', translation: { target: 'hi' } }));
    expect(html).toMatch(/<option value="hi" selected="">/u);
    expect(TRANSLATION_TRIAL_WARNING).toMatch(/machine translation/u);
    expect(TRANSLATION_TRIAL_WARNING).toMatch(/nobody checks/u);
    expect(TRANSLATION_TRIAL_WARNING).toMatch(/times and numbers/u);
    expect(TRANSLATION_TRIAL_WARNING).toMatch(/reader/u);
    expect(TRANSLATION_TRIAL_WARNING).toMatch(/rehearsal/u);
    const trial = /data-testid="captions-target-trial"[^>]*>(.*?)<\/div><\/div>/u.exec(html)?.[1] ?? '';
    expect(words(trial)).toContain(TRANSLATION_TRIAL_WARNING);
    // What each kind of screen shows, a phrase at a time.
    expect(words(html)).toMatch(/stage screens keep the speaker’s own words/u);
    expect(words(html)).toMatch(/phrase/u);
    expect(words(html)).toContain('File › Caption Language');
    // Every target is a trial: the warning comes with each.
    for (const target of ['gu', 'en'] as const)
      expect(field(view({ language: 'hi', target, translation: { target } }))).toContain(
        'captions-target-trial',
      );
  });

  it('the speaker’s own language chosen as the target: says the speaker’s words show, no warning of a translation', () => {
    const html = field(view({ language: 'hi', target: 'hi' }));
    expect(html).toMatch(
      /<option value="hi" selected="" disabled="">|<option value="hi" disabled="" selected="">/u,
    );
    expect(words(html)).toMatch(
      /The speaker’s language is Hindi, so captions show the speaker’s own words\./u,
    );
    expect(html).not.toContain('captions-target-trial');
  });

  it('the phrases skipped and the last fault, in plain words; the count is no live region (it would be noisy)', () => {
    expect(skippedText(0)).toBe('No phrase has been skipped since captions started.');
    expect(skippedText(1)).toBe(
      '1 phrase was skipped since captions started: its translation came too late or failed, so it was not shown.',
    );
    expect(skippedText(4)).toBe(
      '4 phrases were skipped since captions started: their translation came too late or failed, so they were not shown.',
    );
    const html = field(
      view({ target: 'hi', translation: { target: 'hi', skipped: 4, fault: 'Placeholder fault words.' } }),
    );
    const skipped = /<p[^>]*data-testid="captions-target-skipped"[^>]*>([^<]*)<\/p>/u.exec(html);
    expect(skipped?.[1]).toBe(skippedText(4));
    expect(skipped?.[0]).not.toMatch(/role=|aria-live/u);
    const fault = /data-testid="captions-target-fault"[^>]*>(.*?)<\/div><\/div>/u.exec(html)?.[1] ?? '';
    expect(words(fault)).toBe('Last problem translating captions: Placeholder fault words.');
    // No fault: nothing said of one.
    expect(field(view({ target: 'hi', translation: { target: 'hi' } }))).not.toContain(
      'captions-target-fault',
    );
  });
});

describe('the status bar while a chosen translation cannot be made (alpha.24, 2c)', () => {
  it('says translated captions are off, and why, only while captions are on and the pair translates', () => {
    const off = (reason: CaptionTranslationUnavailable | null) =>
      view({ target: 'hi', translation: { offered: false, unavailable: reason } });
    expect(translationStatusLine(off('no-pack'))).toBe(
      'Translated captions are off: the translation model pack is not on this computer.',
    );
    expect(translationStatusLine(off('no-engine'))).toBe(
      'Translated captions are off: this copy of Drashti has no translation program.',
    );
    expect(translationStatusLine(off('unknown-model'))).toBe(
      'Translated captions are off: this copy of Drashti cannot use the translation pack’s model.',
    );
    expect(translationStatusLine(off('too-slow'))).toBe(
      'Translated captions are off: this computer cannot keep up with them.',
    );
    expect(translationStatusLine(off('engine-fault'))).toBe(
      'Translated captions are off: the translation engine stopped.',
    );
    expect(
      translationStatusLine(
        view({
          target: 'hi',
          translation: { offered: false, unavailable: 'engine-fault', fault: 'Placeholder fault words.' },
        }),
      ),
    ).toBe('Translated captions are off: the translation engine stopped.');
    expect(translationStatusLine(off(null))).toBe('Translated captions are off on this computer.');
    expect(
      translationStatusLine(
        view({ target: 'hi', translation: { offered: false, fault: 'Placeholder stop.' } }),
      ),
    ).toBe('Translated captions are off. Placeholder stop.');
    // Nothing to say: working, the speaker's own words chosen, a pair that does not translate, or captions off.
    expect(translationStatusLine(view({ target: 'hi', translation: { target: 'hi' } }))).toBeNull();
    expect(
      translationStatusLine(view({ translation: { offered: false, unavailable: 'no-pack' } })),
    ).toBeNull();
    expect(
      translationStatusLine(view({ language: 'hi', target: 'hi', translation: { offered: false } })),
    ).toBeNull();
    expect(
      translationStatusLine(
        view({
          language: 'auto',
          target: 'hi',
          translation: { offered: false, unavailable: 'speaker-as-heard' },
        }),
      ),
    ).toBeNull();
    expect(
      translationStatusLine(view({ on: false, ...{ target: 'hi' }, translation: { offered: false } })),
    ).toBeNull();
    expect(translationStatusLine(null)).toBeNull();
    // Captions' own line (resting, no sound input) is unchanged and comes first: the store shows it.
    expect(captionsStatusLine(off('no-pack'))).toBeNull();
  });
});
