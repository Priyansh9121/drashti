import { describe, expect, it } from 'vitest';
import { COLOUR_TOKENS } from './appearances';
import { checkAccent, deriveAppearance, deriveColours, madeAppearance } from './derive';
import { hexToOklch, oklchToHex } from './oklch';
import { appearanceProblems, decorationLacks } from './rules';

/*
 * A person's own appearance, worked out from a base and an accent (Session 40): over a sweep of accents on both
 * bases, every appearance worked out meets every rule (rules.ts), or is refused in plain words with the nearest
 * accent that does; only a primary too close to a state is ever refused (the rest is always made to pass); and
 * an accent close to LIVE is refused. Made-up colours only.
 */

/** Accents round the colour wheel: 24 hues, three lightnesses, three strengths. */
const SWEEP = [
  0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330,
  345,
]
  .flatMap((h) => [0.5, 0.65, 0.8].flatMap((l) => [0.04, 0.1, 0.18].map((c) => oklchToHex({ l, c, h }))))
  .filter((hex, i, all) => all.indexOf(hex) === i);

describe('working out an appearance from a base and an accent', () => {
  for (const base of ['dark', 'light'] as const)
    it(`${base}: every accent of the sweep makes an appearance that meets every rule, or is refused with the nearest that does`, () => {
      let passed = 0;
      const unexplained: string[] = [];
      for (const accent of SWEEP) {
        const check = checkAccent(base, accent);
        const problems = appearanceProblems(madeAppearance('own-x', 'X', base, accent));
        expect(check.ok, accent).toBe(problems.length === 0);
        if (check.ok) {
          passed += 1;
          continue;
        }
        // Only the primary against a state is ever refused: contrast is always worked out to pass.
        for (const p of problems)
          if (!/^primary(-hi|-lo|-edge)? vs /u.test(p)) unexplained.push(`${accent}: ${p}`);
        expect(check.why, accent).toMatch(
          /^This colour is too close to .+\. Use the nearest colour that works, or choose another\.$/u,
        );
        expect(check.nearest, `${accent}: a nearest that works`).not.toBeNull();
        expect(checkAccent(base, check.nearest ?? '').ok, `${accent} -> ${check.nearest ?? ''}`).toBe(true);
      }
      expect(unexplained).toEqual([]);
      // About half work as they are (Session 40: 48% dark, 58% light): the rest are mostly mid-light yellows and
      // greens, which a person without working red cones sees as LIVE's red, and violet-blues, seen as ON AIR's.
      expect(passed / SWEEP.length).toBeGreaterThan(0.4);
    });

  it('refuses an accent close to LIVE, in words, and offers the nearest that works', () => {
    for (const base of ['dark', 'light'] as const) {
      const check = checkAccent(base, '#d0302f');
      expect(check.ok).toBe(false);
      expect(check.why).toContain('LIVE’s red');
      expect(check.nearest).not.toBeNull();
      expect(check.nearest).not.toBe('#d0302f');
      expect(checkAccent(base, check.nearest ?? '').ok).toBe(true);
    }
  });

  it('keeps a colour that works as it is, as the primary, and sets every token', () => {
    const own = deriveAppearance({ id: 'own-a', name: 'Placeholder own', base: 'dark', accent: '#5aa2ff' });
    expect(Object.keys(own.colours).sort()).toEqual([...COLOUR_TOKENS].sort());
    for (const hex of Object.values(own.colours)) expect(hex).toMatch(/^#[0-9a-f]{6}$/u);
    expect(own.colours.primary).toBe('#5aa2ff');
    expect(appearanceProblems(own)).toEqual([]);
    // The same every time: an appearance kept as its base and accent comes back the same.
    expect(deriveColours('dark', '#5aa2ff')).toEqual(own.colours);
  });

  it('works out a decoration from the accent too (Session 42): a deep header of its hue, a band, marks apart from every state', () => {
    for (const base of ['dark', 'light'] as const) {
      const own = deriveAppearance({ id: 'own-b', name: 'Placeholder own', base, accent: '#16a3a0' });
      const d = own.decoration;
      expect(appearanceProblems(own)).toEqual([]);
      // Its surfaces are Session 40's (a trace of the accent's hue), so one kept since then looks as it did there.
      expect(
        decorationLacks(own).filter((l) => l !== 'panels that carry its hue'),
        base,
      ).toEqual([]);
      expect(d.band).toHaveLength(3);
      expect(d.band[0]).toBe(own.colours.primary);
      expect(Math.abs(hexToOklch(d.header).h - hexToOklch('#16a3a0').h)).toBeLessThan(15);
      expect(hexToOklch(d.header).l).toBeLessThan(0.4);
      // The same every time, as the colours are.
      expect(madeAppearance('own-b', 'Placeholder own', base, '#16a3a0').decoration).toEqual(d);
    }
  });

  it('takes a second colour of one’s own (Session 42): kept in its hue, or refused in words with the nearest that works', () => {
    for (const base of ['dark', 'light'] as const) {
      const own = madeAppearance('own-c', 'Placeholder own', base, '#16a3a0', '#3aa0d8');
      expect(appearanceProblems(own)).toEqual([]);
      expect(Math.abs(hexToOklch(own.decoration.second).h - hexToOklch('#3aa0d8').h)).toBeLessThan(6);
      expect(Math.abs(hexToOklch(own.decoration.heading).h - hexToOklch('#3aa0d8').h)).toBeLessThan(6);
      expect(checkAccent(base, '#16a3a0', '#3aa0d8').ok).toBe(true);
      // Marks that could be taken for LIVE.
      const near = checkAccent(base, '#16a3a0', '#d0302f');
      expect(near.ok).toBe(false);
      expect(near.which).toBe('second');
      expect(near.why).toMatch(
        /^This second colour is too close to .+, so what it marks could be taken for it\. Use the nearest colour that works, or choose another\.$/u,
      );
      expect(near.nearest).not.toBeNull();
      expect(checkAccent(base, '#16a3a0', near.nearest ?? '').ok, `${base} ${near.nearest ?? ''}`).toBe(true);
    }
  });

  it('round-trips colours through OKLCH', () => {
    for (const hex of ['#000000', '#ffffff', '#d42a31', '#5aa2ff', '#0b5c7a', '#ee8228'])
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });
});
