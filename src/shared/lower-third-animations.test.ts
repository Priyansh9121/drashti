import { describe, expect, it } from 'vitest';
import type { AnimationFrame, Pose } from './lower-third-animations';
import {
  animationById,
  animationFrame,
  animationLength,
  cutIntoUnits,
  DEFAULT_ANIMATION,
  isAnimation,
  LOWER_THIRD_ANIMATIONS,
  REST,
  searchAnimations,
} from './lower-third-animations';
import { lowerThirdInputSchema, NEW_LOWER_THIRD } from './lower-thirds';

/*
 * The lower thirds' animations (Session 44): 200 to 500 of them, each with a plain name of its own, found by
 * those words; every one drawn at its first, middle and last frame, in and out, with only opacity, transform
 * and clip-path, ending where it should: in, at rest; out, gone.
 */

/** What a pose may set: numbers in range, and only these transforms and a rectangle's clip. */
const TRANSFORM =
  /^((translate\(-?[\d.]+(%|em), -?[\d.]+(%|em)\)|scale\([\d.]+(, [\d.]+)?\)|rotate\(-?[\d.]+deg\)|perspective\(900px\) rotate[XY]\(-?[\d.]+deg\))( |$))*$/u;
const CLIP = /^(inset\((\d+(\.\d+)?% ){3}\d+(\.\d+)?%\))?$/u;

function valid(pose: Pose, what: string): void {
  expect(Number.isFinite(pose.opacity), what).toBe(true);
  expect(pose.opacity, what).toBeGreaterThanOrEqual(0);
  expect(pose.opacity, what).toBeLessThanOrEqual(1);
  expect(pose.transform, what).toMatch(TRANSFORM);
  expect(pose.clip, what).toMatch(CLIP);
  expect(`${pose.transform} ${pose.clip}`, what).not.toMatch(/blur|filter|NaN|Infinity/u);
}

/** Nothing of it can be seen: see-through, clipped away, or flattened to nothing. */
function unseen(pose: Pose): boolean {
  if (pose.opacity === 0) return true;
  const clip = /^inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%\)$/u.exec(pose.clip);
  if (clip) {
    const [, top, right, bottom, left] = clip.map(Number);
    if ((top ?? 0) + (bottom ?? 0) >= 100 || (left ?? 0) + (right ?? 0) >= 100) return true;
  }
  return /scale\(0(, |\))|scale\([\d.]+, 0\)/u.test(pose.transform);
}

const frameAt = (
  id: string,
  phase: 'in' | 'out',
  at: 'first' | 'middle' | 'last',
  units: number,
): AnimationFrame => {
  const a = animationById(id);
  const length = animationLength(a, phase, units);
  return animationFrame(a, phase, at === 'first' ? 0 : at === 'middle' ? length / 2 : length, units);
};

