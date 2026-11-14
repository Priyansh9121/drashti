import { describe, expect, it } from 'vitest';
import { contrastRatio, over } from './contrast';
import { animationById } from './lower-third-animations';
import { DESIGN_MOTIONS, isDesignMotion } from './lower-third-design-motions';
import { LOWER_THIRD_DESIGNS } from './lower-third-designs';
import { MORE_LOWER_THIRD_DESIGNS } from './lower-third-designs-more';
import { isOffered, OFFERED_MOTIONS, OFFERED_STYLES } from './lower-third-studio';
import { LOWER_THIRD_TEMPLATES } from './lower-third-templates';
import { lowerThirdInputSchema, shownLines } from './lower-thirds';

/*
 * The templates made since alpha.17 (Session 58, C14): after alpha.17's 50 (the studio's 10 and the 40 name-and-role
 * designs), part A's 18 with alpha.17's moving backgrounds and plain ones, in several layouts. Original designs,
 * placeholder words only, each made only of what the studio offers, its words easy to read on what they sit on, and
 * the gallery's words saying how it moves. Each is measured by the Performance check's lower-thirds-more scenario
 * (main/lower-thirds/perf-lower-thirds.ts) before it ships.
 */

const ALPHA17 = 50;
const ALPHA17_MOTIONS = ['sweep', 'shine', 'shapes', 'stripes', 'glow', 'line', 'sparkles'];
const PLACEHOLDER = /^(Placeholder|નમૂના|नमूना)/u;
const made = MORE_LOWER_THIRD_DESIGNS;
const templateOf = (id: string) => LOWER_THIRD_TEMPLATES.find((t) => t.id === id);
const linesOf = (d: (typeof made)[number]) =>
  shownLines(d.lines ?? ['Placeholder name', 'Placeholder role', '']);

describe('the templates made since alpha.17', () => {
  it('come after alpha.17’s 50 in the gallery: part A’s 18 first, every one offered', () => {
    expect(made.length).toBeGreaterThanOrEqual(18);
    expect(LOWER_THIRD_TEMPLATES).toHaveLength(ALPHA17 + made.length);
    expect(LOWER_THIRD_TEMPLATES.slice(ALPHA17).map((t) => t.id)).toEqual(made.map((d) => d.id));
    expect(new Set(LOWER_THIRD_TEMPLATES.map((t) => t.id)).size).toBe(LOWER_THIRD_TEMPLATES.length);
    expect(new Set(LOWER_THIRD_TEMPLATES.map((t) => t.name.toLowerCase())).size).toBe(
      LOWER_THIRD_TEMPLATES.length,
    );
    // None of alpha.17's designs is repeated as a new one.
    for (const d of made)
      expect(
        LOWER_THIRD_DESIGNS.some((old) => old.id === d.id),
        d.id,
      ).toBe(false);
  });

  it('part A: each of alpha.17’s seven moving backgrounds in one at least, plain ones, and the studio’s layouts', () => {
    const partA = made.slice(0, 18);
    const motions = new Set(partA.map((d) => d.look.motion ?? 'none'));
    for (const m of ALPHA17_MOTIONS) expect(motions, m).toContain(m);
    expect(partA.filter((d) => (d.look.motion ?? 'none') === 'none').length).toBeGreaterThanOrEqual(8);
    // A name and a role, three lines (a name, a title and a place), one line, a Gujarati name and a Hindi one.
    expect(partA.filter((d) => d.lines === undefined).length).toBeGreaterThanOrEqual(8);
    expect(partA.some((d) => linesOf(d).length === 3)).toBe(true);
    expect(partA.some((d) => linesOf(d).length === 1)).toBe(true);
    expect(partA.some((d) => linesOf(d)[0]?.startsWith('નમૂના'))).toBe(true);
    expect(partA.some((d) => linesOf(d)[0]?.startsWith('नमूना'))).toBe(true);
    // Calm and elegant first, for a mandir hall; a few bold and quick ones.
    const feels = partA.map((d) => d.feel);
    const count = (f: string) => feels.filter((x) => x === f).length;
    expect(count('calm') + count('elegant')).toBeGreaterThanOrEqual(10);
    expect(count('bold')).toBeGreaterThanOrEqual(2);
    expect(count('quick')).toBeGreaterThanOrEqual(2);
  });

  it('each is a lower third the library takes, with placeholder words only, made only of what the studio offers', () => {
    for (const d of made) {
      const t = templateOf(d.id);
      expect(t, d.id).toBeDefined();
      if (!t) continue;
      expect(lowerThirdInputSchema.safeParse(t.input).success, d.id).toBe(true);
      expect(shownLines(t.input.lines).length, d.id).toBeGreaterThan(0);
      for (const line of shownLines(t.input.lines)) expect(line, d.id).toMatch(PLACEHOLDER);
      expect(isDesignMotion(t.input.animation) || isOffered(t.input.animation), d.id).toBe(true);
      if (t.input.outAnimation) expect(isOffered(t.input.outAnimation), d.id).toBe(true);
      expect(OFFERED_STYLES, d.id).toContain(t.input.look.style ?? 'box');
      expect(OFFERED_MOTIONS, d.id).toContain(t.input.look.motion ?? 'none');
      // Its own look, as designed (nothing fell back).
      expect(t.input.animation, d.id).toBe(d.animation);
      expect(t.input.look, d.id).toMatchObject(d.look);
    }
  });

  it('each one’s words stand out 4.5 to 1 at least from what they sit on: its band, a second colour, a moving background', () => {
    for (const d of made) {
      const look = templateOf(d.id)?.input.look;
      expect(look, d.id).toBeDefined();
      if (!look || look.style === 'words' || look.style === 'glass') continue; // over the picture: a shadow, or glass
      const accent = look.accent ?? '#000000';
      const under = [look.band];
      // The second colour the words sit on: two colours' other lines, and the sweep's colours going by.
      if (look.style === 'split' || look.motion === 'sweep') under.push(accent);
      // A glow's colour and a shine's light at their strongest where the words are.
      if (look.motion === 'glow') under.push(over(accent, 0.6, look.band));
      if (look.motion === 'shine') under.push(over('#ffffff', 0.34, look.band));
      if (look.motion === 'shapes')
        under.push(over(accent, 0.3, look.band), over('#ffffff', 0.16, look.band));
      if (look.motion === 'stripes') under.push(over(accent, 0.28, look.band));
      expect(look.bandOpacity, d.id).toBeGreaterThanOrEqual(0.85);
      for (const colour of under)
        expect(contrastRatio(look.text, colour), `${d.id} on ${colour}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the gallery says how each moves: a design’s move its own way, another as given, each at its animation’s speed', () => {
    for (const d of made) {
      const t = templateOf(d.id);
      if (!t) continue;
      if (isDesignMotion(d.animation)) {
        const move = DESIGN_MOTIONS[d.animation];
        expect({ direction: t.direction, kind: t.kind, speed: t.speed }, d.id).toEqual({
          direction: move.direction,
          kind: move.kind,
          speed: move.speed,
        });
      } else {
        expect(d.direction, d.id).toBeDefined();
        expect(d.kind, d.id).toBeDefined();
        expect({ direction: t.direction, kind: t.kind }, d.id).toEqual({
          direction: d.direction,
          kind: d.kind,
        });
        expect(t.speed, d.id).toBe(animationById(d.animation).speed);
      }
      expect(t.feel, d.id).toBe(d.feel);
    }
  });
});
