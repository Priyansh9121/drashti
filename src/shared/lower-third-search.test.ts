import { describe, expect, it } from 'vitest';
import {
  ANIMATION_QUICK_WORDS,
  findAnimations,
  findTemplates,
  hasQuickWord,
  type QuickWord,
  searchWords,
  TEMPLATE_QUICK_WORDS,
  toggleQuickWord,
} from './lower-third-search';
import { OFFERED_LIST } from './lower-third-studio';
import { LOWER_THIRD_TEMPLATES } from './lower-third-templates';

/*
 * Finding a lower third's animation or template by plain words, in the one box where it is chosen (Session 58, the
 * owner: "make finding an animation simple, in the place you pick it").
 */

const ins = (query: string) => findAnimations(query, 'in').map((o) => o.animation.id);
const outs = (query: string) => findAnimations(query, 'out').map((o) => o.animation.id);
const templates = (query: string) => findTemplates(LOWER_THIRD_TEMPLATES, query).map((t) => t.id);
const quickWord = (list: readonly QuickWord[], word: string): QuickWord => {
  const found = list.find((q) => q.word === word);
  if (!found) throw new Error(`no quick word ${word}`);
  return found;
};

describe('the words a search reads', () => {
  it('lower case, without marks, signs or the little words', () => {
    expect(searchWords('Slide in from the Left, SLOW')).toEqual(['slide', 'left', 'slow']);
    expect(searchWords('Fade and wipe — café')).toEqual(['fade', 'wipe', 'cafe']);
    expect(searchWords('   ')).toEqual([]);
    expect(searchWords('Flip, 3D')).toEqual(['flip', '3d']);
  });
});

describe('finding an animation: the ways in and out, by their plain words', () => {
  it('nothing asked for is every one, in the list’s own order', () => {
    expect(findAnimations('', 'in')).toEqual(OFFERED_LIST);
    expect(findAnimations('  ', 'out')).toEqual(OFFERED_LIST);
  });

  it('a kind, a direction and a speed together, each word the start of one it has; the order stays the list’s', () => {
    for (const found of [ins('slide up slow'), outs('slide up slow')]) {
      expect(found).toContain('slide-up-slow');
      expect(found).not.toContain('slide-left-slow');
      expect(found).not.toContain('slide-up-steady');
      expect(found.every((id) => id.endsWith('-slow'))).toBe(true);
    }
    const order = OFFERED_LIST.map((o) => o.animation.id);
    const found = ins('slide');
    expect(found).toEqual(order.filter((id) => found.includes(id)));
    expect(ins('bounc')).toContain('bounce-up-steady');
  });

  it('everyday words: fast is quick, medium is steady, below is up, above is down, center is centre', () => {
    expect(ins('fast').length).toBeGreaterThan(0);
    expect(ins('fast').every((id) => id.endsWith('-quick'))).toBe(true);
    expect(ins('fast')).toContain('fade-quick');
    expect(ins('medium')).toContain('fade-steady');
    expect(ins('medium').every((id) => id.endsWith('-steady'))).toBe(true);
    expect(ins('from below')).toEqual(expect.arrayContaining(['slide-up-steady', 'wipe-up-steady']));
    expect(ins('from below')).not.toContain('slide-down-steady');
    expect(ins('from above')).toContain('slide-down-steady');
    expect(ins('from above')).not.toContain('slide-up-steady');
    expect(ins('fast from below')).toContain('slide-up-quick');
    expect(ins('fast from below').every((id) => id.endsWith('-quick'))).toBe(true);
    expect(ins('center')).toEqual(ins('centre'));
    expect(ins('centre')).toContain('open-centre-steady');
  });

  it('a feel: soft and calm find the gentle ones, bold the lively ones, elegant the reveals', () => {
    expect(ins('soft')).toEqual(
      expect.arrayContaining(['fade-steady', 'softwipe-left-steady', 'drift-left-steady']),
    );
    expect(ins('soft')).not.toContain('pop-steady');
    expect(ins('calm')).toEqual(ins('soft'));
    expect(ins('bold')).toEqual(expect.arrayContaining(['pop-steady', 'bounce-left-steady', 'zoom-steady']));
    expect(ins('bold')).not.toContain('fade-steady');
    expect(ins('elegant')).toContain('reveal-left-steady');
    expect(ins('elegant')).not.toContain('pop-steady');
  });

  it('a heading’s name finds what is under it: zoom finds Grow, flip finds Spin', () => {
    expect(ins('zoom')).toEqual(expect.arrayContaining(['zoom-steady', 'grow-steady']));
    expect(ins('flip')).toContain('spin-steady');
    expect(ins('letter by letter').every((id) => id.startsWith('letter-'))).toBe(true);
  });

  it('a way out is found by its name going out too', () => {
    expect(outs('slide out to the left')).toContain('slide-left-steady');
    expect(ins('backwards')).toEqual([]);
    expect(outs('backwards').length).toBeGreaterThan(0);
    expect(ins('zzzqqq')).toEqual([]);
    expect(outs('zzzqqq')).toEqual([]);
  });
});

