import { describe, expect, it } from 'vitest';
import type { MediaElement, TextElement } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { copyElements, pasteElements } from './clipboard';
import { findSlide, newSlide, rotateElements, scaleElements } from './ops';

/* The slide editor: several elements resized and turned together; copy and paste between slides and presentations. */

const text = (id: string, frame: TextElement['frame'], extra: Partial<TextElement> = {}): TextElement => ({
  id,
  kind: 'text',
  frame,
  text: 'Placeholder words',
  lang: 'gu',
  style: {
    fontFamily: null,
    fontSize: 60,
    fontWeight: 700,
    color: '#ffcc00',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: { color: '#000000', blur: 10, x: 4, y: 4 },
    outline: { color: '#000000', width: 2 },
  },
  runs: [
    { text: 'નમૂનો\n', lang: 'gu', size: 60 },
    { text: 'Namuno', lang: 'translit', size: 40, italic: true },
  ],
  ...extra,
});
const picture = (id: string): MediaElement => ({
  id,
  kind: 'image',
  frame: { x: 1000, y: 100, width: 400, height: 300 },
  mediaId: 'placeholder-picture',
  fit: 'fit',
});
const slide = (id: string, elements: EditSlide['elements'] = []): EditSlide => ({
  ...newSlide(null),
  id,
  elements,
});
const doc = (size = { width: 1920, height: 1080 }, slides = [slide('a'), slide('b')]): EditDoc => ({
  presentationId: 'p',
  name: 'Placeholder',
  ...size,
  transition: null,
  loop: false,
  groups: [{ id: 'g', name: 'Verse', color: null, slides }],
});

describe('several elements together', () => {
  it('resize by the box round them: each keeps its place in it, words keep their size', () => {
    const d = doc(undefined, [
      slide('a', [text('t', { x: 100, y: 100, width: 200, height: 100 }), picture('p')]),
    ]);
    // The box round both is 100..1400 x 100..400; stretch it to twice as wide from the left, the same height.
    const from = { x: 100, y: 100, width: 1300, height: 300 };
    const to = { x: 100, y: 100, width: 2600, height: 300 };
    const out = findSlide(scaleElements(d, 'a', ['t', 'p'], from, to), 'a')?.elements ?? [];
    expect(out.map((el) => el.frame)).toEqual([
      { x: 100, y: 100, width: 400, height: 100 },
      { x: 1900, y: 100, width: 800, height: 300 },
    ]);
    expect(out[0]?.kind === 'text' ? out[0].style.fontSize : 0).toBe(60);
  });

  it('turn round the middle of the box round them, each turning as much', () => {
    const d = doc(undefined, [
      slide('a', [
        text('l', { x: 0, y: 0, width: 100, height: 100 }),
        text('r', { x: 200, y: 0, width: 100, height: 100 }, { rotation: 10 }),
      ]),
    ]);
    // A quarter turn round (150, 50): the left one goes above, the right one below.
    const out = findSlide(rotateElements(d, 'a', ['l', 'r'], { x: 150, y: 50 }, 90), 'a')?.elements ?? [];
    expect(out.map((el) => [el.frame.x, el.frame.y, el.rotation])).toEqual([
      [100, -100, 90],
      [100, 100, 100],
    ]);
    // A whole turn back is no turn at all (the rotation is left out).
    const back = findSlide(rotateElements(d, 'a', ['l'], { x: 50, y: 50 }, 360), 'a')?.elements[0];
    expect(back?.rotation).toBeUndefined();
  });
});

describe('copy and paste', () => {
  it('pastes onto another slide where they were, with their styles, languages and media; new ids', () => {
    const d = doc(undefined, [
      slide('a', [text('t', { x: 100, y: 100, width: 600, height: 200 }), picture('p')]),
      slide('b'),
    ]);
    expect(copyElements(d, 'a', ['t', 'p'])).toBe(2);
    const pasted = pasteElements(d, 'b');
    expect(pasted?.ids).toHaveLength(2);
    const onB = findSlide(pasted?.doc ?? d, 'b')?.elements ?? [];
    const original = findSlide(d, 'a')?.elements ?? [];
    expect(onB.map(({ id: _id, ...rest }) => rest)).toEqual(original.map(({ id: _id, ...rest }) => rest));
    expect(onB.map((el) => el.id)).toEqual(pasted?.ids);
    expect(onB.some((el) => original.some((o) => o.id === el.id))).toBe(false);
  });

  it('pastes a step down and to the right where the place is taken, and exactly in place when asked', () => {
    const d = doc(undefined, [slide('a', [text('t', { x: 100, y: 100, width: 600, height: 200 })])]);
    copyElements(d, 'a', ['t']);
    const once = pasteElements(d, 'a');
    const twice = once ? pasteElements(once.doc, 'a') : null;
    expect(findSlide(twice?.doc ?? d, 'a')?.elements.map((el) => [el.frame.x, el.frame.y])).toEqual([
      [100, 100],
      [124, 124],
      [148, 148],
    ]);
    const inPlace = pasteElements(d, 'a', { inPlace: true });
    expect(findSlide(inPlace?.doc ?? d, 'a')?.elements.map((el) => [el.frame.x, el.frame.y])).toEqual([
      [100, 100],
      [100, 100],
    ]);
  });

  it('into a presentation of another size: the same place and size in proportion, the words scaled with it', () => {
    const big = doc(undefined, [slide('a', [text('t', { x: 960, y: 540, width: 600, height: 200 })])]);
    copyElements(big, 'a', ['t']);
    const small = doc({ width: 1280, height: 720 }, [slide('s')]);
    const el = findSlide(pasteElements(small, 's')?.doc ?? small, 's')?.elements[0];
    expect(el?.frame).toEqual({ x: 640, y: 360, width: 400, height: 133.33 });
    if (el?.kind !== 'text') throw new Error('not text');
    expect(el.style.fontSize).toBe(40);
    expect(el.runs?.map((r) => [r.lang, r.size, r.italic])).toEqual([
      ['gu', 40, undefined],
      ['translit', 26.67, true],
    ]);
    expect(el.style.outline?.width).toBe(1.33);
  });
});
