import type { EngineState, PropItem } from './engine/state';
import { initialEngineState } from './engine/state';
import type { RenderSlide, TextElement } from './model';

/*
 * The practice show (Session 26g): placeholder slides on the operator's own screen only, for trying
 * Next, Back, Black-out, Logo and Clear all before anything is set up. It lives in the operator
 * window alone: a little state of its own, turned into an EngineState only so the window's own
 * pictures (LIVE, the slides) can draw it. It never goes to the main process, so it never reaches
 * an output, a node, the stream, a recording, a phone or the API, and nothing of it is saved.
 */

export const PRACTICE_ID = 'practice';

/** Placeholder words, written for Drashti: never kirtan or scripture text. */
const LINES: readonly { label: string; lines: readonly [string, string, string] }[] = [
  { label: 'Welcome', lines: ['Practice slide one', 'અભ્યાસ સ્લાઇડ એક', 'अभ्यास स्लाइड एक'] },
  { label: 'Verse', lines: ['Practice slide two', 'અભ્યાસ સ્લાઇડ બે', 'अभ्यास स्लाइड दो'] },
  { label: 'Chorus', lines: ['Practice slide three', 'અભ્યાસ સ્લાઇડ ત્રણ', 'अभ्यास स्लाइड तीन'] },
  { label: 'Verse', lines: ['Practice slide four', 'અભ્યાસ સ્લાઇડ ચાર', 'अभ्यास स्लाइड चार'] },
  { label: 'Thank you', lines: ['Practice slide five', 'અભ્યાસ સ્લાઇડ પાંચ', 'अभ्यास स्लाइड पाँच'] },
];

function words(id: string, text: string, y: number, size: number, lang: 'en' | 'gu' | 'hi'): TextElement {
  return {
    id,
    kind: 'text',
    frame: { x: 160, y, width: 1600, height: size * 1.9 },
    text,
    lang,
    style: {
      fontFamily: null,
      fontSize: size,
      fontWeight: 500,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
      shadow: true,
      shrinkToFit: true,
    },
    runs: [{ text, lang, size }],
  };
}

/** The practice show's slides: five placeholder slides in English, Gujarati and Hindi. */
export function practiceSlides(): RenderSlide[] {
  return LINES.map(({ lines: [en, gu, hi] }, i) => ({
    id: `practice-${String(i + 1)}`,
    width: 1920,
    height: 1080,
    background: '#000000',
    elements: [
      words(`practice-${String(i + 1)}-gu`, gu, 300, 96, 'gu'),
      words(`practice-${String(i + 1)}-hi`, hi, 480, 84, 'hi'),
      words(`practice-${String(i + 1)}-en`, en, 660, 64, 'en'),
    ],
  }));
}

/** What each practice slide is called in its caption (its group). */
export const practiceLabels = (): string[] => LINES.map((l) => l.label);

/** The placeholder logo L puts up in practice: never the mandir's own. */
export const PRACTICE_LOGO: PropItem = {
  id: 'practice-logo',
  name: 'Placeholder logo',
  elements: [words('practice-logo-words', 'Your logo goes here', 480, 72, 'en')],
};

export interface Practice {
  /** The slide on the operator's screen, or null when nothing is up. */
  index: number | null;
  blackout: boolean;
  logo: boolean;
  /** What Clear all took down, while Put it back can bring it back. */
  cleared: number | null;
  /** Counts every change, as the engine's rev does, so pictures know to draw again. */
  rev: number;
}

export const PRACTICE_START: Practice = { index: null, blackout: false, logo: false, cleared: null, rev: 0 };

export type PracticeAction =
  | 'next'
  | 'previous'
  | 'back'
  | 'clearAll'
  | 'clearSlide'
  | 'putBack'
  | 'toggleBlackout'
  | 'toggleLogo'
  | { goTo: number };

/** One step of the practice show, as the real show takes it (a little simpler: one presentation). */
export function practiceStep(p: Practice, action: PracticeAction, count = LINES.length): Practice {
  const next = (change: Partial<Practice>): Practice => ({ ...p, ...change, rev: p.rev + 1 });
  if (typeof action === 'object') {
    if (action.goTo < 0 || action.goTo >= count) return p;
    return next({ index: action.goTo, cleared: null });
  }
  switch (action) {
    case 'next':
      if (p.index === null) return next({ index: 0, cleared: null });
      return p.index + 1 < count ? next({ index: p.index + 1, cleared: null }) : p;
    case 'previous':
    case 'back':
      return p.index !== null && p.index > 0 ? next({ index: p.index - 1, cleared: null }) : p;
    case 'clearAll':
    case 'clearSlide':
      return p.index === null ? p : next({ index: null, cleared: action === 'clearAll' ? p.index : null });
    case 'putBack':
      return p.cleared === null ? p : next({ index: p.cleared, cleared: null });
    case 'toggleBlackout':
      return next({ blackout: !p.blackout });
    case 'toggleLogo':
      return next({ logo: !p.logo });
  }
}

/** The practice show as an EngineState, for the window's own pictures to draw (never sent anywhere). */
export function practiceState(p: Practice, slides: readonly RenderSlide[] = practiceSlides()): EngineState {
  const state = initialEngineState();
  const slide = p.index === null ? undefined : slides[p.index];
  const following = p.index === null ? slides[0] : slides[p.index + 1];
  return {
    ...state,
    live: {
      presentationId: slide ? PRACTICE_ID : null,
      slideIndex: slide ? p.index : null,
      slideCount: slide ? slides.length : 0,
      arrangementId: null,
      playlist: null,
    },
    layers: {
      ...state.layers,
      slide:
        slide && p.index !== null
          ? { presentationId: PRACTICE_ID, slideIndex: p.index, slide, shownAt: 0, notes: '' }
          : null,
    },
    blackout: p.blackout,
    logo: p.logo ? PRACTICE_LOGO : null,
    canPutBack: p.cleared !== null,
    next: following
      ? {
          kind: 'slide',
          presentationId: PRACTICE_ID,
          slideIndex: p.index === null ? 0 : p.index + 1,
          slide: following,
          background: null,
          itemId: null,
          notes: '',
        }
      : null,
  };
}
