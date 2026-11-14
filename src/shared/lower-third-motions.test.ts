import { describe, expect, it } from 'vitest';
import { OFFERED, OFFERED_MOTIONS } from './lower-third-studio';
import {
  FIRST_MOTIONS,
  LOWER_THIRD_MOTIONS,
  type LowerThirdMotion,
  motionAt,
  MOTION_FEEL,
  motionIsFill,
  MOTION_NAMES,
  MOTION_PERIOD_MS,
  motionPieces,
  type PiecePose,
} from './lower-third-styles';
import type { LowerThirdLook } from './lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK, lowerThirdLookSchema } from './lower-thirds';

/*
 * The Lower Thirds studio's moving backgrounds (Session 58, alpha.18): the studio's first seven as they were, and
 * twelve more, the studio's own designs, calm ones first (slow light, soft colours, gentle shapes) and a few livelier:
 * each with a plain name, its loop, a few pieces in the lower third's two colours and white, moved by transform and
 * opacity only, never jumping where its loop comes round. (lower-third-studio.test.ts checks every background's
 * limits: pieces, loops, transforms, opacity.)
 */

const look = (more: Partial<LowerThirdLook> = {}): LowerThirdLook => ({
  ...DEFAULT_LOWER_THIRD_LOOK,
  ...more,
});

/** The twelve (Session 58), by key: their names in the studio's list and how they feel. */
const TWELVE: Record<string, { name: string; feel: 'calm' | 'lively' }> = {
  dawn: { name: 'Light rising', feel: 'calm' },
  lamps: { name: 'Lamps glowing', feel: 'calm' },
  mist: { name: 'Mist drifting', feel: 'calm' },
  rays: { name: 'Rays of light', feel: 'calm' },
  petals: { name: 'Petals falling', feel: 'calm' },
  ripples: { name: 'Ripples spreading', feel: 'calm' },
  stars: { name: 'Stars twinkling', feel: 'calm' },
  tint: { name: 'Colours changing gently', feel: 'calm' },
  confetti: { name: 'Confetti falling', feel: 'lively' },
  streaks: { name: 'Streaks of light', feel: 'lively' },
  waves: { name: 'Waves rolling', feel: 'lively' },
  chase: { name: 'Lights chasing', feel: 'lively' },
};
const twelve = Object.keys(TWELVE) as LowerThirdMotion[];

/** A transform's parts: each function's name and numbers. */
function parts(transform: string): { fn: string; args: number[]; unit: string }[] {
  return [...transform.matchAll(/(\w+)\(([^)]*)\)/gu)].map((m) => ({
    fn: m[1] ?? '',
    args: (m[2] ?? '').split(',').map((a) => Number.parseFloat(a)),
    unit: /(%|em|deg)/u.exec(m[2] ?? '')?.[1] ?? '',
  }));
}

/** A transform's move, scale and turn, as numbers (none: 0, 1 and 0). */
function pose(p: PiecePose): { x: number; y: number; unit: string; sx: number; sy: number; deg: number } {
  const out = { x: 0, y: 0, unit: '', sx: 1, sy: 1, deg: 0 };
  for (const { fn, args, unit } of parts(p.transform)) {
    if (fn === 'translate') Object.assign(out, { x: args[0] ?? 0, y: args[1] ?? 0, unit });
    if (fn === 'scale') Object.assign(out, { sx: args[0] ?? 1, sy: args[1] ?? args[0] ?? 1 });
    if (fn === 'rotate') out.deg = args[0] ?? 0;
  }
  return out;
}