describe('finding a template: its name, its look and its four tags as words', () => {
  it('nothing asked for is every one; its name finds it, in any case', () => {
    expect(findTemplates(LOWER_THIRD_TEMPLATES, '')).toEqual(LOWER_THIRD_TEMPLATES);
    expect(templates('news band')).toEqual(['news-band']);
    expect(templates('NEWS BAND')).toEqual(['news-band']);
    expect(templates('gold')).toContain('gold-underline');
  });

  it('the four filters are words now: its direction, kind, feel and speed, and their everyday words', () => {
    for (const t of LOWER_THIRD_TEMPLATES)
      expect(templates(`${t.direction} ${t.kind} ${t.feel} ${t.speed}`), t.id).toContain(t.id);
    expect(templates('news band left wipe bold steady')).toEqual(['news-band']);
    expect(templates('news band right')).toEqual([]);
    const up = LOWER_THIRD_TEMPLATES.filter((t) => t.direction === 'up').map((t) => t.id);
    expect(up.length).toBeGreaterThan(0);
    expect(templates('from below')).toEqual(up);
    const centre = LOWER_THIRD_TEMPLATES.filter((t) => t.direction === 'centre').map((t) => t.id);
    expect(templates('in the center')).toEqual(centre);
    const quick = LOWER_THIRD_TEMPLATES.filter((t) => t.speed === 'quick' || t.feel === 'quick');
    expect(templates('fast')).toEqual(quick.map((t) => t.id));
    expect(templates('soft')).toEqual(
      expect.arrayContaining(LOWER_THIRD_TEMPLATES.filter((t) => t.feel === 'calm').map((t) => t.id)),
    );
    expect(templates('soft')).toContain('pill');
  });

  it('its look: the style, the moving background, the font and its move’s own words (not its directions)', () => {
    const ribbons = LOWER_THIRD_TEMPLATES.filter((t) => t.input.look.style === 'ribbon').map((t) => t.id);
    expect(templates('ribbon')).toEqual(expect.arrayContaining(ribbons));
    const sparkles = LOWER_THIRD_TEMPLATES.filter((t) => t.input.look.motion === 'sparkles').map((t) => t.id);
    expect(sparkles.length).toBeGreaterThan(0);
    expect(templates('sparkles')).toEqual(expect.arrayContaining(sparkles));
    expect(templates('oswald')).toContain('news-band');
    // Glass fades in.
    expect(templates('fade')).toContain('glass');
    // News band wipes right, from the left: it is found by its own direction only.
    expect(templates('wipe right')).not.toContain('news-band');
  });
});

describe('quick words: one press puts a word in the box', () => {
  it('the Animation tab’s and the templates’ each find something, with plain names', () => {
    expect(ANIMATION_QUICK_WORDS.map((q) => q.name)).toEqual([
      'Fade',
      'Slide',
      'Wipe',
      'Reveal',
      'Zoom',
      'Letters',
      'Quick',
      'Slow',
    ]);
    for (const q of ANIMATION_QUICK_WORDS) expect(ins(q.word).length, q.word).toBeGreaterThan(0);
    expect(TEMPLATE_QUICK_WORDS.length).toBeGreaterThanOrEqual(6);
    for (const q of TEMPLATE_QUICK_WORDS) expect(templates(q.word).length, q.word).toBeGreaterThan(0);
    for (const q of [...ANIMATION_QUICK_WORDS, ...TEMPLATE_QUICK_WORDS])
      expect(q.name.toLowerCase()).toBe(q.word);
  });

  it('pressed: in the box; again: out; another of its kind takes the place of the one there', () => {
    const slide = quickWord(ANIMATION_QUICK_WORDS, 'slide');
    const wipe = quickWord(ANIMATION_QUICK_WORDS, 'wipe');
    const letters = quickWord(ANIMATION_QUICK_WORDS, 'letters');
    const slow = quickWord(ANIMATION_QUICK_WORDS, 'slow');
    const fast = quickWord(ANIMATION_QUICK_WORDS, 'quick');
    const all = ANIMATION_QUICK_WORDS;
    expect(toggleQuickWord('', slide, all)).toBe('slide');
    expect(toggleQuickWord('slide', wipe, all)).toBe('wipe');
    expect(toggleQuickWord('Slide ', slide, all)).toBe('');
    expect(toggleQuickWord('soft  slide', letters, all)).toBe('soft slide letters');
    expect(toggleQuickWord('letters slow', fast, all)).toBe('letters quick');
    expect(hasQuickWord('letters SLOW', slow)).toBe(true);
    expect(hasQuickWord('slo', slow)).toBe(false);
    const elegant = quickWord(TEMPLATE_QUICK_WORDS, 'elegant');
    const bold = quickWord(TEMPLATE_QUICK_WORDS, 'bold');
    expect(toggleQuickWord(toggleQuickWord('', elegant, TEMPLATE_QUICK_WORDS), bold, TEMPLATE_QUICK_WORDS)).toBe(
      'bold',
    );
  });
});
