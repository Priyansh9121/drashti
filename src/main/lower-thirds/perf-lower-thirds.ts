import type { BrowserWindow } from 'electron';
import { animationById, animationLength, cutIntoUnits } from '../../shared/lower-third-animations';
import type { LowerThirdLook } from '../../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThird, shownLines } from '../../shared/lower-thirds';
import type { ScenarioDeps, ScenarioRun } from '../perf-scenarios';
import { PROGRAM_FPS } from '../stream/program-window';
import { plural } from '../../shared/text';

/*
 * The Performance check's lower-thirds scenarios (Session 55, Part 16; DRASHTI_PERF_SCENARIO=lower-thirds, the
 * Performance workflow's "scenario"): every row of the Lower Thirds studio's offered set (shared/lower-third-studio.ts,
 * OFFERED) played in turn on every screen, and how many of its frames each screen drew. Run with the workflow's
 * handicap on Windows (two cores, no graphics chip), it says which are smooth there: one that is not is left out by
 * deleting its row, and nothing else need change (the owner's answer E3, 30 Oct 2026: one run decides; since Q57-18, a
 * row is left out only if it dips under 90% in two runs on the current code).
 *
 * The usual check runs first (slide changes every two seconds through the import, as in a sabha); then, the import
 * over and its slide changes done, each row in turn over the last slide: a family of animation in its first
 * direction at its steady speed (in, a moment held, out); each way a band comes in, with lines fading in; each style,
 * sliding in and out; each moving background, held four seconds. Each screen counts its animation frames (its own
 * frame callbacks) while a row moves, against what it draws a second (an output 60, the stream's page its own 30): a
 * row keeps 9 in 10 of them on every screen, or it is not smooth. Each template plays its complete design, its in
 * and its out each measured on its own against its full length. Placeholder words only.
 *
 * Two scenarios, each with its own rows (Session 58, C14; LT-6): on a slow two-core runner the streaming check is near
 * its 14 minutes already (its import alone can take four to eight), so the rows added since alpha.17 have a measuring
 * of their own. lower-thirds plays alpha.17's rows, as it did: the offered set with its first seven moving
 * backgrounds, and the 40 designs (lower-third-designs.ts). lower-thirds-more plays every row added since: the moving
 * backgrounds after those seven, and the templates made since (lower-third-designs-more.ts). Each run's rows stay
 * under five minutes as it plays them (the unit test holds it): a row added later goes to lower-thirds-more, and when
 * that set reaches five minutes, a third set is made (never a shorter hold).
 */

/** The two scenarios, each with its own rows. */
export type LowerThirdsSet = 'lower-thirds' | 'lower-thirds-more';

/** One row of OFFERED, as the lower third the scenario plays for it. */
interface Played {
  /** "animation blur", "band slide", "style glass", "background shine", "template gold-underline". */
  row: string;
  /** The scenario that plays it. */
  set: LowerThirdsSet;
  lowerThird: LowerThird;
  /** How long it is held between its in and its out (a background: long enough to measure it moving). */
  holdMs: number;
  /** Existing animation rows, held backgrounds, or each phase of a complete design. */
  measure: 'moving' | 'held' | 'phases';
}

const LINES = ['Placeholder name', 'Placeholder title'];
const HOLD_MS = 300;
const BACKGROUND_HOLD_MS = 4000;
const AFTER_MS = 300;

/** The moving backgrounds alpha.17 offered, which lower-thirds plays; every one after them, lower-thirds-more. */
const ALPHA17_BACKGROUNDS: readonly string[] = [
  'sweep',
  'shine',
  'shapes',
  'stripes',
  'glow',
  'line',
  'sparkles',
];