/** How far a turn goes, the short way round. */
const turnBetween = (a: number, b: number): number => {
  const d = (((b - a) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
};

/** Every colour a background's CSS names, as written. */
const colours = (css: string): string[] => css.match(/#[0-9a-f]{6}([0-9a-f]{2})?|rgba?\([^)]*\)/giu) ?? [];

describe('the moving backgrounds: the registry', () => {
  it('the studio’s first seven as they were (names, loops, the sweep the colour itself), and twelve more, each with its plain name: thirty at most, every name its own', () => {
    expect(LOWER_THIRD_MOTIONS[0]).toBe('none');
    expect(MOTION_NAMES.none).toBe('None');
    expect(FIRST_MOTIONS).toEqual(['sweep', 'shine', 'shapes', 'stripes', 'glow', 'line', 'sparkles']);
    expect(FIRST_MOTIONS.map((m) => [MOTION_NAMES[m], MOTION_PERIOD_MS[m]])).toEqual([
      ['Colours sweeping', 6000],
      ['Light passing over', 4000],
      ['Shapes drifting', 12_000],
      ['Stripes moving', 1600],
      ['Glowing', 3000],
      ['A line running', 2400],
      ['Sparkles rising', 4000],
    ]);
    expect(LOWER_THIRD_MOTIONS.filter(motionIsFill)).toEqual(['sweep']);
    for (const [key, { name, feel }] of Object.entries(TWELVE)) {
      expect(LOWER_THIRD_MOTIONS, key).toContain(key);
      expect(MOTION_NAMES[key as LowerThirdMotion], key).toBe(name);
      expect(MOTION_FEEL[key as LowerThirdMotion], key).toBe(feel);
    }
    const backgrounds = LOWER_THIRD_MOTIONS.filter((m) => m !== 'none');
    expect(backgrounds.length).toBeGreaterThanOrEqual(19);
    expect(backgrounds.length).toBeLessThanOrEqual(30);
    const names = LOWER_THIRD_MOTIONS.map((m) => MOTION_NAMES[m]);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(LOWER_THIRD_MOTIONS).size).toBe(LOWER_THIRD_MOTIONS.length);
    // Plain words: a capital first, no colons, brackets or numbers.
    for (const name of names) expect(name).toMatch(/^[A-Z][a-z]*( [a-z]+)*$/u);
    // Calm ones are most of them, for a hall.
    expect(twelve.filter((m) => MOTION_FEEL[m] === 'calm').length).toBeGreaterThanOrEqual(8);
  });

  it('a lower third keeps any of them (its look is saved and read back), and one with a key Drashti does not know is refused, never drawn wrong', () => {
    for (const motion of LOWER_THIRD_MOTIONS)
      expect(lowerThirdLookSchema.safeParse(look({ motion })).success, motion).toBe(true);
    expect(lowerThirdLookSchema.safeParse({ ...look(), motion: 'fireworks' }).success).toBe(false);
    expect(motionPieces('fireworks' as LowerThirdMotion, look())).toEqual([]);
    expect(motionAt('fireworks' as LowerThirdMotion, 500, 3)).toEqual([]);
    expect(motionIsFill('fireworks' as LowerThirdMotion)).toBe(false);
  });

  it('the studio offers each of the twelve, None first, then the calm ones, then the lively ones', () => {
    for (const key of twelve) expect(OFFERED).toContainEqual({ kind: 'background', key });
    expect(OFFERED_MOTIONS[0]).toBe('none');
    const feels = OFFERED_MOTIONS.slice(1).map((m) => MOTION_FEEL[m]);
    expect(feels.indexOf('lively')).toBeGreaterThan(0);
    expect(feels.slice(feels.indexOf('lively'))).not.toContain('calm');
    expect(new Set(OFFERED_MOTIONS).size).toBe(OFFERED_MOTIONS.length);
  });
});

describe('the twelve', () => {
  it('each is a few pieces in the lower third’s two colours and white, none of them a filter, a blur, a shadow or an animation of its own; calm ones loop slowly, lively ones more quickly', () => {
    const coloured = look({ band: '#123456', accent: '#ff9900', bandOpacity: 0.8 });
    for (const motion of twelve) {
      const pieces = motionPieces(motion, coloured);
      expect(pieces.length, motion).toBeGreaterThanOrEqual(1);
      expect(pieces.length, motion).toBeLessThanOrEqual(12);
      const css = JSON.stringify(pieces);
      expect(css, motion).not.toMatch(/filter|blur|shadow|backdrop|animation|transition|will-change|mask/iu);
      for (const c of colours(css))
        expect(c, `${motion}: ${c}`).toMatch(
          /^(#123456|#ff9900)([0-9a-f]{2})?$|^rgba\(255, 255, 255, (0|0?\.\d+|1)\)$/u,
        );
      const period = MOTION_PERIOD_MS[motion];
      if (MOTION_FEEL[motion] === 'calm') expect(period, motion).toBeGreaterThanOrEqual(6000);
      else expect(period, motion).toBeLessThanOrEqual(4000);
    }
  });

  it('each moves smoothly, frame by frame, and never jumps where its loop comes round (a piece leaps only while it cannot be seen, or by one whole wave of a row of them)', () => {
    for (const motion of twelve) {
      const count = motionPieces(motion, look()).length;
      expect(count, motion).toBeGreaterThan(0);
      const period = MOTION_PERIOD_MS[motion];
      for (let t = 0; t <= period; t += 16) {
        const a = motionAt(motion, t, count);
        const b = motionAt(motion, t + 16, count);
        for (const [i, p] of a.entries()) {
          const q = b[i] ?? p;
          const what = `${motion} piece ${String(i)} at ${String(t)} ms`;
          if (Math.min(p.opacity, q.opacity) <= 0.03) continue;
          expect(Math.abs(q.opacity - p.opacity), what).toBeLessThanOrEqual(0.08);
          const [from, to] = [pose(p), pose(q)];
          const slip = motion === 'waves' && Math.abs(Math.abs(to.x - from.x) - 1) < 0.05 ? 1 : 0;
          const most = (from.unit || to.unit) === 'em' ? 0.12 : 6;
          expect(Math.abs(to.x - from.x) - slip, what).toBeLessThanOrEqual(most);
          expect(Math.abs(to.y - from.y), what).toBeLessThanOrEqual(most);
          expect(Math.abs(to.sx - from.sx), what).toBeLessThanOrEqual(0.1);
          expect(Math.abs(to.sy - from.sy), what).toBeLessThanOrEqual(0.1);
          expect(turnBetween(from.deg, to.deg), what).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it('each does what its name says', () => {
    const at = (motion: LowerThirdMotion, share: number) =>
      motionAt(motion, MOTION_PERIOD_MS[motion] * share, motionPieces(motion, look()).length);
    const y = (motion: LowerThirdMotion, share: number, i = 0) =>
      pose(at(motion, share)[i] ?? { transform: '', opacity: 0 }).y;
    const x = (motion: LowerThirdMotion, share: number, i = 0) =>
      pose(at(motion, share)[i] ?? { transform: '', opacity: 0 }).x;
    // Light rising: from below the band to above it.
    expect(y('dawn', 0.1)).toBeGreaterThan(y('dawn', 0.5));
    expect(y('dawn', 0.5)).toBeGreaterThan(y('dawn', 0.9));
    // Lamps glowing, stars twinkling: in place, brighter and softer.
    for (const motion of ['lamps', 'stars'] as const) {
      const opacities = [0, 0.25, 0.5, 0.75].map((s) => at(motion, s)[0]?.opacity ?? 0);
      expect(Math.max(...opacities) - Math.min(...opacities), motion).toBeGreaterThan(0.3);
      for (const s of [0, 0.3, 0.6]) expect([x(motion, s), y(motion, s)], motion).toEqual([0, 0]);
    }
    // Mist drifting: right to left. Streaks of light: left to right.
    expect(x('mist', 0.3)).toBeLessThan(x('mist', 0.2));
    expect(x('streaks', 0.2)).toBeGreaterThan(x('streaks', 0.1));
    // Petals and confetti falling.
    expect(y('petals', 0.5)).toBeGreaterThan(y('petals', 0.3));
    expect(y('confetti', 0.2)).toBeGreaterThan(y('confetti', 0.1));
    // Ripples spreading: each ring grows as it fades.
    const ring = (share: number) => at('ripples', share)[0] ?? { transform: '', opacity: 0 };
    expect(pose(ring(0.6)).sx).toBeGreaterThan(pose(ring(0.3)).sx);
    expect(ring(0.9).opacity).toBeLessThan(ring(0.5).opacity);
    // Colours changing gently: never more than half the second colour, none at the start.
    const tints = Array.from({ length: 101 }, (_, i) => at('tint', i / 100)[0]?.opacity ?? 0);
    expect(tints[0]).toBe(0);
    expect(Math.max(...tints)).toBeCloseTo(0.5, 2);
    // Lights chasing: the brightest light moves along.
    const brightest = (share: number) => {
      const ops = at('chase', share).map((p) => p.opacity);
      return ops.indexOf(Math.max(...ops));
    };
    expect(brightest(0.25)).toBeGreaterThan(brightest(0));
    // Waves rolling: one wave along each loop.
    expect(x('waves', 0.5)).toBeCloseTo(-0.5, 3);
    // Rays of light: they lean, and lean a little this way and that.
    const leans = [0, 0.25, 0.5, 0.75].map(
      (s) => pose(at('rays', s)[0] ?? { transform: '', opacity: 0 }).deg,
    );
    expect(Math.max(...leans) - Math.min(...leans)).toBeGreaterThan(5);
  });
});
