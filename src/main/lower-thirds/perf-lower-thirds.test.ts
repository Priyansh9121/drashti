import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAnimation } from '../../shared/lower-third-animations';
import { LOWER_THIRD_DESIGNS } from '../../shared/lower-third-designs';
import { OFFERED } from '../../shared/lower-third-studio';
import { LOWER_THIRD_TEMPLATES } from '../../shared/lower-third-templates';
import { DEFAULT_LOWER_THIRD_LOOK, lowerThirdSchema } from '../../shared/lower-thirds';
import { isPerfScenario } from '../perf-scenarios';
import { keptOf, keptOfPhase, playedRows, rowVerdict, scheduledMs } from './perf-lower-thirds';

/*
 * The Performance check's lower-thirds scenario (Session 55, Part 16): it plays every row of the studio's offered set,
 * once each, as a lower third the library would keep (placeholder words only); a moving background is held long
 * enough to measure it moving. The workflow offers it, and its verdict is 9 in 10 frames, 60 a second.
 */

const APP = join(__dirname, '..', '..', '..');

/** What both lower-thirds scenarios play (Session 58: alpha.17's rows, then every row added since). */
const everyPlayedRow = async () => [
  ...(await playedRows('lower-thirds')),
  ...(await playedRows('lower-thirds-more')),
];

