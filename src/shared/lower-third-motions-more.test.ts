import { describe, expect, it } from 'vitest';
import { MORE_MOTIONS } from './lower-third-motions-more';
import type { MotionDef } from './lower-third-motion-kit';
import { LOWER_THIRD_MOTIONS, MOTION_NAMES } from './lower-third-styles';
import { OFFERED, OFFERED_MOTIONS } from './lower-third-studio';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThirdLook } from './lower-thirds';

/*
 * The Lower Thirds studio's moving backgrounds, part 2 (Session 58, alpha.18): eleven more, original, calm ones for a
 * mandir hall first (slow light, soft gradients, gentle shapes), then a few livelier, none the same as another. Each
 * is drawn as the first seven are: at most 12 pieces, each drawn once (a fill, a gradient, a rounded or cut shape, a
 * ring), then moved only by transform and opacity, a pure function of the time since the lower third went up, round
 * and round without a jump, in the lower third's own colours (its band, its second colour, its words) and white light.
 */

const KEYS = Object.keys(MORE_MOTIONS) as (keyof typeof MORE_MOTIONS)[];

const look = (more: Partial<LowerThirdLook> = {}): LowerThirdLook => ({
  ...DEFAULT_LOWER_THIRD_LOOK,
  ...more,
});
const LOOKS: readonly LowerThirdLook[] = [
  look(),
  look({ band: '#123456', bandOpacity: 0.5, accent: '#ff9900', text: '#111111', style: 'band' }),
  look({ band: '#3a0d2e', bandOpacity: 1, accent: '#00aa88', style: 'stacked' }),
];

/** What a piece's own CSS may say: where it is, its size and shape, its colour, and where it turns about. */
const DRAWN = new Set([
  'position',
  'left',
  'right',
  'top',
  'bottom',
  'width',
  'height',
  'aspectRatio',
  'marginLeft',
  'marginTop',
  'borderRadius',
  'border',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'clipPath',
  'background',
  'transformOrigin',
]);

/** One part of a transform the renderer sets: a move, a scale, a turn or a slant (as lower-third-studio.test.ts). */
const PART =
  /^(?:translate\((-?[\d.]+)(%|em), (-?[\d.]+)(%|em)\)|scale\(([\d.]+)(?:, ([\d.]+))?\)|rotate\((-?[\d.]+)deg\)|skewX\((-?[\d.]+)deg\))$/u;

interface Parts {
  /** The move, by unit ('%' or 'em'): x and y. */
  move: { x: number; y: number; unit: string } | null;
  scale: { x: number; y: number };
  rotate: number;
  skew: number;
}

function partsOf(transform: string, what: string): Parts {
  const parts: Parts = { move: null, scale: { x: 1, y: 1 }, rotate: 0, skew: 0 };
  if (transform === '') return parts;
  for (const part of transform.split(/(?<=\)) /u)) {
    const m = PART.exec(part);
    expect(m, `${what}: ${transform}`).not.toBeNull();
    if (!m) continue;
    if (m[1] !== undefined) {
      expect(m[2], `${what}: one unit in a move`).toBe(m[4]);
      parts.move = { x: Number(m[1]), y: Number(m[3]), unit: m[2] ?? '' };
    } else if (m[5] !== undefined) parts.scale = { x: Number(m[5]), y: Number(m[6] ?? m[5]) };
    else if (m[7] !== undefined) parts.rotate = Number(m[7]);
    else parts.skew = Number(m[8]);
  }
  return parts;
}

/** How far apart two turns look (degrees): a whole turn round is no turn at all. */
const turnApart = (a: number, b: number): number => Math.abs(((((b - a) % 360) + 540) % 360) - 180);

/** The most a piece that shows may change from one frame to the next (60 a second): it moves, it never jumps. */
const STEP = { em: 0.15, percent: 4, deg: 8, scale: 0.1, skew: 1, opacity: 0.15 };
const SHOWS = 0.02;
const FRAME_MS = 1000 / 60;

