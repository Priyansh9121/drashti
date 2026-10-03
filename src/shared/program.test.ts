import { describe, expect, it } from 'vitest';
import type { EngineState, PropItem } from './engine/state';
import { initialEngineState } from './engine/state';
import type { RenderSlide, SlideElement, TextElement, TextRun, TextStyle } from './model';
import { LOWER_THIRD_MAX_LINES, lowerThird, programPicture } from './program';

/* Placeholder words only: never real kirtan text. */

const style: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
};

const box = (id: string, runs: TextRun[], y = 200): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 100, y, width: 1720, height: 300 },
  text: runs.map((r) => r.text).join(''),
  lang: 'gu',
  style,
  runs,
});

const slide = (elements: SlideElement[], kirtan = true): RenderSlide => ({
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements,
  ...(kirtan ? { kirtan: true } : {}),
});

const kirtanSlide = () =>
  slide([
    box('k', [
      { text: 'નમૂનો\n', lang: 'gu' },
      { text: 'नमूना\n', lang: 'hi' },
      { text: 'Namuno\n', lang: 'translit' },
      { text: 'Sample', lang: 'en' },
    ]),
  ]);

const live = (s: RenderSlide | null, patch: Partial<EngineState> = {}): EngineState => {
  const state = initialEngineState();
  return {
    ...state,
    ...patch,
    layers: {
      ...state.layers,
      ...patch.layers,
      slide: s ? { presentationId: 'p', slideIndex: 0, slide: s, shownAt: 1, notes: '' } : null,
    },
  };
};

const text = (lines: { runs: TextRun[] }[]) => lines.map((l) => l.runs.map((r) => r.text).join(''));
const prop: PropItem = { id: 'logo', name: 'Bug', elements: [] };

describe('the lower third', () => {
  it('has the live slide’s words in the stream group’s languages, in its order', () => {
    expect(text(lowerThird(kirtanSlide(), ['translit', 'en']))).toEqual(['Namuno', 'Sample']);
    expect(text(lowerThird(kirtanSlide(), ['en', 'gu']))).toEqual(['Sample', 'નમૂનો']);
    expect(text(lowerThird(kirtanSlide(), null))).toEqual(['નમૂનો', 'नमूना', 'Namuno', 'Sample']);
    expect(lowerThird(kirtanSlide(), ['gu'])[0]?.lang).toBe('gu');
  });

  it('shows every line of a slide that is not a kirtan’s, top to bottom, without blank lines', () => {
    const s = slide(
      [
        box('b', [{ text: 'Second box', lang: 'en' }], 700),
        box('a', [{ text: 'First\n\nbox', lang: 'en' }], 100),
      ],
      false,
    );
    expect(text(lowerThird(s, ['gu']))).toEqual(['First', 'box', 'Second box']);
  });

  it('keeps words typed in a legacy font, with their box’s font, and stops at a few lines', () => {
    const legacy = slide([
      { ...box('l', [{ text: 'k\\ef', legacy: true }]), style: { ...style, fontFamily: 'Gopika' } },
    ]);
    expect(lowerThird(legacy, ['translit'])).toEqual([
      { lang: null, runs: [{ text: 'k\\ef', legacy: true }], boxFont: 'Gopika' },
    ]);
    const many = slide(
      [
        box(
          'm',
          Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i}\n`, lang: 'en' as const })),
        ),
      ],
      false,
    );
    expect(lowerThird(many, null)).toHaveLength(LOWER_THIRD_MAX_LINES);
  });
});

describe('what the stream shows', () => {
  it('in the Slides layout: what the hall sees, whatever it is', () => {
    for (const state of [live(kirtanSlide()), live(null, { blackout: true }), live(null, { logo: prop })])
      expect(programPicture(state, 'slides', ['en'])).toEqual({ kind: 'scene' });
  });

  it('in the Camera layout: the camera with the slide’s words, in the stream’s languages', () => {
    expect(programPicture(live(kirtanSlide()), 'camera', ['translit'])).toMatchObject({
      kind: 'camera',
      full: null,
      lowerThird: [{ lang: 'translit' }],
    });
  });

  it('black-out and the logo are for the hall: the camera stays, the words go, props and messages stay', () => {
    const withExtras = (patch: Partial<EngineState>) =>
      live(kirtanSlide(), {
        ...patch,
        layers: {
          ...initialEngineState().layers,
          props: [prop],
          messages: [{ id: 'm', text: 'Placeholder' }],
        },
      });
    for (const patch of [{ blackout: true }, { logo: prop }])
      expect(programPicture(withExtras(patch), 'camera', null)).toEqual({
        kind: 'camera',
        lowerThird: [],
        full: null,
        props: true,
        messages: true,
      });
  });

  it('Clear slide leaves the camera alone; a picture or video going live is shown full frame', () => {
    expect(programPicture(live(null), 'camera', null)).toMatchObject({ lowerThird: [], full: null });
    const picture = live(null, {
      layers: {
        ...initialEngineState().layers,
        background: { kind: 'media', mediaId: 'm', media: 'video', fit: 'fill', loop: false, startedAt: 1 },
      },
    });
    expect(programPicture(picture, 'camera', null)).toMatchObject({ full: 'background', lowerThird: [] });
    const pictureSlide = slide(
      [
        {
          id: 'i',
          kind: 'image',
          frame: { x: 0, y: 0, width: 1920, height: 1080 },
          mediaId: 'm',
          fit: 'fill',
        },
      ],
      false,
    );
    expect(programPicture(live(pictureSlide), 'camera', null)).toMatchObject({
      full: 'slide',
      lowerThird: [],
    });
    // A colour background with no slide (Clear slide over a colour) is the camera.
    const colour = live(null, {
      layers: { ...initialEngineState().layers, background: { kind: 'color', color: '#123456' } },
    });
    expect(programPicture(colour, 'camera', null)).toMatchObject({ full: null });
  });
});
