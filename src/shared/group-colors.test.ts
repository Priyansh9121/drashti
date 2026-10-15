import { describe, expect, it } from 'vitest';
import { deltaE00, leastDistance, VISIONS } from './contrast';
import { GROUP_COLORS, GROUP_COLOURS, groupColor, newGroupColor } from './group-colors';

/*
 * The default group colours (Session 26g, decision 7): Chorus teal and Verse indigo, no red among
 * them, and every one at least 10 (CIEDE2000) from LIVE for everyone: in usual colour vision and in
 * simulated protanopia, deuteranopia and tritanopia (Machado 2009).
 */

const LIVE = '#d42a31';

describe('the default group colours', () => {
  it('start with teal for Chorus and indigo for Verse', () => {
    expect(GROUP_COLORS[0]).toBe(GROUP_COLOURS.teal);
    expect(GROUP_COLORS[1]).toBe(GROUP_COLOURS.indigo);
    expect(groupColor('Chorus')).toBe(GROUP_COLOURS.teal);
    expect(groupColor('ટેક')).toBe(GROUP_COLOURS.teal);
    expect(groupColor('Verse 2')).toBe(GROUP_COLOURS.indigo);
    expect(newGroupColor('Chorus', new Set())).toBe(GROUP_COLOURS.teal);
    expect(newGroupColor('Verse', new Set([GROUP_COLOURS.teal]))).toBe(GROUP_COLOURS.indigo);
  });

  it('have no red, and every one is at least 10 from LIVE in usual and simulated colour vision', () => {
    const rows = GROUP_COLORS.map((c) => {
      const each = VISIONS.map((v) => deltaE00(c, LIVE, v));
      return { colour: c, each, least: leastDistance(c, LIVE) };
    });
    console.info(
      [
        '| Colour | usual | protan | deutan | tritan | smallest |',
        '|---|---:|---:|---:|---:|---:|',
        ...rows.map(
          (r) =>
            `| ${r.colour} | ${r.each.map((d) => d.toFixed(1)).join(' | ')} | **${r.least.deltaE.toFixed(1)}** (${r.least.vision}) |`,
        ),
      ].join('\n'),
    );
    expect(GROUP_COLORS).not.toContain('#e5484d');
    expect(
      rows.filter((r) => r.least.deltaE < 10).map((r) => `${r.colour}: ${r.least.deltaE.toFixed(1)}`),
    ).toEqual([]);
    // Every colour a name gives is one of them.
    for (const name of ['Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Intro'])
      expect(GROUP_COLORS).toContain(groupColor(name));
  });

  it('a new group takes its name’s colour, else the first no other group has', () => {
    expect(newGroupColor('Bridge', new Set())).toBe(GROUP_COLOURS.purple);
    expect(newGroupColor('Group 3', new Set([GROUP_COLOURS.teal, GROUP_COLOURS.indigo]))).toBe(
      GROUP_COLOURS.orange,
    );
    expect(newGroupColor('Group 9', new Set(GROUP_COLORS))).toBe(GROUP_COLORS[0]);
  });
});