describe('the lower-thirds scenario', () => {
  it('plays each row of OFFERED once, as a lower third the library takes, with placeholder words', async () => {
    const rows = (await everyPlayedRow()).filter((r) => !r.row.startsWith('template '));
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

  it('offers the rechecked lower-third designs that passed both Performance runs', () => {
    // Two-core Windows runs 43195014134, 43195085796 and 43200188333: Silver 4.5% design-lift, Purple 5% design-lower, Lavender 4.5% design-centre-wipe, Emerald 5% design-slide-left, Midnight 5% design-reveal-down, Sea green 4.5% design-reveal-up.
    const previouslyHeldBack = [
      'silver-outline',
      'purple-outline',
      'lavender-labels',
      'emerald-labels',
      'midnight-bulletin',
      'sea-green-nameplate',
    ];
    const returned = LOWER_THIRD_TEMPLATES.map((t) => t.id).filter((id) => previouslyHeldBack.includes(id));
    expect(returned).toEqual([
      'silver-outline',
      'purple-outline',
      'lavender-labels',
      'emerald-labels',
      'midnight-bulletin',
      'sea-green-nameplate',
    ]);
  });

  it('measures each name-and-role design, and each template made since, with its own complete look and animation', async () => {
    const designs = LOWER_THIRD_TEMPLATES.filter((template) =>
      template.input.animation.startsWith('design-'),
    );
    const measured = (await everyPlayedRow()).filter((r) => r.row.startsWith('template '));
    expect(designs.length).toBeGreaterThanOrEqual(34);
    expect(new Set(measured.map((r) => r.lowerThird.id)).size).toBe(measured.length);
    for (const design of designs)
      expect(
        measured.some((r) => r.row === 'template ' + design.id),
        design.name,
      ).toBe(true);
    for (const row of measured) {
      const template = LOWER_THIRD_TEMPLATES.find((t) => row.row === 'template ' + t.id);
      expect(template, row.row).toBeDefined();
      expect(row.lowerThird, row.row).toEqual({
        ...template?.input,
        id: 'perf-lt-template-' + (template?.id ?? ''),
      });
      expect(row.measure).toBe('phases');
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

  it('names the screen where a row was not smooth (a hall screen, or the stream’s page), and one that never saw it', () => {
    const screens = [
      { fps: 60, name: 'the hall screen' },
      { fps: 30, name: 'the stream’s page' },
    ];
    const row = (measure: 'moving' | 'held' | 'phases', id = 'perf-lt-style-box') => ({
      measure,
      lowerThird: {
        id,
        lines: ['Placeholder name', 'Placeholder title'],
        look: DEFAULT_LOWER_THIRD_LOOK,
        where: 'both' as const,
        animation: 'slide-left-steady',
      },
    });
    // Every frame on the hall screen, 24 of the stream's page's 30 a second: 80% there.
    const dipped = rowVerdict(
      row('moving'),
      [
        { 'style-box|moving': { frames: 60, ms: 1000, worst: 17 } },
        { 'style-box|moving': { frames: 24, ms: 1000, worst: 120 } },
      ],
      screens,
    );
    expect(dipped.worst).toBeCloseTo(0.8, 5);
    expect(dipped).toMatchObject({ where: 'the stream’s page', smooth: false });
    const smooth = rowVerdict(
      row('moving'),
      [
        { 'style-box|moving': { frames: 58, ms: 1000, worst: 20 } },
        { 'style-box|moving': { frames: 30, ms: 1000, worst: 34 } },
      ],
      screens,
    );
    expect(smooth).toMatchObject({ smooth: true });
    expect(smooth.worst).toBeCloseTo(58 / 60, 5);
    // A design's phases: its out never seen on the hall screen is unseen there.
    const unseen = rowVerdict(
      row('phases', 'perf-lt-template-gold-underline'),
      [
        { 'template-gold-underline|in': { frames: 50, ms: 840, worst: 17 } },
        {
          'template-gold-underline|in': { frames: 25, ms: 840, worst: 34 },
          'template-gold-underline|out': { frames: 17, ms: 588, worst: 34 },
        },
      ],
      screens,
    );
    expect(unseen).toEqual({ worst: null, where: 'the hall screen', smooth: false });
  });

  it('catches a design phase that disappears or paints only a smooth middle section', () => {
    expect(keptOfPhase(undefined, 60, 336)).toBeNull();
    expect(keptOfPhase({ frames: 12, ms: 200, worst: 17 }, 60, 1000)).toBeCloseTo(13 / 60);
    expect(keptOfPhase({ frames: 8, ms: (8 * 1000) / 30, worst: 34 }, 30, 336)).toBeCloseTo(0.9);
  });

  it('is a scenario of the check, and the Performance workflow offers it', () => {
    expect(isPerfScenario('lower-thirds')).toBe(true);
    const workflow = readFileSync(join(APP, '.github', 'workflows', 'performance.yml'), 'utf8');
    expect(workflow).toMatch(/options:\s*\[[^\]]*\blower-thirds,/u);
  });
});

/*
 * The new rows' own measuring (Session 58, C14; LT-6): on a slow two-core runner the streaming check of the
 * lower-thirds scenario is near its 14 minutes already (its import alone can take 4 to 8), so the rows added since
 * alpha.17 (moving backgrounds, templates) are played by a second scenario, lower-thirds-more, and lower-thirds plays
 * alpha.17's rows as it did. Each run's rows are held under five minutes as the scenario plays them.
 */
describe('the two lower-thirds scenarios: alpha.17’s rows, and every row added since', () => {
  /** alpha.17's moving backgrounds and its studio templates (made before the designs; never played as templates). */
  const ALPHA17_BACKGROUNDS = ['sweep', 'shine', 'shapes', 'stripes', 'glow', 'line', 'sparkles'];
  const STUDIO_TEMPLATES = [
    'name-title',
    'news-band',
    'pill',
    'ribbon',
    'glass',
    'two-colours',
    'outline',
    'accent-bar',
    'gujarati',
    'hindi',
  ];
  const designIds = new Set(LOWER_THIRD_DESIGNS.map((d) => d.id));
  const after = (row: string, kind: string) =>
    row.startsWith(kind + ' ') ? row.slice(kind.length + 1) : null;

  it('lower-thirds-more is a scenario of the check too, and the Performance workflow offers it', () => {
    expect(isPerfScenario('lower-thirds-more')).toBe(true);
    const workflow = readFileSync(join(APP, '.github', 'workflows', 'performance.yml'), 'utf8');
    expect(workflow).toMatch(/options:\s*\[[^\]]*\blower-thirds-more,/u);
  });

  it('lower-thirds plays alpha.17’s rows only, in its order, so its run never grows', async () => {
    const rows = await playedRows('lower-thirds');
    const kinds = ['animation', 'band', 'style', 'background', 'template'] as const;
    const count = (kind: string) => rows.filter((r) => after(r.row, kind) !== null).length;
    // The offered set's 58 families of animation, 3 ways a band comes in, 12 styles, 7 moving backgrounds, and the
    // 40 designs: fewer only where the Performance run has left one out (deleted).
    expect(count('animation')).toBeLessThanOrEqual(58);
    expect(count('band')).toBeLessThanOrEqual(3);
    expect(count('style')).toBeLessThanOrEqual(12);
    expect(count('background')).toBeLessThanOrEqual(7);
    expect(count('template')).toBeLessThanOrEqual(40);
    expect(rows.length).toBe(kinds.reduce((n, kind) => n + count(kind), 0));
    for (const r of rows) {
      const background = after(r.row, 'background');
      if (background !== null) expect(ALPHA17_BACKGROUNDS, r.row).toContain(background);
      const template = after(r.row, 'template');
      if (template !== null) expect(designIds.has(template), r.row).toBe(true);
    }
    // As it played them: the offered set's rows (alpha.17's backgrounds only) in OFFERED's order, then the designs.
    const names = rows.map((r) => r.row);
    const firstOffered = OFFERED.map((r) => `${r.kind} ${r.kind === 'animation' ? r.family : r.key}`).filter(
      (n) => after(n, 'background') === null || ALPHA17_BACKGROUNDS.includes(after(n, 'background') ?? ''),
    );
    const templatesAt = names.findIndex((n) => after(n, 'template') !== null);
    expect(names.slice(0, templatesAt)).toEqual(firstOffered);
    expect(names.slice(templatesAt).every((n) => after(n, 'template') !== null)).toBe(true);
  });

  it('every offered row and every template made since alpha.17 is played once, in one of the two', async () => {
    const first = await playedRows('lower-thirds');
    const more = await playedRows('lower-thirds-more');
    const names = [...first, ...more].map((r) => r.row);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => after(n, 'template') === null)).toHaveLength(OFFERED.length);
    // Every background beyond alpha.17's seven, and every template but alpha.17's own, in lower-thirds-more.
    for (const r of more) {
      const background = after(r.row, 'background');
      const template = after(r.row, 'template');
      expect(background !== null || template !== null, r.row).toBe(true);
      if (background !== null) expect(ALPHA17_BACKGROUNDS, r.row).not.toContain(background);
      if (template !== null) {
        expect(designIds.has(template) || STUDIO_TEMPLATES.includes(template), r.row).toBe(false);
        expect(r.measure, r.row).toBe('phases');
      }
    }
    const since = LOWER_THIRD_TEMPLATES.filter(
      (t) => !designIds.has(t.id) && !STUDIO_TEMPLATES.includes(t.id),
    );
    expect(more.filter((r) => after(r.row, 'template') !== null).map((r) => r.row)).toEqual(
      since.map((t) => 'template ' + t.id),
    );
  });

  it('each scenario’s rows take under five minutes as it plays them (in, held, out and the gap after)', async () => {
    for (const set of ['lower-thirds', 'lower-thirds-more'] as const) {
      const rows = await playedRows(set);
      const ms = scheduledMs(rows);
      expect(ms, set).toBeLessThanOrEqual(5 * 60_000);
      // Never shorter than its rows' own holds and gaps: an in and an out of at least a frame each.
      expect(ms, set).toBeGreaterThanOrEqual(rows.reduce((n, r) => n + r.holdMs + 300, 0));
    }
    // alpha.17's: about four and three-quarter minutes.
    expect(scheduledMs(await playedRows('lower-thirds'))).toBeGreaterThan(4 * 60_000);
  });
});