describe('the lower thirds’ animations', () => {
  it('are 200 to 500, each with an id and a name of its own; the default is one of them', () => {
    const all = LOWER_THIRD_ANIMATIONS;
    console.info(`${String(all.length)} animations`);
    expect(all.length).toBeGreaterThanOrEqual(200);
    expect(all.length).toBeLessThanOrEqual(500);
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    expect(new Set(all.map((a) => a.name)).size).toBe(all.length);
    expect(isAnimation(DEFAULT_ANIMATION)).toBe(true);
    // Plain names that say what they do.
    for (const name of [
      'Fade in',
      'Slide in from left',
      'Wipe up',
      'Type letter by letter',
      'Pop in',
      'Bounce up',
    ])
      expect(
        all.map((a) => a.name),
        name,
      ).toContain(name);
    // From every move: fade, slide, wipe, reveal, scale, flip, rotate, and lines, words and letters.
    for (const word of [
      'Fade',
      'Slide',
      'Wipe',
      'Open',
      'Grow',
      'Flip',
      'Turn',
      'line by line',
      'word by word',
      'letter by letter',
    ])
      expect(
        all.some((a) => a.name.includes(word)),
        word,
      ).toBe(true);
  });

  it('every one at its first, middle and last frame, in and out, for one line, a few words and many letters: only opacity, transform and clip-path, starting hidden and ending where it should', () => {
    for (const a of LOWER_THIRD_ANIMATIONS)
      for (const units of [1, 4, 40]) {
        for (const phase of ['in', 'out'] as const)
          for (const at of ['first', 'middle', 'last'] as const) {
            const f = frameAt(a.id, phase, at, units);
            const what = `${a.name}: ${phase} ${at} (${String(units)})`;
            valid(f.box, what);
            for (let i = 0; i < units; i++) valid(f.unit(i), `${what}, unit ${String(i)}`);
          }
        const what = `${a.name} (${String(units)})`;
        // In: from nothing seen, to at rest.
        const first = frameAt(a.id, 'in', 'first', units);
        expect(
          unseen(first.box) || Array.from({ length: units }, (_, i) => first.unit(i)).every(unseen),
          what,
        ).toBe(true);
        const last = frameAt(a.id, 'in', 'last', units);
        expect(last.box, what).toEqual(REST);
        for (let i = 0; i < units; i++) expect(last.unit(i), `${what} unit ${String(i)}`).toEqual(REST);
        // Out: the in played backwards, from at rest to nothing seen.
        const outFirst = frameAt(a.id, 'out', 'first', units);
        expect(outFirst.box, what).toEqual(REST);
        const gone = frameAt(a.id, 'out', 'last', units);
        expect(
          unseen(gone.box) || Array.from({ length: units }, (_, i) => gone.unit(i)).every(unseen),
          what,
        ).toBe(true);
        // The out is a little quicker than the in.
        expect(animationLength(a, 'out', units)).toBeLessThan(animationLength(a, 'in', units));
      }
  });

  it('types letter by letter: part-way, the first letters are there and the last are not', () => {
    const a = animationById('letter-type-band-fade-steady');
    expect(a.name).toBe('Type letter by letter');
    const f = animationFrame(a, 'in', animationLength(a, 'in', 20) / 2, 20);
    expect(f.unit(0).opacity).toBe(1);
    expect(f.unit(19).opacity).toBe(0);
  });

  it('finds them by their words: "fade", "slide left", "bounce"; nothing asked is all of them; nothing found is none', () => {
    const names = (q: string) => searchAnimations(q).map((a) => a.name);
    expect(names('fade').length).toBeGreaterThan(10);
    expect(names('fade')).toContain('Fade in');
    expect(names('slide left')).toEqual(
      expect.arrayContaining(['Slide in from left', 'Slide in line by line from left']),
    );
    expect(names('slide left')).not.toContain('Slide in from right');
    expect(names('bounce')).toEqual(expect.arrayContaining(['Bounce up', 'Bounce in from left', 'Pop in']));
    expect(names('typewriter')).toContain('Type letter by letter');
    expect(names('BOUNC')).toEqual(names('bounce'));
    expect(searchAnimations('')).toHaveLength(LOWER_THIRD_ANIMATIONS.length);
    expect(searchAnimations('zzzqqq')).toEqual([]);
  });

  it('cuts lines into what moves: words by the language’s own rules, letters as clusters', () => {
    const word = animationById('word-fade-band-fade-steady');
    expect(cutIntoUnits(['Placeholder name', 'નમૂના નામ'], word).units).toBe(4);
    const letter = animationById('letter-fade-band-fade-steady');
    expect(cutIntoUnits(['ab c'], letter).units).toBe(3);
    // A letter with its vowel sign is one cluster: never split.
    expect(cutIntoUnits(['કૂ'], letter).units).toBe(1);
    expect(cutIntoUnits(['Placeholder', 'name'], animationById('line-rise-band-fade-steady')).units).toBe(2);
    expect(cutIntoUnits(['Placeholder'], animationById('fade-steady')).units).toBe(0);
  });

  it('a new lower third is kept only with words, a look and an animation from the library', () => {
    expect(
      lowerThirdInputSchema.safeParse({ ...NEW_LOWER_THIRD, lines: ['Placeholder name', '', ''] }).success,
    ).toBe(true);
    expect(lowerThirdInputSchema.safeParse(NEW_LOWER_THIRD).success).toBe(false);
    expect(
      lowerThirdInputSchema.safeParse({ ...NEW_LOWER_THIRD, lines: ['Placeholder'], animation: 'no-such' })
        .success,
    ).toBe(false);
    expect(
      lowerThirdInputSchema.safeParse({
        ...NEW_LOWER_THIRD,
        lines: ['Placeholder'],
        look: { ...NEW_LOWER_THIRD.look, size: 40 },
      }).success,
    ).toBe(false);
  });
});
