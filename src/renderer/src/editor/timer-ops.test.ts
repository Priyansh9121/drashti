import { describe, expect, it } from 'vitest';
import type { TextElement, TimerElement } from '../../../shared/model';
import type { EditDoc, EditSlide, SlideLook } from '../../../shared/slide-edit';
import { copyElements, pasteElements } from './clipboard';
import { findSlide, newSlide, newTimerElement, newTimerSlide } from './ops';

/*
 * A Timer in the slide editor (Session 50): a new one in the theme's words, large, in the middle; New Timer
 * Slide…'s slide in the presentation's theme with one of the two ready layouts; a Timer copied to slides of
 * another size, its digits scaled with it.
 */

const look: SlideLook = {
  frame: { x: 96, y: 96, width: 1728, height: 888 },
  style: {
    fontFamily: 'Placeholder Sans',
    fontSize: 80,
    fontWeight: 500,
    color: '#fde68a',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.35,
    shadow: true,
  },
  langs: {},
  background: '#102030',
  darken: { kind: 'band', strength: 0.6 },
};

const HD = { width: 1920, height: 1080 };

describe('a Timer in the slide editor', () => {
  it('a new Timer shows the chosen timer, large, in the middle, in the theme’s words', () => {
    expect(newTimerElement('t1', look, HD)).toMatchObject({
      kind: 'timer',
      timerId: 't1',
      frame: { x: 384, y: 378, width: 1152, height: 324 },
      style: {
        fontFamily: 'Placeholder Sans',
        fontSize: 216,
        fontWeight: 500,
        color: '#fde68a',
        shadow: true,
        align: 'center',
        verticalAlign: 'middle',
      },
    });
  });

  it('New Timer Slide…: the theme’s colour and darkening, the layout’s elements, each with an id of its own', () => {
    const alone = newTimerSlide('alone', 't1', look, HD);
    expect(alone).toMatchObject({
      background: '#102030',
      darken: { kind: 'band', strength: 0.6 },
      label: '',
    });
    expect(alone.elements.map((e) => e.kind)).toEqual(['timer']);
    const words = newTimerSlide('words', 't1', look, HD, 'Placeholder words');
    expect(words.elements.map((e) => e.kind)).toEqual(['text', 'timer']);
    expect((words.elements[0] as TextElement).text).toBe('Placeholder words');
    expect((words.elements[1] as TimerElement).timerId).toBe('t1');
    expect(new Set([words.id, ...words.elements.map((e) => e.id)]).size).toBe(3);
    // No theme to follow: Drashti's own words, and no colour of its own.
    const plain = newTimerSlide('alone', 't1', null, HD);
    expect(plain.background).toBeNull();
    expect(plain.elements[0]).toMatchObject({ style: { color: '#ffffff', shadow: true } });
  });

  it('pasted into slides of another size, its digits, shadow and outline scale with it', () => {
    const timer: TimerElement = {
      ...newTimerElement('t1', look, HD),
      id: 'timer',
      style: {
        ...newTimerElement('t1', look, HD).style,
        shadow: { color: '#000000', blur: 30, x: 6, y: 6 },
        outline: { color: '#000000', width: 3 },
      },
      lastMinute: { color: '#f5a524' },
    };
    const slide = (id: string, elements: EditSlide['elements'] = []): EditSlide => ({
      ...newSlide(null),
      id,
      elements,
    });
    const doc = (size: { width: number; height: number }, slides: EditSlide[]): EditDoc => ({
      presentationId: 'p',
      name: 'Placeholder',
      ...size,
      transition: null,
      loop: false,
      groups: [{ id: 'g', name: '', color: null, slides }],
    });
    expect(copyElements(doc(HD, [slide('a', [timer])]), 'a', ['timer'])).toBe(1);
    const into = doc({ width: 1280, height: 720 }, [slide('b')]);
    const pasted = pasteElements(into, 'b');
    const el = pasted ? findSlide(pasted.doc, 'b')?.elements[0] : undefined;
    expect(el).toMatchObject({
      kind: 'timer',
      timerId: 't1',
      frame: { x: 256, y: 252, width: 768, height: 216 },
      style: { fontSize: 144, shadow: { blur: 20, x: 4, y: 4 }, outline: { width: 2 } },
      lastMinute: { color: '#f5a524' },
    });
  });
});