/** Every row both scenarios play, each with its scenario: alpha.17's in the table's order first, then the newer. */
async function everyRow(): Promise<Played[]> {
  const [
    { BAND_INTROS, FAMILIES, idFor, OFFERED },
    { LOWER_THIRD_TEMPLATES },
    { LOWER_THIRD_DESIGNS },
    more,
  ] = await Promise.all([
    import('../../shared/lower-third-studio'),
    import('../../shared/lower-third-templates'),
    import('../../shared/lower-third-designs'),
    import('../../shared/lower-third-designs-more'),
  ]);
  const made = (
    row: string,
    animation: string,
    look: Partial<LowerThirdLook>,
    hold = HOLD_MS,
    set: LowerThirdsSet = 'lower-thirds',
  ): Played => ({
    row,
    set,
    lowerThird: {
      id: `perf-lt-${row.replace(/\s+/gu, '-')}`,
      lines: LINES,
      look: { ...DEFAULT_LOWER_THIRD_LOOK, ...look },
      where: 'both',
      animation,
    },
    holdMs: hold,
    measure: hold === BACKGROUND_HOLD_MS ? 'held' : 'moving',
  });
  const lineFade = FAMILIES.find((f) => f.family === 'line-fade');
  const offered = OFFERED.flatMap((r): Played[] => {
    switch (r.kind) {
      case 'animation': {
        const family = FAMILIES.find((f) => f.family === r.family);
        if (!family) return [];
        return [
          made(
            `animation ${r.family}`,
            idFor(family, { direction: null, speed: 'steady', band: 'fade' }),
            {},
          ),
        ];
      }
      case 'band':
        return lineFade && BAND_INTROS.includes(r.key)
          ? [made(`band ${r.key}`, idFor(lineFade, { direction: null, speed: 'steady', band: r.key }), {})]
          : [];
      case 'style':
        return [made(`style ${r.key}`, 'slide-left-steady', { style: r.key })];
      case 'background':
        return [
          made(
            `background ${r.key}`,
            'fade-steady',
            { motion: r.key },
            BACKGROUND_HOLD_MS,
            ALPHA17_BACKGROUNDS.includes(r.key) ? 'lower-thirds' : 'lower-thirds-more',
          ),
        ];
    }
  });
  const template = (id: string, set: LowerThirdsSet): Played[] =>
    LOWER_THIRD_TEMPLATES.filter((t) => t.id === id).map((t): Played => ({
      row: 'template ' + t.id,
      set,
      lowerThird: { ...t.input, id: 'perf-lt-template-' + t.id },
      holdMs: HOLD_MS,
      measure: 'phases',
    }));
  return [
    ...offered,
    // alpha.17's designs (each a design's move: the studio's own ten templates are measured row by row above).
    ...LOWER_THIRD_DESIGNS.flatMap((d) => template(d.id, 'lower-thirds')),
    ...more.MORE_LOWER_THIRD_DESIGNS.flatMap((d) => template(d.id, 'lower-thirds-more')),
  ];
}

/** The rows a scenario plays, in the order it plays them: its offered rows in the table's order, then its templates. */
export async function playedRows(set: LowerThirdsSet): Promise<Played[]> {
  return (await everyRow()).filter((p) => p.set === set);
}

