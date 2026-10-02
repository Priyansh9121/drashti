import { describe, expect, it } from 'vitest';
import type { ShapeElement, TextElement } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import {
  addGroup,
  addSlideAfter,
  applyLookToAll,
  copySlide,
  cueSettings,
  moveSlideBy,
  newSlide,
  removeSlide,
  setBackgroundCue,
  setSoundCue,
} from './ops';

const text = (id: string, words: string, extra: Partial<TextElement> = {}): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 0, y: 0, width: 100, height: 100 },
  text: words,
  lang: null,
  style: {
    fontFamily: null,
    fontSize: 60,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
  ...extra,
});
const slide = (id: string, elements: EditSlide['elements'] = []): EditSlide => ({
  ...newSlide(null),
  id,
  elements,
});
const doc = (): EditDoc => ({
  presentationId: 'p',
  name: 'Placeholder',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    { id: 'v', name: 'Verse', color: '#3e63dd', slides: [slide('a'), slide('b')] },
    { id: 'c', name: 'Chorus', color: '#e5484d', slides: [slide('c1')] },
  ],
});
const order = (d: EditDoc) => d.groups.map((g) => `${g.name}: ${g.slides.map((s) => s.id).join(' ')}`);

describe('slides and groups', () => {
  it('adds a slide after another, copies one with new ids, and removes one', () => {
    let d = addSlideAfter(doc(), 'a', slide('new'));
    expect(order(d)).toEqual(['Verse: a new b', 'Chorus: c1']);
    const original = slide('x', [text('t', 'Placeholder')]);
    const copy = copySlide(original);
    expect(copy.id).not.toBe('x');
    expect(copy.elements[0]?.id).not.toBe('t');
    expect(copy.elements[0]).toMatchObject({ text: 'Placeholder' });
    d = removeSlide(d, 'new');
    expect(order(d)).toEqual(['Verse: a b', 'Chorus: c1']);
  });

  it('moves a slide up and down, on into the group before or after', () => {
    let d = moveSlideBy(doc(), 'b', 1);
    expect(order(d)).toEqual(['Verse: a', 'Chorus: b c1']);
    d = moveSlideBy(d, 'b', -1);
    expect(order(d)).toEqual(['Verse: a b', 'Chorus: c1']);
    d = moveSlideBy(d, 'a', -1);
    expect(order(d)).toEqual(['Verse: a b', 'Chorus: c1']);
  });

  it('makes a group with a slide in a colour not used yet', () => {
    const { doc: d, slideId } = addGroup(doc(), 'Bridge', null);
    expect(d.groups.at(-1)).toMatchObject({ name: 'Bridge', color: '#f76b15' });
    expect(slidesOf(d).at(-1)?.id).toBe(slideId);
  });

  it('sets and clears a slide’s background and sound cues, keeping the others', () => {
    const s: EditSlide = {
      ...slide('s'),
      cues: [{ id: 'k', kind: 'clear', label: 'Clear', mediaId: null, props: '{"action":"2"}' }],
    };
    const withBg = setBackgroundCue(s, { id: 'pic', kind: 'image', fit: 'fill', loop: true });
    expect(withBg.cues.map((c) => c.kind)).toEqual(['background', 'clear']);
    const [bg] = withBg.cues;
    if (!bg) throw new Error('no cue');
    expect(cueSettings(bg)).toEqual({ media: 'image', fit: 'fill', loop: false });
    const withSound = setSoundCue(withBg, { id: 'tune', volume: 0.5, loop: true });
    expect(withSound.cues.map((c) => c.kind)).toEqual(['background', 'clear', 'audio']);
    const sound = withSound.cues[2];
    if (!sound) throw new Error('no cue');
    expect(cueSettings(sound)).toEqual({ volume: 0.5, loop: true });
    expect(setSoundCue(setBackgroundCue(withSound, null), null).cues).toEqual(s.cues);
  });
});

describe('one slide’s look for every slide', () => {
  const backdrop: ShapeElement = {
    id: 'box',
    kind: 'shape',
    frame: { x: 0, y: 800, width: 1920, height: 280 },
    fill: '#000000',
    cornerRadius: 0,
    opacity: 0.5,
  };
  const model = text('m', 'નમૂના\nNamuna', {
    frame: { x: 50, y: 820, width: 1820, height: 240 },
    rotation: 2,
    style: { ...text('x', '').style, fontSize: 70, color: '#ffcc00', shadow: true },
    runs: [
      { text: 'નમૂના\n', lang: 'gu', size: 90, weight: 700 },
      { text: 'Namuna', lang: 'translit', size: 50, italic: true },
    ],
  });
  const d: EditDoc = {
    ...doc(),
    groups: [
      {
        id: 'v',
        name: 'Verse',
        color: null,
        slides: [
          { ...slide('a', [backdrop, model]), background: '#102030' },
          slide('b', [
            text('w', 'બીજી\nBiji', {
              runs: [
                { text: 'બીજી\n', lang: 'gu', size: 40, color: '#ff0000' },
                { text: 'Biji', lang: 'translit' },
              ],
            }),
            {
              id: 'pic',
              kind: 'image',
              frame: { x: 1, y: 2, width: 3, height: 4 },
              mediaId: 'm',
              fit: 'fit',
            },
            { ...backdrop, id: 'old-shape', fill: '#ffffff' },
          ]),
          slide('c', [
            text('plain', 'ત્રીજી', { lang: 'gu' }),
            text('legacy', 'xyz', { runs: [{ text: 'xyz', font: 'Gopika', legacy: true }] }),
          ]),
        ],
      },
    ],
  };

  it('gives every other slide its colour, shapes, boxes’ places and each language’s look, never its words', () => {
    const next = applyLookToAll(d, 'a');
    const [a, b, c] = slidesOf(next);
    expect(a).toEqual(slidesOf(d)[0]);
    expect(b?.background).toBe('#102030');
    // The model's shape behind its words comes first; the slide's own shape is gone; the picture stays.
    expect(b?.elements.map((e) => e.kind)).toEqual(['shape', 'text', 'image']);
    expect(b?.elements[0]).toMatchObject({ fill: '#000000', opacity: 0.5 });
    expect(b?.elements[0]?.id).not.toBe('box');
    const words = b?.elements[1] as TextElement;
    expect(words.text).toBe('બીજી\nBiji');
    expect(words).toMatchObject({
      frame: model.frame,
      rotation: 2,
      style: { fontSize: 70, color: '#ffcc00', shadow: true },
    });
    expect(words.runs).toEqual([
      { text: 'બીજી\n', lang: 'gu', size: 90, weight: 700 },
      { text: 'Biji', lang: 'translit', size: 50, italic: true },
    ]);
    // A plain box takes its language's look; legacy words keep their font.
    const plain = c?.elements.find((e) => e.id === 'plain') as TextElement;
    expect(plain.runs).toEqual([{ text: 'ત્રીજી', lang: 'gu', size: 90, weight: 700 }]);
    const legacy = c?.elements.find((e) => e.id === 'legacy') as TextElement;
    expect(legacy.runs).toEqual([{ text: 'xyz', font: 'Gopika', legacy: true }]);
    // Only the first box has a model: the second box on a slide keeps its place.
    expect(legacy.frame).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});
