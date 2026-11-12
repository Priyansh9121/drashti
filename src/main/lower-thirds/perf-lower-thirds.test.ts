import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAnimation } from '../../shared/lower-third-animations';
import { LOWER_THIRD_TEMPLATES, OFFERED } from '../../shared/lower-third-studio';
import { lowerThirdSchema } from '../../shared/lower-thirds';
import { isPerfScenario } from '../perf-scenarios';
import { keptOf, playedRows } from './perf-lower-thirds';

/*
 * The Performance check's lower-thirds scenario (Session 55, Part 16): it plays every row of the studio's offered set,
 * once each, as a lower third the library would keep (placeholder words only); a moving background is held long
 * enough to measure it moving. The workflow offers it, and its verdict is 9 in 10 frames, 60 a second.
 */

const APP = join(__dirname, '..', '..', '..');

describe('the lower-thirds scenario', () => {
  it('plays each row of OFFERED once, as a lower third the library takes, with placeholder words', () => {
    const rows = playedRows().filter((r) => !r.row.startsWith('template '));
    expect(rows).toHaveLength(OFFERED.length);
    expect(new Set(rows.map((r) => r.lowerThird.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(isAnimation(r.lowerThird.animation), r.row).toBe(true);
      expect(lowerThirdSchema.safeParse(r.lowerThird).success, r.row).toBe(true);
      expect(
        r.lowerThird.lines.every((l) => l.startsWith('Placeholder')),
        r.row,
      ).toBe(true);
      expect(r.lowerThird.id).toMatch(/^perf-lt-[a-z-]+$/u);
    }
    const background = rows.filter((r) => r.row.startsWith('background '));
    expect(background.length).toBe(OFFERED.filter((r) => r.kind === 'background').length);
    for (const r of background) {
      expect(r.measure).toBe('held');
      expect(r.holdMs).toBeGreaterThanOrEqual(3000);
      expect(r.lowerThird.look.motion).toBe(r.row.slice('background '.length));
    }
    for (const r of rows.filter((x) => x.row.startsWith('style ')))
      expect(r.lowerThird.look.style).toBe(r.row.slice('style '.length));
  });

  it('measures each new name-and-role design with its own complete look and animation', () => {
    const designs = LOWER_THIRD_TEMPLATES.filter((template) =>
      template.input.animation.startsWith('design-'),
    );
    const measured = playedRows().filter((r) => r.row.startsWith('template '));
    expect(designs.length).toBeGreaterThanOrEqual(35);
    expect(measured).toHaveLength(designs.length);
    expect(new Set(measured.map((r) => r.lowerThird.id)).size).toBe(designs.length);
    for (const design of designs) {
      const row = measured.find((r) => r.row === 'template ' + design.id);
      expect(row?.lowerThird, design.name).toEqual({ ...design.input, id: 'perf-lt-template-' + design.id });
      expect(row?.measure).toBe('phases');
    }
  });

  it('a row keeps 9 in 10 of its frames at 54 a second on an output, 27 on the stream’s page; none seen is none', () => {
    expect(keptOf({ frames: 54, ms: 1000, worst: 20 })).toBeCloseTo(0.9, 5);
    // The stream's page draws 30 a second: 27 of them is 9 in 10.
    expect(keptOf({ frames: 27, ms: 1000, worst: 40 }, 30)).toBeCloseTo(0.9, 5);
    expect(keptOf({ frames: 70, ms: 1000, worst: 16 })).toBe(1);
    expect(keptOf({ frames: 0, ms: 0, worst: 0 })).toBeNull();
    expect(keptOf(undefined)).toBeNull();
  });

  it('is a scenario of the check, and the Performance workflow offers it', () => {
    expect(isPerfScenario('lower-thirds')).toBe(true);
    const workflow = readFileSync(join(APP, '.github', 'workflows', 'performance.yml'), 'utf8');
    expect(workflow).toMatch(/options:\s*\[[^\]]*\blower-thirds,/u);
  });
});
