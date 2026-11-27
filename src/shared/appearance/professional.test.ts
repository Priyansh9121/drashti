import { describe, expect, it } from 'vitest';
import { BLACK, BUILT_IN, builtIn, familyOf, type Appearance } from './appearances';
import { contrastRatio, deltaE00 } from '../contrast';
import { hexToOklch } from './oklch';
import { appearanceProblems, inZone, lookApart, LOOKS_APART, measureContrast } from './rules';
import { appearanceVars, headerImage } from './vars';
import { ZONES } from './zones';

const DESKS = [
  ['broadcast', 'Broadcast'],
  ['stage-desk', 'Stage desk'],
  ['daylight', 'Daylight'],
  ['signal', 'Signal'],
] as const;

function desk(id: string): Appearance {
  const a = builtIn(id);
  if (!a) throw new Error(`Missing professional appearance: ${id}`);
  return a;
}

describe('professional show appearances', () => {
  it.each(DESKS)('%s is a named built-in in Show tools, with only existing drawing tokens', (id, name) => {
    const a = desk(id);
    expect(a.name).toBe(name);
    expect(familyOf(a)).toBe('Show tools');
    expect(Object.keys(appearanceVars(a)).sort()).toEqual(Object.keys(appearanceVars(BLACK)).sort());
    expect(a.moving).toBeUndefined();
    expect(headerImage(a)).toBe('none');
  });

  it.each(DESKS)('%s meets every contrast and state-distance rule in every zone', (id) => {
    const a = desk(id);
    expect(appearanceProblems(a)).toEqual([]);
    for (const zone of ZONES) {
      expect(measureContrast(inZone(a, zone)).filter((row) => !row.ok)).toEqual([]);
      const c = { ...a.colours, ...a.zones[zone] };
      for (const word of ['fg', 'muted', 'faint', 'accent', 'danger', 'rec'] as const)
        for (const surface of ['ink', 'panel', 'panel-2', 'panel-3'] as const)
          expect(contrastRatio(c[word], c[surface]), `${id} ${zone} ${word} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      for (const edge of ['line', 'line-strong', 'field', 'live-edge', 'primary-edge'] as const)
        expect(contrastRatio(c[edge], c.panel), `${id} ${zone} ${edge}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('each is clearly different from every existing appearance and from the other desks', () => {
    for (const [id] of DESKS) {
      const a = desk(id);
      for (const b of BUILT_IN.filter((other) => other.id !== id)) {
        const distances = [
          deltaE00(a.colours.ink, b.colours.ink),
          deltaE00(a.decoration.header, b.decoration.header),
          deltaE00(a.colours.primary, b.colours.primary),
        ].sort((x, y) => y - x);
        expect(distances[1], `${a.name} and ${b.name}`).toBeGreaterThanOrEqual(10);
        if (a.base === b.base) expect(lookApart(a, b), `${a.name} and ${b.name}`).toBeGreaterThanOrEqual(LOOKS_APART);
      }
    }
  });

  it('Broadcast keeps red LIVE, green success and amber warning distinct from its pale green Next', () => {
    const c = desk('broadcast').colours;
    expect(c.live).toBe('#d42a31');
    expect(hexToOklch(c.primary).h).toBeGreaterThan(130);
    expect(hexToOklch(c.primary).h).toBeLessThan(170);
    expect(hexToOklch(c.success).h).toBeGreaterThan(130);
    expect(hexToOklch(c.success).h).toBeLessThan(170);
    expect(hexToOklch(c.warning).h).toBeGreaterThan(50);
    expect(hexToOklch(c.warning).h).toBeLessThan(100);
  });

  it('Stage desk uses warm words and Daylight uses dark words on a light base', () => {
    const stage = desk('stage-desk');
    expect(stage.base).toBe('dark');
    const warm = hexToOklch(stage.colours.fg);
    expect(warm.h).toBeGreaterThan(55);
    expect(warm.h).toBeLessThan(100);
    expect(warm.c).toBeGreaterThan(0.02);
    const day = desk('daylight');
    expect(day.base).toBe('light');
    for (const zone of ZONES)
      expect(contrastRatio(day.colours.fg, day.zones[zone].panel)).toBeGreaterThanOrEqual(12);
  });
});