/** Each screen counts its frames while a lower third the scenario plays moves (its in and out) or is held. */
const COUNT = `(() => {
  const s = {};
  window.drashtiLowerThirdFrames = s;
  let cur = null;
  const tick = (t) => {
    const el = document.querySelector('[data-testid="lower-third-layer"][data-lt-id^="perf-lt-"]');
    let id = null;
    if (el) {
      const phase = el.getAttribute('data-lt-phase');
      const kind = phase === 'in' || phase === 'out' ? 'moving' : phase === 'still' ? 'held' : null;
      if (kind) {
        const row = el.getAttribute('data-lt-id').slice(8);
        id = row + '|' + (row.startsWith('template-') && kind === 'moving' ? phase : kind);
      }
    }
    if (id !== (cur ? cur.id : null)) {
      if (cur) {
        const r = (s[cur.id] = s[cur.id] || { frames: 0, ms: 0, worst: 0 });
        r.ms += cur.last - cur.start;
      }
      cur = id ? { id, start: t, last: t } : null;
    } else if (cur) {
      const r = (s[cur.id] = s[cur.id] || { frames: 0, ms: 0, worst: 0 });
      r.frames += 1;
      r.worst = Math.max(r.worst, t - cur.last);
      cur.last = t;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
const READ = `(() => window.drashtiLowerThirdFrames ?? null)()`;

interface Counted {
  frames: number;
  ms: number;
  worst: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** How much of a row's frames a screen drew, against `fps` a second (null: it never saw the row move). */
export function keptOf(c: Counted | undefined, fps = 60): number | null {
  if (!c || c.ms <= 0) return null;
  return Math.min(1, c.frames / (c.ms / (1000 / fps)));
}

/** Score a design phase by its pace and by the share of frames over its full scheduled length. */
export function keptOfPhase(c: Counted | undefined, fps: number, durationMs: number): number | null {
  const pace = keptOf(c, fps);
  if (!c || pace === null) return null;
  // The first sampled frame begins the interval. COUNT counts only its following callbacks.
  const expectedFrames = Math.max(1, Math.floor((durationMs * fps) / 1000));
  return Math.min(pace, (c.frames + 1) / expectedFrames);
}

function durationOf(lowerThird: LowerThird, phase: 'in' | 'out'): number {
  const id = phase === 'out' ? (lowerThird.outAnimation ?? lowerThird.animation) : lowerThird.animation;
  const animation = animationById(id);
  return animationLength(animation, phase, cutIntoUnits(shownLines(lowerThird.lines), animation).units);
}

/** How long a scenario's rows take as it plays them (ms): each one's in, its hold, its out and the gap after it. */
export function scheduledMs(rows: readonly Played[]): number {
  return rows.reduce(
    (ms, p) => ms + durationOf(p.lowerThird, 'in') + p.holdMs + durationOf(p.lowerThird, 'out') + AFTER_MS,
    0,
  );
}

export function lowerThirdsScenario(deps: ScenarioDeps, set: LowerThirdsSet): ScenarioRun {
  // Each screen, and how many frames a second it draws: an output the display's 60, the stream's page its own.
  const screens = (): { page: Pick<BrowserWindow, 'webContents'>; fps: number }[] => {
    const program = deps.program?.() ?? null;
    return [
      ...deps.outputs().map((page) => ({ page, fps: 60 })),
      ...(program ? [{ page: program, fps: PROGRAM_FPS }] : []),
    ];
  };
  return {
    slides: { presentationId: null, everyMs: 2000 },
    begin: async () => {
      await Promise.all(
        screens().map((s) => s.page.webContents.executeJavaScript(COUNT, true).catch(() => undefined)),
      );
    },
    end: async () => {
      const rows = await playedRows(set);
      const began = Date.now();
      // Each row in turn: in, held, out, the next once it has gone.
      for (const p of rows) {
        const lt = p.lowerThird;
        deps.engine.dispatch({ type: 'showLowerThird', lowerThird: lt });
        await sleep(durationOf(lt, 'in') + p.holdMs);
        deps.engine.dispatch({ type: 'hideLowerThird' });
        await sleep(durationOf(lt, 'out') + AFTER_MS);
      }
      const took = Date.now() - began;
      const counted = screens();
      const seen = (await Promise.all(
        counted.map((s) => s.page.webContents.executeJavaScript(READ, true).catch(() => null)),
      )) as (Record<string, Counted> | null)[];
      const percent = (k: number | null) => (k === null ? 'unseen' : `${String(Math.round(k * 100))}%`);
      // Each row's worst screen, and the rows not smooth on one of them.
      const results = rows.map((p) => {
        const id = p.lowerThird.id.slice(8);
        const kept = seen.flatMap((screen, i) => {
          const fps = counted[i]?.fps ?? 60;
          if (p.measure !== 'phases') return [keptOf(screen?.[id + '|' + p.measure], fps)];
          return (['in', 'out'] as const).map((phase) =>
            keptOfPhase(screen?.[id + '|' + phase], fps, durationOf(p.lowerThird, phase)),
          );
        });
        const worst =
          kept.length === 0 || kept.some((k) => k === null) ? null : Math.min(...(kept as number[]));
        return { row: p.row, worst, smooth: worst !== null && worst >= 0.9 };
      });
      const rough = results.filter((r) => !r.smooth);
      const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
      return {
        checks: [
          {
            name: 'every lower-thirds row and each design entrance and exit kept 9 in 10 of its frames on every screen',
            // A scenario with no rows measured nothing (lower-thirds-more on a tree with no row added since alpha.17).
            ok: seen.length > 0 && results.length > 0 && rough.length === 0,
            detail:
              results.length === 0
                ? `no rows to play in ${set}`
                : rough.length === 0
                  ? `all ${plural(results.length, 'row')} smooth`
                  : `not smooth: ${rough.map((r) => `${r.row} ${percent(r.worst)}`).join(', ')}`,
          },
        ],
        summary: `scenario ${set}: ${plural(seen.length, 'screen')} (the stream’s page last when on), ${plural(results.length, 'row')} in ${minutes(took)} (${minutes(scheduledMs(rows))} as scheduled), each row’s frames kept on its worst screen: ${results.map((r) => `${r.row} ${percent(r.worst)}`).join(', ')}`,
      };
    },
  };
}
