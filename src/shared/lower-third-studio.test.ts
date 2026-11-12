import { describe, expect, it } from 'vitest';
import type { Pose } from './lower-third-animations';
import {
  animationById,
  animationFrame,
  animationLength,
  isAnimation,
  LOWER_THIRD_ANIMATIONS,
  REST,
  searchAnimations,
} from './lower-third-animations';
import { DESIGN_MOTIONS } from './lower-third-designs';
import { fontChoice, LOWER_THIRD_FONT_CHOICES, LOWER_THIRD_FONTS } from './lower-third-fonts';
import { STUDIO_BOX_MOVES, studioUnitMoves } from './lower-third-moves';
import {
  animationName,
  BEST_LOWER_THIRD_TEMPLATES,
  CATALOGUE,
  FAMILIES,
  familyOf,
  HIDE_AFTER,
  idFor,
  isOffered,
  LOWER_THIRD_TEMPLATES,
  OFFERED,
  OFFERED_ANIMATIONS,
  OFFERED_MOTIONS,
  OFFERED_STYLES,
  outName,
  searchOffered,
} from './lower-third-studio';
import {
  LOWER_THIRD_MOTIONS,
  LOWER_THIRD_STYLES,
  motionAt,
  MOTION_PERIOD_MS,
  motionPieces,
  styleDrawing,
} from './lower-third-styles';
import type { LowerThirdLook } from './lower-thirds';
import {
  DEFAULT_LOWER_THIRD_LOOK,
  lowerThirdInputSchema,
  lowerThirdLookSchema,
  lowerThirdSchema,
  NEW_LOWER_THIRD,
} from './lower-thirds';

/*
 * The Lower Thirds studio (Session 55, Part 16): many more animations in and out (slide, wipe, reveal, split,
 * bounce, typewriter, zoom, blur, letter by letter and others), moving backgrounds, styles the words sit in, more
 * fonts (open licences, Gujarati and Devanagari among them, bundled), and a lower third that hides itself after the
 * seconds chosen (R, 5 to 60). What the studio offers is one table (OFFERED): the Performance run's lower-thirds
 * scenario plays each of its rows, and one that is not smooth on a two-core computer without a graphics chip is
 * left out by deleting its row. Templates use placeholder words only. A lower third made before the studio draws
 * as it did.
 */

/** What a pose may set: numbers in range; the studio's moves may skew, clip to a circle or polygon, and blur. */
const TRANSFORM =
  /^((translate\(-?[\d.]+(%|em), -?[\d.]+(%|em)\)|scale\([\d.]+(, [\d.]+)?\)|rotate\(-?[\d.]+deg\)|skewX\(-?[\d.]+deg\)|perspective\(900px\) rotate[XY]\(-?[\d.]+deg\))( |$))*$/u;
const CLIP =
  /^(inset\((\d+(\.\d+)?% ){3}\d+(\.\d+)?%\)|circle\(\d+(\.\d+)?% at 50% 50%\)|polygon\((-?\d+(\.\d+)?% -?\d+(\.\d+)?%)(, -?\d+(\.\d+)?% -?\d+(\.\d+)?%)+\))?$/u;
const FILTER = /^blur\(\d+(\.\d+)?em\)$/u;

function valid(pose: Pose, what: string): void {
  expect(Number.isFinite(pose.opacity), what).toBe(true);
  expect(pose.opacity, what).toBeGreaterThanOrEqual(0);
  expect(pose.opacity, what).toBeLessThanOrEqual(1);
  expect(pose.transform, what).toMatch(TRANSFORM);
  expect(pose.clip, what).toMatch(CLIP);
  if (pose.filter !== undefined) expect(pose.filter, what).toMatch(FILTER);
  expect(`${pose.transform} ${pose.clip} ${pose.filter ?? ''}`, what).not.toMatch(/NaN|Infinity/u);
}

/** Nothing of it can be seen: see-through, clipped away, or flattened to nothing. */
function unseen(pose: Pose): boolean {
  if (pose.opacity === 0) return true;
  const inset = /^inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%\)$/u.exec(pose.clip);
  if (inset) {
    const [, top, right, bottom, left] = inset.map(Number);
    if ((top ?? 0) + (bottom ?? 0) >= 100 || (left ?? 0) + (right ?? 0) >= 100) return true;
  }
  if (pose.clip.startsWith('circle(0% ')) return true;
  return /scale\(0(, |\))|scale\([\d.]+, 0\)/u.test(pose.transform);
}