describe('the studio’s moving backgrounds, part 2', () => {
  it('eleven more, each with a key and a plain name of its own, none the same as another background’s', () => {
    expect(KEYS).toHaveLength(11);
    const mine = new Set<string>(KEYS);
    const others = LOWER_THIRD_MOTIONS.filter((m) => !mine.has(m));
    expect(others.length).toBeGreaterThanOrEqual(8);
    const otherNames = new Set(others.map((m) => MOTION_NAMES[m].toLowerCase()));
    const names = KEYS.map((m) => MORE_MOTIONS[m].name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(11);
    for (const [i, name] of names.entries()) {
      const key = KEYS[i] ?? '';
      expect(key, key).toMatch(/^[a-z]+$/u);
      expect(otherNames.has(name.toLowerCase()), name).toBe(false);
      // Plain words, as the first seven ("Colours sweeping"), short enough for the studio's list.
      expect(name, key).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/u);
      expect(name.length, name).toBeLessThanOrEqual(22);
    }
  });

  it('the studio offers each (one row of OFFERED each, measured by the Performance check), the calm ones among the calm', () => {
    for (const m of KEYS) expect(OFFERED, m).toContainEqual({ kind: 'background', key: m });
    const offered = OFFERED_MOTIONS.slice(1);
    const lively = offered.findIndex((m) => m === KEYS.find((k) => MORE_MOTIONS[k].feel === 'lively'));
    for (const m of KEYS)
      if (MORE_MOTIONS[m].feel === 'calm') expect(offered.indexOf(m), m).toBeLessThan(lively);
      else expect(offered.indexOf(m), m).toBeGreaterThanOrEqual(lively);
  });

  it('calm ones first, slow (six seconds or more round); the livelier after (four seconds or less)', () => {
    const feels = KEYS.map((m) => MORE_MOTIONS[m].feel);
    expect(feels).toEqual([...Array<string>(7).fill('calm'), ...Array<string>(4).fill('lively')]);
    for (const m of KEYS) {
      const { feel, periodMs } = MORE_MOTIONS[m];
      if (feel === 'calm') expect(periodMs, m).toBeGreaterThanOrEqual(6000);
      else expect(periodMs >= 1000 && periodMs <= 4000, m).toBe(true);
    }
  });

  it('each is 1 to 12 pieces drawn once (a fill, a gradient, a rounded shape: no filter, blur, shadow or backdrop), in the lower third’s own colours and white light', () => {
    for (const motion of KEYS) {
      const def: MotionDef = MORE_MOTIONS[motion];
      expect(def.fill, motion).toBeUndefined();
      for (const l of LOOKS) {
        const pieces = def.pieces(l);
        expect(pieces.length, motion).toBeGreaterThanOrEqual(1);
        expect(pieces.length, motion).toBeLessThanOrEqual(12);
        for (const piece of pieces) {
          expect(piece['position'], motion).toBe('absolute');
          for (const key of Object.keys(piece)) expect(DRAWN.has(key), `${motion}: ${key}`).toBe(true);
          const css = JSON.stringify(piece);
          expect(css, motion).not.toMatch(/filter|blur|shadow|backdrop|url\(|image-set/iu);
          // Its colours: the band's, the second colour's or the words', or white light.
          const own = [l.band, l.accent ?? '#f59e0b', l.text].map((c) => c.toLowerCase());
          for (const hex of css.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/giu) ?? [])
            expect(own, `${motion}: ${hex}`).toContain(hex.slice(0, 7).toLowerCase());
          for (const rgba of css.match(/rgba?\([^)]*\)/gu) ?? [])
            expect(rgba, motion).toMatch(/^rgba\(255, 255, 255, (0|1|0?\.\d+)\)$/u);
          expect(css, `${motion}: named colours`).not.toMatch(/\b(white|black|gold|red|orange|hsl)\b/u);
        }
      }
      // It follows the lower third's colours.
      expect(JSON.stringify(def.pieces(LOOKS[0] ?? look())), motion).not.toBe(
        JSON.stringify(def.pieces(look({ accent: '#00aa88', text: '#222222' }))),
      );
    }
  });

  it('each piece moves by transform and opacity only, the same at the same moment, every one seen', () => {
    for (const motion of KEYS) {
      const def: MotionDef = MORE_MOTIONS[motion];
      const count = def.pieces(look()).length;
      expect(def.at(0.3, 0)).toEqual([]);
      const seen = Array.from({ length: count }, () => 0);
      const poses = Array.from({ length: count }, () => new Set<string>());
      for (let k = 0; k < 400; k += 1) {
        const turn = k / 400;
        const at = def.at(turn, count);
        expect(at, motion).toHaveLength(count);
        expect(def.at(turn, count)).toEqual(at);
        for (const [i, p] of at.entries()) {
          partsOf(p.transform, `${motion} at ${String(turn)}`);
          expect(p.opacity, motion).toBeGreaterThanOrEqual(0);
          expect(p.opacity, motion).toBeLessThanOrEqual(1);
          seen[i] = Math.max(seen[i] ?? 0, p.opacity);
          poses[i]?.add(`${p.transform}|${String(p.opacity)}`);
        }
      }
      for (const [i, most] of seen.entries())
        expect(most, `${motion} piece ${String(i)} seen`).toBeGreaterThan(0.3);
      for (const [i, p] of poses.entries())
        expect(p.size, `${motion} piece ${String(i)} moves`).toBeGreaterThan(10);
    }
  });

  it('round and round without a jump: a piece that shows moves only a little from one frame to the next, from the end of its loop to its start too', () => {
    for (const motion of KEYS) {
      const def: MotionDef = MORE_MOTIONS[motion];
      const count = def.pieces(look()).length;
      const turnAt = (t: number) => (t % def.periodMs) / def.periodMs;
      let before = def.at(turnAt(0), count);
      for (let t = FRAME_MS; t <= def.periodMs + 3 * FRAME_MS; t += FRAME_MS) {
        const now = def.at(turnAt(t), count);
        for (const [i, p] of now.entries()) {
          const q = before[i];
          if (!q) continue;
          const what = `${motion} piece ${String(i)} at ${t.toFixed(1)} ms: ${q.transform} → ${p.transform}`;
          expect(Math.abs(p.opacity - q.opacity), what).toBeLessThanOrEqual(STEP.opacity);
          if (p.opacity < SHOWS || q.opacity < SHOWS) continue;
          const a = partsOf(q.transform, what);
          const b = partsOf(p.transform, what);
          const unit = a.move?.unit ?? b.move?.unit ?? 'em';
          const most = unit === 'em' ? STEP.em : STEP.percent;
          if (a.move && b.move) expect(a.move.unit, what).toBe(b.move.unit);
          expect(Math.abs((b.move?.x ?? 0) - (a.move?.x ?? 0)), what).toBeLessThanOrEqual(most);
          expect(Math.abs((b.move?.y ?? 0) - (a.move?.y ?? 0)), what).toBeLessThanOrEqual(most);
          expect(Math.abs(b.scale.x - a.scale.x), what).toBeLessThanOrEqual(STEP.scale);
          expect(Math.abs(b.scale.y - a.scale.y), what).toBeLessThanOrEqual(STEP.scale);
          expect(turnApart(a.rotate, b.rotate), what).toBeLessThanOrEqual(STEP.deg);
          expect(Math.abs(b.skew - a.skew), what).toBeLessThanOrEqual(STEP.skew);
        }
        before = now;
      }
    }
  });
});
