import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../shared/engine/commands';
import { type Db, openDatabase } from './db/database';
import { PresentationRepo } from './db/presentations';
import { isPerfScenario, scenarioFor, startScenario } from './perf-scenarios';
import { ffmpegHere } from './testing/ffmpeg-here';

/*
 * The Performance check's animations scenario (Session 57, item 6; main/perf-animations.ts): it sets up on the check's
 * own library before the check starts (its slides, a deck made as the e2e tests' stand-in makes one, its pictures), and
 * a fault there must never leave the check waiting for nothing (CI's first runs of it, 12 Nov 2026: 14 minutes, no word).
 */

const APP = join(__dirname, '..', '..');
const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);

let dir = '';
let db: Db | null = null;
afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** The engine as the scenario sees it: every command it is sent, each changing the show. */
function engine() {
  const sent: EngineCommand[] = [];
  return {
    sent,
    dispatch: (command: EngineCommand) => {
      sent.push(command);
      return { ok: true as const, changed: true, rev: sent.length };
    },
  };
}

describe('the animations scenario', () => {
  it('is a scenario of the check, and the Performance workflow offers it with its motion probe', () => {
    expect(isPerfScenario('animations')).toBe(true);
    const workflow = readFileSync(join(APP, '.github', 'workflows', 'performance.yml'), 'utf8');
    expect(workflow).toMatch(/options:\s*\[[^\]]*\banimations,/u);
    expect(workflow).toContain(
      "DRASHTI_TEST_MOTION_PROBE: ${{ inputs.scenario == 'animations' && '1' || '' }}",
    );
  });

  it('a fault while it sets up is the check’s failure at once, with its message, never a wait for nothing', async () => {
    db = openDatabase(':memory:');
    // No FFmpeg to make its pictures with: the set-up stops at once.
    await expect(
      scenarioFor('animations', {
        db,
        mediaDir: tmpdir(),
        ffmpeg: null,
        engine: engine(),
        outputs: () => [],
      }),
    ).rejects.toThrow(/^The animations scenario could not set up: The scenarios need the bundled FFmpeg/u);
  });

  describe.skipIf(!ffmpegHere(ffmpeg))('set up on a library, with FFmpeg', () => {
    it('makes its slides, its deck and its pictures as the check does, without a fault', () => {
      dir = mkdtempSync(join(tmpdir(), 'drashti-perf-animations-'));
      db = openDatabase(':memory:');
      const e = engine();
      const run = startScenario('animations', { db, mediaDir: dir, ffmpeg, engine: e, outputs: () => [] });
      // As in a sabha while the import runs: the check's own slides every two seconds.
      expect(run.slides).toEqual({ presentationId: null, everyMs: 2000 });
      // Over a picture background.
      expect(e.sent[0]?.type).toBe('setBackground');
      const repo = new PresentationRepo(db);
      const byName = (name: string) => repo.list().find((p) => p.name === name);
      const slides = byName('Placeholder perf animation slides');
      const deck = byName('Placeholder perf animation deck');
      expect(slides).toBeDefined();
      expect(deck).toBeDefined();
      // Two slides for each transition and the long fade, each coming on by its own.
      const shown = repo.get(slides?.id ?? '')?.groups.flatMap((g) => g.slides) ?? [];
      expect(shown).toHaveLength(22);
      expect(shown.map((s) => s.transition?.kind)).toEqual(
        [
          'cut',
          'dissolve',
          'fade-black',
          'slide',
          'zoom',
          'wipe',
          'push',
          'zoom-dissolve',
          'lines',
          'words',
          'dissolve',
        ].flatMap((k) => [k, k]),
      );
      // The deck's one slide reads back with its three steps, each a clip and its last frame.
      const deckSlides = repo.get(deck?.id ?? '')?.groups.flatMap((g) => g.slides) ?? [];
      expect(deckSlides).toHaveLength(1);
      expect(deckSlides[0]?.deck?.steps).toHaveLength(3);
      expect(deckSlides[0]?.deck?.steps.every((s) => s.clipMs === 1500 && s.clipId && s.lastId)).toBe(true);
    });
  });
});