const studioIds = new Set([
  ...STUDIO_BOX_MOVES.flatMap((m) => ['quick', 'steady', 'slow'].map((s) => `${m.key}-${s}`)),
  ...(['line', 'word', 'letter'] as const).flatMap((unit) =>
    studioUnitMoves(unit).flatMap((m) =>
      ['band-fade', 'band-slide', 'band-wipe'].flatMap((band) =>
        ['quick', 'steady', 'slow'].map((s) => `${unit}-${m.key}-${band}-${s}`),
      ),
    ),
  ),
]);

describe('the studio’s animations', () => {
  it('add many more to the library, under 500 in all: blur, reveal, split, zoom, flip, gather, a circle, blinds, a diagonal wipe and a swoosh, as boxes and by lines, words and letters', () => {
    const studio = LOWER_THIRD_ANIMATIONS.filter((a) => studioIds.has(a.id));
    expect(studio.length).toBe(studioIds.size);
    expect(studio.length).toBeGreaterThanOrEqual(150);
    expect(LOWER_THIRD_ANIMATIONS.length).toBeLessThanOrEqual(500);
    const names = LOWER_THIRD_ANIMATIONS.map((a) => a.name);
    for (const name of [
      'Blur in',
      'Blur in from left',
      'Reveal up',
      'Reveal from the left',
      'Open as a circle',
      'Blinds',
      'Wipe diagonally from the left',
      'Swoosh in from right',
      'Stretch down',
      'Zoom from far away',
      'Blur in word by word',
      'Reveal line by line',
      'Split in line by line',
      'Split in word by word',
      'Zoom in letter by letter',
      'Flip in letter by letter',
      'Gather letter by letter',
      'Bounce in letter by letter',
      'Type word by word',
    ])
      expect(names, name).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    expect(searchAnimations('blur').length).toBeGreaterThan(20);
    expect(searchAnimations('reveal word').map((a) => a.name)).toContain('Reveal word by word');
  });

  it('every one at its first, middle and last frame, in and out: valid, starting unseen and ending at rest; only the blurs blur', () => {
    for (const id of studioIds) {
      const a = animationById(id);
      expect(a.id).toBe(id);
      for (const units of [1, 4, 40]) {
        for (const phase of ['in', 'out'] as const) {
          const length = animationLength(a, phase, units);
          for (const t of [0, length / 3, length / 2, length]) {
            const f = animationFrame(a, phase, t, units);
            const what = `${a.name}: ${phase} at ${String(t)} (${String(units)})`;
            valid(f.box, what);
            for (let i = 0; i < units; i++) valid(f.unit(i), `${what}, unit ${String(i)}`);
            if (!/blur/iu.test(a.name)) {
              expect(f.box.filter, what).toBeUndefined();
              expect(f.unit(0).filter, what).toBeUndefined();
            }
          }
        }
        const what = `${a.name} (${String(units)})`;
        const first = animationFrame(a, 'in', 0, units);
        expect(
          unseen(first.box) || Array.from({ length: units }, (_, i) => first.unit(i)).every(unseen),
          what,
        ).toBe(true);
        const last = animationFrame(a, 'in', animationLength(a, 'in', units), units);
        expect(last.box, what).toEqual(REST);
        for (let i = 0; i < units; i++) expect(last.unit(i), `${what} unit ${String(i)}`).toEqual(REST);
        const gone = animationFrame(a, 'out', animationLength(a, 'out', units), units);
        expect(
          unseen(gone.box) || Array.from({ length: units }, (_, i) => gone.unit(i)).every(unseen),
          what,
        ).toBe(true);
      }
    }
  });

  it('split brings every other line in from the other side; gather brings each letter from a place of its own, the same each time', () => {
    const split = animationById('line-split-band-fade-steady');
    const t = animationLength(split, 'in', 2) * 0.45;
    const f = animationFrame(split, 'in', t, 2);
    const x = (pose: Pose) => Number(/translate\((-?[\d.]+)em/u.exec(pose.transform)?.[1] ?? 0);
    expect(Math.sign(x(f.unit(0)))).toBe(-Math.sign(x(f.unit(1))));
    const gather = animationById('letter-gather-band-fade-steady');
    const g = (at: number) => animationFrame(gather, 'in', at, 12);
    const mid = animationLength(gather, 'in', 12) / 2;
    expect(g(mid).unit(3)).toEqual(g(mid).unit(3));
    expect(g(mid).unit(3).transform).not.toBe(g(mid).unit(4).transform);
  });
});

describe('the offered set: one table', () => {
  it('names only what the library has, each once; the studio knows slide, wipe, reveal, split, bounce, typewriter, zoom, blur and letter by letter, band, box, pill, ribbon, outline, glass and two colours, and a gradient sweeping, light passing over and shapes', () => {
    for (const row of OFFERED) {
      if (row.kind === 'animation')
        expect(
          LOWER_THIRD_ANIMATIONS.some((a) => familyOf(a) === row.family),
          row.family,
        ).toBe(true);
      if (row.kind === 'background') expect(LOWER_THIRD_MOTIONS, row.key).toContain(row.key);
      if (row.kind === 'style') expect(LOWER_THIRD_STYLES, row.key).toContain(row.key);
    }
    const rows = OFFERED.map((r) => `${r.kind}:${r.kind === 'animation' ? r.family : r.key}`);
    expect(new Set(rows).size).toBe(rows.length);
    for (const r of OFFERED)
      if (r.kind === 'animation')
        expect(
          FAMILIES.map((f) => f.family),
          r.family,
        ).toContain(r.family);
    // What the studio knows (a row left out of OFFERED after the Performance run changes none of this).
    const known = new Set(FAMILIES.map((f) => f.family));
    const names = LOWER_THIRD_ANIMATIONS.filter((a) => known.has(familyOf(a))).map((a) =>
      a.name.toLowerCase(),
    );
    for (const word of [
      'slide',
      'wipe',
      'reveal',
      'split',
      'bounce',
      'type',
      'zoom',
      'blur',
      'letter by letter',
    ])
      expect(
        names.some((n) => n.includes(word)),
        word,
      ).toBe(true);
    expect(LOWER_THIRD_STYLES).toEqual(
      expect.arrayContaining(['band', 'box', 'pill', 'ribbon', 'outline', 'glass', 'split']),
    );
    expect(LOWER_THIRD_MOTIONS).toEqual(expect.arrayContaining(['sweep', 'shine', 'shapes']));
    // Every animation of the library is in a family the studio knows.
    for (const a of LOWER_THIRD_ANIMATIONS) expect(known.has(familyOf(a)), a.id).toBe(true);
    // Offered: what the table has, and no more.
    for (const s of OFFERED_STYLES) expect(OFFERED).toContainEqual({ kind: 'style', key: s });
    for (const m of OFFERED_MOTIONS.filter((x) => x !== 'none'))
      expect(OFFERED).toContainEqual({ kind: 'background', key: m });
    expect(OFFERED_MOTIONS[0]).toBe('none');
    expect(searchOffered('').length).toBe(OFFERED_ANIMATIONS.length);
    for (const o of searchOffered('fade')) expect(o.animation.name.toLowerCase()).toContain('fade');
  });

  it('a family left out of the table is not offered, but a lower third that has it still draws it', () => {
    const offered = new Set(OFFERED_ANIMATIONS.map((a) => a.id));
    for (const a of OFFERED_ANIMATIONS) expect(isAnimation(a.id)).toBe(true);
    // Every offered animation is one of an offered family; every animation of the library can be drawn.
    for (const a of LOWER_THIRD_ANIMATIONS) {
      const row = OFFERED.find((r) => r.kind === 'animation' && r.family === familyOf(a));
      expect(offered.has(a.id), a.id).toBe(isOffered(a.id));
      if (row === undefined) expect(offered.has(a.id), a.id).toBe(false);
      expect(animationById(a.id).id).toBe(a.id);
    }
  });

  it('the catalogue makes each family’s ids from its choices (direction, speed, how the band comes in), and names each in and out plainly', () => {
    expect(CATALOGUE.length).toBeGreaterThan(5);
    for (const group of CATALOGUE)
      for (const family of group.families) {
        for (const direction of family.directions ?? [null])
          for (const speed of ['quick', 'steady', 'slow'] as const)
            for (const band of family.unit === 'box' ? [null] : (['fade', 'slide', 'wipe'] as const)) {
              const id = idFor(family, { direction, speed, band });
              expect(isAnimation(id), id).toBe(true);
              expect(familyOf(animationById(id))).toBe(family.family);
            }
      }
    expect(animationName('slide-left-steady')).toBe('Slide in from left');
    expect(outName('slide-left-steady')).toBe('Slide out to the left');
    expect(outName('fade-quick')).toBe('Fade out, quick');
    expect(outName('blur-right-slow')).toBe('Blur out to the right, slow');
    expect(outName('word-fade-band-slide-steady')).toBe('Fade out word by word, band slides out');
    expect(outName('line-slide-left-band-fade-quick')).toBe('Slide out line by line to the left, quick');
    expect(outName('blinds-quick')).toBe('Blinds, backwards, quick');
    expect(outName('letter-type-band-fade-steady')).toBe('Type letter by letter, backwards');
    const outs = OFFERED_ANIMATIONS.map((a) => outName(a.id));
    expect(new Set(outs).size).toBe(outs.length);
  });
});

describe('styles and moving backgrounds', () => {
  const look = (more: Partial<LowerThirdLook>): LowerThirdLook => ({ ...DEFAULT_LOWER_THIRD_LOOK, ...more });

  it('a lower third made before the studio is a box, drawn as before: its band’s colour as solid as it was, its corners just rounded', () => {
    const d = styleDrawing(DEFAULT_LOWER_THIRD_LOOK, 50);
    expect(d.style).toBe('box');
    expect(d.fill).toBe('band');
    expect(d.shape['background']).toBe('#101828d9');
    expect(d.shape['borderRadius']).toBe(6);
    expect(d.band['padding']).toBe('15px 30px');
    expect(d.fullWidth).toBe(false);
  });

  it('each style draws its own way: a band across the picture, a pill, a ribbon’s ends, an outline, glass, two colours, an accent bar', () => {
    const all = LOWER_THIRD_STYLES.map((style) => styleDrawing(look({ style, accent: '#ff9900' }), 50));
    expect(new Set(all.map((d) => JSON.stringify(d))).size).toBe(LOWER_THIRD_STYLES.length);
    expect(styleDrawing(look({ style: 'band' }), 50).fullWidth).toBe(true);
    expect(styleDrawing(look({ style: 'pill' }), 50).shape['borderRadius']).toBe(9999);
    expect(String(styleDrawing(look({ style: 'ribbon' }), 50).shape['clipPath'])).toMatch(/^polygon\(/u);
    expect(String(styleDrawing(look({ style: 'outline', accent: '#ff9900' }), 50).shape['border'])).toContain(
      '#ff9900',
    );
    const split = styleDrawing(look({ style: 'split', accent: '#ff9900' }), 50);
    expect(split.fill).toBe('lines');
    expect(split.line(0)['background']).not.toBe(split.line(1)['background']);
    expect(String(split.line(1)['background'])).toContain('#ff9900');
    expect(styleDrawing(look({ style: 'accent', accent: '#ff9900' }), 50).accent).not.toBeNull();
    // Nothing of them blurs what is behind (no backdrop filter), however glassy.
    for (const d of all) expect(JSON.stringify(d)).not.toMatch(/backdrop|filter|blur/iu);
  });

  it('each moving background is a few pieces moving by transform and opacity only, the same at the same time, round and round', () => {
    for (const motion of LOWER_THIRD_MOTIONS) {
      const pieces = motionPieces(motion, look({ motion, accent: '#ff9900' }));
      if (motion === 'none') {
        expect(pieces).toEqual([]);
        continue;
      }
      expect(pieces.length, motion).toBeGreaterThan(0);
      expect(pieces.length, motion).toBeLessThanOrEqual(12);
      const period = MOTION_PERIOD_MS[motion];
      expect(period, motion).toBeGreaterThan(500);
      for (const t of [0, 123, period / 3, period / 2, period - 1, 5 * period + 77]) {
        const at = motionAt(motion, t, pieces.length);
        expect(at, motion).toHaveLength(pieces.length);
        for (const p of at) {
          expect(p.transform, `${motion} at ${String(t)}`).toMatch(TRANSFORM);
          expect(p.opacity).toBeGreaterThanOrEqual(0);
          expect(p.opacity).toBeLessThanOrEqual(1);
        }
        expect(motionAt(motion, t, pieces.length)).toEqual(at);
        const later = motionAt(motion, t + period, pieces.length);
        for (const [i, p] of later.entries()) {
          expect(p.opacity).toBeCloseTo(at[i]?.opacity ?? -1, 6);
          expect(p.transform.replace(/-?0\.000\b/gu, '0')).toBe(
            (at[i]?.transform ?? '').replace(/-?0\.000\b/gu, '0'),
          );
        }
      }
      for (const piece of pieces) expect(JSON.stringify(piece)).not.toMatch(/filter|blur|backdrop/iu);
    }
  });
});

describe('fonts', () => {
  it('more fonts, Gujarati and Devanagari among them, each in the table with its weights; the old three as they were', () => {
    expect(LOWER_THIRD_FONTS.slice(0, 3)).toEqual([
      'Noto Sans',
      'Noto Sans Gujarati',
      'Noto Sans Devanagari',
    ]);
    expect(LOWER_THIRD_FONTS.length).toBeGreaterThanOrEqual(10);
    expect(LOWER_THIRD_FONT_CHOICES.map((f) => f.name)).toEqual([...LOWER_THIRD_FONTS]);
    const scripts = (s: 'gujarati' | 'devanagari') =>
      LOWER_THIRD_FONT_CHOICES.filter((f) => f.bundled === 'studio' && f.scripts.includes(s)).length;
    expect(scripts('gujarati')).toBeGreaterThanOrEqual(3);
    expect(scripts('devanagari')).toBeGreaterThanOrEqual(3);
    expect(fontChoice('Mukta').families).toEqual(['Mukta', 'Mukta Vaani']);
    expect(fontChoice('No such font').name).toBe('Noto Sans');
    for (const f of LOWER_THIRD_FONT_CHOICES) expect(f.weights.length, f.name).toBeGreaterThan(0);
  });
});

describe('the model: a lower third that hides itself, its out, its style', () => {
  it('a lower third made before the studio is read whole, as it was', () => {
    const old = { ...NEW_LOWER_THIRD, lines: ['Placeholder name', '', ''] };
    expect(lowerThirdInputSchema.parse(old)).toEqual(old);
    expect(lowerThirdLookSchema.parse(DEFAULT_LOWER_THIRD_LOOK)).toEqual(DEFAULT_LOWER_THIRD_LOOK);
  });

  it('takes a style, an accent, a moving background, a font of the studio’s, an out of its own and 5 to 60 seconds', () => {
    const made = {
      ...NEW_LOWER_THIRD,
      lines: ['Placeholder name', 'Placeholder title', ''],
      look: {
        ...DEFAULT_LOWER_THIRD_LOOK,
        style: 'pill' as const,
        accent: '#ff9900',
        motion: 'shine' as const,
        font: 'Mukta' as const,
      },
      animation: 'reveal-up-steady',
      outAnimation: 'blur-quick',
      seconds: 10,
    };
    expect(lowerThirdInputSchema.parse(made)).toEqual(made);
    expect(lowerThirdSchema.safeParse({ id: 'a', ...made }).success).toBe(true);
    for (const seconds of [HIDE_AFTER.min, HIDE_AFTER.max])
      expect(lowerThirdInputSchema.safeParse({ ...made, seconds }).success, String(seconds)).toBe(true);
    for (const seconds of [4, 61, 7.5, 0])
      expect(lowerThirdInputSchema.safeParse({ ...made, seconds }).success, String(seconds)).toBe(false);
    expect(lowerThirdInputSchema.safeParse({ ...made, outAnimation: 'no-such' }).success).toBe(false);
    expect(
      lowerThirdInputSchema.safeParse({ ...made, look: { ...made.look, style: 'no-such' } }).success,
    ).toBe(false);
    expect(
      lowerThirdInputSchema.safeParse({ ...made, look: { ...made.look, accent: 'orange' } }).success,
    ).toBe(false);
  });

  it('classifies templates by the motion they show and the feel they offer', () => {
    expect(LOWER_THIRD_TEMPLATES.find((t) => t.id === 'news-band')).toMatchObject({
      direction: 'right',
      kind: 'wipe',
      feel: 'bold',
      speed: 'steady',
    });
    expect(LOWER_THIRD_TEMPLATES.find((t) => t.id === 'outline')).toMatchObject({
      direction: 'centre',
      kind: 'letters',
      feel: 'calm',
      speed: 'steady',
    });
  });

  it('animates the design accent, panel, name and role at different times', () => {
    const template = LOWER_THIRD_TEMPLATES.find((t) => t.id === 'gold-underline');
    expect(template).toBeDefined();
    const animation = animationById(template?.input.animation ?? '');
    const length = animationLength(animation, 'in', 2);
    const out = animationLength(animation, 'out', 2);
    const beginning = animationFrame(animation, 'in', 0, 2);
    const accentOnly = animationFrame(animation, 'in', length * 0.15, 2);
    const nameBeforeRole = animationFrame(animation, 'in', length * 0.5, 2);
    const atRest = animationFrame(animation, 'in', length, 2);
    expect(beginning).toMatchObject({ accent: { opacity: 0 }, panel: { opacity: 0 } });
    expect(accentOnly).toMatchObject({ accent: { opacity: 1 } });
    expect(accentOnly.unit(0).opacity).toBe(0);
    expect(nameBeforeRole.unit(0).opacity).toBeGreaterThan(0);
    expect(nameBeforeRole.unit(0).transform).toContain('translate');
    expect(nameBeforeRole.unit(1).opacity).toBe(0);
    expect(atRest).toMatchObject({ accent: REST, panel: REST });
    expect(atRest.unit(0)).toEqual(REST);
    expect(atRest.unit(1)).toEqual(REST);
    const leaving = animationFrame(animation, 'out', out * 0.5, 2);
    expect(leaving.unit(0)).toEqual(nameBeforeRole.unit(0));
    expect(leaving.unit(1).opacity).toBe(0);
    const gone = animationFrame(animation, 'out', out, 2);
    expect(gone).toMatchObject({ accent: { opacity: 0 }, panel: { opacity: 0 } });
    expect(gone.unit(0).opacity).toBe(0);
  });

  it('offers twenty curated templates and covers the picker’s directions, feels and speeds', () => {
    expect(BEST_LOWER_THIRD_TEMPLATES).toHaveLength(20);
    expect(new Set(BEST_LOWER_THIRD_TEMPLATES.map((template) => template.id)).size).toBe(20);
    expect(new Set(LOWER_THIRD_TEMPLATES.map((template) => template.direction))).toEqual(
      new Set(['left', 'right', 'up', 'down', 'centre']),
    );
    expect(new Set(LOWER_THIRD_TEMPLATES.map((template) => template.feel))).toEqual(
      new Set(['quick', 'elegant', 'bold', 'calm']),
    );
    expect(new Set(LOWER_THIRD_TEMPLATES.map((template) => template.speed))).toEqual(
      new Set(['quick', 'steady', 'slow']),
    );
  });

  it('templates use placeholder words only, each a lower third the library takes, from what is offered', () => {
    expect(LOWER_THIRD_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const offeredIds = new Set([...OFFERED_ANIMATIONS.map((a) => a.id), ...Object.keys(DESIGN_MOTIONS)]);
    for (const t of LOWER_THIRD_TEMPLATES) {
      expect(lowerThirdInputSchema.safeParse(t.input).success, t.name).toBe(true);
      for (const line of t.input.lines.filter((l) => l.trim() !== ''))
        expect(line, t.name).toMatch(/^(Placeholder|નમૂના|नमूना)/u);
      expect(offeredIds.has(t.input.animation), t.name).toBe(true);
      if (t.input.outAnimation) expect(offeredIds.has(t.input.outAnimation), t.name).toBe(true);
      expect(OFFERED_STYLES, t.name).toContain(t.input.look.style ?? 'box');
      if (t.input.look.motion) expect(OFFERED_MOTIONS, t.name).toContain(t.input.look.motion);
    }
    expect(new Set(LOWER_THIRD_TEMPLATES.map((t) => t.name)).size).toBe(LOWER_THIRD_TEMPLATES.length);
  });
});
