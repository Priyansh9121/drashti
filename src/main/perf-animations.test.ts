import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineCommand } from '../shared/engine/commands';
import { deckFromJson } from '../shared/deck-schema';
import { isDeckNativeTransition } from '../shared/deck-transition';
import { type Db, openDatabase } from './db/database';
import { PresentationRepo } from './db/presentations';
import { deckShow } from './engine/deck-steps';
import { casesUntil, leftoversIn } from './perf-animations';
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
    ).rejects.toThrow(/^The scenarios need the bundled FFmpeg/u);
  });

  it('leaves Session 57’s leftovers (MS-1, DK-6, DK-2) out of the two-core streaming check only', () => {
    // After3 (13 Nov 2026): that check ran into its 14-minute stop with them, and its figures were lost.
    expect(leftoversIn({ streaming: true, twoCores: true })).toBe(false);
    expect(leftoversIn({ streaming: false, twoCores: true })).toBe(true);
    expect(leftoversIn({ streaming: true, twoCores: false })).toBe(true);
    expect(leftoversIn({ streaming: false, twoCores: false })).toBe(true);
  });

  it('stops pressing at its six minutes, or once Drashti has been up 12 minutes if that comes first (the check stops at 14)', () => {
    const now = 1_800_000_000_000;
    expect(casesUntil(now, 60_000)).toEqual({ at: now + 360_000, by: 'budget' });
    expect(casesUntil(now, 6 * 60_000)).toEqual({ at: now + 360_000, by: 'budget' });
    expect(casesUntil(now, 9 * 60_000)).toEqual({ at: now + 180_000, by: 'uptime' });
    // Up longer already: no case at all.
    expect(casesUntil(now, 13 * 60_000)).toEqual({ at: now - 60_000, by: 'uptime' });
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
      const kept = (
        db
          .prepare(
            'SELECT s.deck FROM slides s JOIN slide_groups g ON g.id = s.group_id WHERE g.presentation_id = ?',
          )
          .all(deck?.id ?? '') as { deck: string | null }[]
      ).map((r) => deckFromJson(r.deck));
      expect(kept).toHaveLength(1);
      expect(kept[0]?.steps).toHaveLength(3);
      expect(kept[0]?.steps.every((s) => s.clipMs === 1500 && s.clipId !== '' && s.lastId !== '')).toBe(true);
    });

    it('makes table slides as the import keeps an editable PowerPoint table of 250 cells, words fitting and shrinking (MS-1)', async () => {
      dir = mkdtempSync(join(tmpdir(), 'drashti-perf-animations-'));
      db = openDatabase(':memory:');
      const run = startScenario('animations', {
        db,
        mediaDir: dir,
        ffmpeg,
        engine: engine(),
        outputs: () => [],
      });
      // Made before the check's measured part: the reader of a deck's editable copy, on a generated deck.
      await run.begin();
      const repo = new PresentationRepo(db);
      const table = repo.list().find((p) => p.name === 'Placeholder perf table slides');
      const slides = repo.get(table?.id ?? '')?.groups.flatMap((g) => g.slides) ?? [];
      expect(slides).toHaveLength(4);
      const cells = (s: (typeof slides)[number]) =>
        s.slide.elements.flatMap((e) => (e.kind === 'text' && e.tableCell ? [e] : []));
      for (const s of slides) {
        // Every cell its own text box, measuring itself on each screen (shrink to fit), as an imported deck's are.
        expect(cells(s)).toHaveLength(250);
        expect(cells(s).every((c) => c.style.shrinkToFit === true)).toBe(true);
        expect(
          new Set(cells(s).map((c) => `${String(c.tableCell?.row)},${String(c.tableCell?.column)}`)).size,
        ).toBe(250);
        // Within the editable reader's 500 objects a slide, its fills and edges included; on with the editor's fade.
        expect(s.slide.elements.length).toBeLessThanOrEqual(500);
        expect(s.slide.elements.some((e) => e.kind === 'shape')).toBe(true);
        expect(s.transition).toEqual({ kind: 'dissolve', durationMs: 800 });
      }
      // The second two are the same tables with words longer than their cells: each box makes them smaller.
      const [fitA, fitB, shrinkA, shrinkB] = slides;
      const longest = (s: (typeof slides)[number] | undefined) =>
        s ? Math.max(...cells(s).map((c) => c.text.length)) : 0;
      expect(Math.min(longest(shrinkA), longest(shrinkB))).toBeGreaterThan(
        2 * Math.max(longest(fitA), longest(fitB)),
      );
    });

    it('makes deck slides Drashti plays itself, each with its own picture, its effects and a sound (DK-6)', () => {
      dir = mkdtempSync(join(tmpdir(), 'drashti-perf-animations-'));
      db = openDatabase(':memory:');
      startScenario('animations', { db, mediaDir: dir, ffmpeg, engine: engine(), outputs: () => [] });
      const repo = new PresentationRepo(db);
      const own = repo.list().find((p) => p.name === 'Placeholder perf deck Drashti plays');
      const slides = repo.get(own?.id ?? '')?.groups.flatMap((g) => g.slides) ?? [];
      expect(slides.length).toBeGreaterThanOrEqual(4);
      const pictures = new Set<string>();
      for (const s of slides) {
        const deck = s.slide.deck;
        // No clip: its effects drawn by Drashti from its shapes, on the engine's time.
        expect(deck?.steps).toEqual([]);
        expect(deck?.motion?.effects.length).toBeGreaterThan(0);
        const shapes = new Set(s.slide.elements.flatMap((e) => (e.sourceShapeId ? [e.sourceShapeId] : [])));
        expect(deck?.motion?.effects.every((e) => shapes.has(e.shapeId))).toBe(true);
        // Its first effect starts with the slide, a fade (seen from its first frame).
        expect(deck?.motion?.effects[0]).toMatchObject({ step: 0, phase: 'in', kind: 'fade', delayMs: 0 });
        // A sound that starts with it.
        expect(deck?.media).toEqual([
          expect.objectContaining({ kind: 'audio', start: { step: 0, offsetMs: 0 }, loop: false }),
        ]);
        // Reached by a cut: what comes is the slide itself, once its picture is drawn.
        expect(s.transition).toEqual({ kind: 'cut', durationMs: 0 });
        for (const e of s.slide.elements) if (e.kind === 'image') pictures.add(e.mediaId);
      }
      // Each slide's own picture, never drawn before its jump: every jump is a cold one.
      expect(pictures.size).toBe(slides.length);
    });

    it('makes a deck Drashti plays itself: by Next its slides come in by its own Wipe, Cover, Uncover and Push, and its last slide’s shapes come in and go out by Split, a click each', () => {
      dir = mkdtempSync(join(tmpdir(), 'drashti-perf-animations-'));
      db = openDatabase(':memory:');
      startScenario('animations', { db, mediaDir: dir, ffmpeg, engine: engine(), outputs: () => [] });
      const repo = new PresentationRepo(db);
      const own = repo
        .list()
        .find((p) => p.name === 'Placeholder perf deck Drashti plays, its own transitions');
      // Read back as the engine and every screen read it, through the deck schema.
      const slides = repo.get(own?.id ?? '')?.groups.flatMap((g) => g.slides) ?? [];
      expect(slides).toHaveLength(5);
      const at = 1_800_000_000_000;
      const came = slides.map((s, i) => {
        const deck = s.slide.deck;
        // Played from its shapes (no clip), exactly; its effects on its own shapes.
        expect(deck?.steps).toEqual([]);
        expect(deck?.motion?.approximate).toBe(false);
        const shapes = new Set(s.slide.elements.flatMap((e) => (e.sourceShapeId ? [e.sourceShapeId] : [])));
        expect(deck?.motion?.effects.every((e) => shapes.has(e.shapeId))).toBe(true);
        // A jump to it is a cut; only Next from the slide before plays its deck's own transition.
        expect(s.transition).toEqual({ kind: 'cut', durationMs: 0 });
        if (!deck) return null;
        const t = deckShow(deck, 'order', i > 0, undefined, at).transition;
        return isDeckNativeTransition(t)
          ? `${t.deckEffect} ${String(t.direction)} ${String(t.durationMs)}`
          : null;
      });
      expect(came).toEqual([null, 'wipe left 700', 'cover left 700', 'uncover up 700', 'push left 700']);
      // The last slide's two shapes: in by Split at its first click, out by Split at its second.
      const motion = slides.at(-1)?.slide.deck?.motion;
      expect(motion?.stepsMs).toHaveLength(3);
      const splits = motion?.effects ?? [];
      expect(splits.every((e) => e.kind === 'split' && e.delayMs === 0 && e.durationMs === 500)).toBe(true);
      const at1 = splits.filter((e) => e.step === 1 && e.phase === 'in').map((e) => e.shapeId);
      const at2 = splits.filter((e) => e.step === 2 && e.phase === 'out').map((e) => e.shapeId);
      expect(at1).toHaveLength(2);
      expect(at2.sort()).toEqual(at1.sort());
      // Nothing else moves on the deck's slides: their own transitions only.
      expect(slides.slice(0, -1).every((s) => s.slide.deck?.motion?.effects.length === 0)).toBe(true);
    });
  });
});
