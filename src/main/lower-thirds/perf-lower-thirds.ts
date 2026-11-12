import type { BrowserWindow } from 'electron';
import { animationById, animationLength, cutIntoUnits } from '../../shared/lower-third-animations';
import type { LowerThirdLook } from '../../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThird, shownLines } from '../../shared/lower-thirds';
import type { ScenarioDeps, ScenarioRun } from '../perf-scenarios';
import { PROGRAM_FPS } from '../stream/program-window';
import { plural } from '../../shared/text';

/*
 * The Performance check's lower-thirds scenario (Session 55, Part 16; DRASHTI_PERF_SCENARIO=lower-thirds, the
 * Performance workflow's "scenario"): every row of the Lower Thirds studio's offered set (shared/lower-third-studio.ts,
 * OFFERED) played in turn on every screen, and how many of its frames each screen drew. Run with the workflow's
 * handicap on Windows (two cores, no graphics chip), it says which are smooth there: one that is not is left out by
 * deleting its row, and nothing else need change (the owner's answer E3, 30 Oct 2026: one run decides).
 *
 * The usual check runs first (slide changes every two seconds through the import, as in a sabha); then, the import
 * over and its slide changes done, each row in turn over the last slide: a family of animation in its first
 * direction at its steady speed (in, a moment held, out); each way a band comes in, with lines fading in; each style,
 * sliding in and out; each moving background, held four seconds. Each screen counts its animation frames (its own
 * frame callbacks) while a row moves, against what it draws a second (an output 60, the stream's page its own 30): a
 * row keeps 9 in 10 of them on every screen, or it is not smooth. Each new template plays its complete design.
 * Placeholder words only.
 */

/** One row of OFFERED, as the lower third the scenario plays for it. */
interface Played {
  /** "animation blur", "band slide", "style glass", "background shine". */
  row: string;
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

/** Every row of the offered set, as a lower third to play (in the table's order). */
export async function playedRows(): Promise<Played[]> {
  const [
    { BAND_INTROS, FAMILIES, idFor, OFFERED },
    { LOWER_THIRD_TEMPLATES },
    { CANDIDATE_LOWER_THIRD_DESIGNS },
  ] = await Promise.all([
    import('../../shared/lower-third-studio'),
    import('../../shared/lower-third-templates'),
    import('../../shared/lower-third-designs'),
  ]);
  const made = (row: string, animation: string, look: Partial<LowerThirdLook>, hold = HOLD_MS): Played => ({
    row,
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
        return [made(`background ${r.key}`, 'fade-steady', { motion: r.key }, BACKGROUND_HOLD_MS)];
    }
  });
  const designs = LOWER_THIRD_TEMPLATES.filter(
    (template) => animationById(template.input.animation).composition,
  );
  const candidates = CANDIDATE_LOWER_THIRD_DESIGNS.map(({ id, animation, look }) => ({
    id,
    input: {
      lines: ['Placeholder name', 'Placeholder role', ''],
      look: { ...DEFAULT_LOWER_THIRD_LOOK, ...look },
      where: 'both' as const,
      animation,
    },
  }));
  return [
    ...offered,
    ...[...designs, ...candidates].map((template): Played => ({
      row: 'template ' + template.id,
      lowerThird: { ...template.input, id: 'perf-lt-template-' + template.id },
      holdMs: HOLD_MS,
      measure: 'phases',
    })),
  ];
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

export function lowerThirdsScenario(deps: ScenarioDeps): ScenarioRun {
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
      const rows = await playedRows();
      // Each row in turn: in, held, out, the next once it has gone.
      for (const p of rows) {
        const lt = p.lowerThird;
        deps.engine.dispatch({ type: 'showLowerThird', lowerThird: lt });
        await sleep(durationOf(lt, 'in') + p.holdMs);
        deps.engine.dispatch({ type: 'hideLowerThird' });
        await sleep(durationOf(lt, 'out') + AFTER_MS);
      }
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
      return {
        checks: [
          {
            name: 'every lower-thirds row and each design entrance and exit kept 9 in 10 of its frames on every screen',
            ok: seen.length > 0 && rough.length === 0,
            detail:
              rough.length === 0
                ? `all ${plural(results.length, 'row')} smooth`
                : `not smooth: ${rough.map((r) => `${r.row} ${percent(r.worst)}`).join(', ')}`,
          },
        ],
        summary: `scenario lower-thirds: ${plural(seen.length, 'screen')} (the stream’s page last when on), each row’s frames kept on its worst screen: ${results.map((r) => `${r.row} ${percent(r.worst)}`).join(', ')}`,
      };
    },
  };
}
