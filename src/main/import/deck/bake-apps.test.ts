import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readInfo } from '../../convert/read-info';
import { findConverters } from '../deck-converters';
import { readPptxDeck } from '../pictures';
import { makeDeckMedia, makeTestDeck, TRIAL_SLIDES } from '../testing/make-deck';
import { ffmpegHere } from '../../testing/ffmpeg-here';
import { bakeDeck } from './bake';
import { bakedPresentation } from './deck-import';

/*
 * A deck made into its steps by PowerPoint and Keynote, for real (Session 54, C2): C1's placeholder trial deck,
 * made here, given to this Mac's PowerPoint (its timed copy, its movie) and Keynote (its own movie at its rule),
 * then cut, every step it can see checked against its plan. It runs only where they are installed, and only when
 * asked, because it starts and quits them:
 *
 *   DRASHTI_TEST_CONVERTERS=1 node scripts/vitest-electron.mjs run src/main/import/deck/bake-apps.test.ts
 *
 * Quit Keynote and PowerPoint first (it refuses to start while either is open, so it never touches anyone's
 * documents). Never on CI (its machines have neither app).
 */

const wanted =
  process.env['DRASHTI_TEST_CONVERTERS'] === '1' && process.platform === 'darwin' && !process.env['CI'];
const has = wanted ? await findConverters() : { keynote: false, powerpoint: false };
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, 'ffmpeg');

const running = (name: string) => {
  try {
    return execFileSync('pgrep', ['-x', name], { encoding: 'utf8' }).trim() !== '';
  } catch {
    return false;
  }
};

describe.skipIf(!wanted || !ffmpegHere(ffmpeg) || !(has.keynote || has.powerpoint))(
  'a deck made into its steps by this Mac’s PowerPoint and Keynote, for real',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-bake-'));
    const deck = join(dir, 'Placeholder trial.pptx');
    const log = (line: string) => {
      console.log(line);
      // Kept with the movies, where DRASHTI_KEEP_BAKE names a folder.
      const to = process.env['DRASHTI_KEEP_BAKE'];
      if (to) appendFileSync(join(to, 'log.txt'), `${line}\n`);
    };

    beforeAll(() => {
      if (running('Keynote') || running('Microsoft PowerPoint'))
        throw new Error('Quit Keynote and PowerPoint first: this test starts and quits them.');
      writeFileSync(deck, makeTestDeck(TRIAL_SLIDES, makeDeckMedia(ffmpeg, join(dir, 'made'))));
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    /** Its movie kept for a look, where DRASHTI_KEEP_BAKE names a folder. */
    const keep = (work: string, name: string) => {
      const to = process.env['DRASHTI_KEEP_BAKE'];
      if (!to) return;
      for (const file of ['movie.mov', 'movie.m4v'])
        if (existsSync(join(work, file))) copyFileSync(join(work, file), join(to, `${name}-${file}`));
    };

    it.skipIf(!has.powerpoint)(
      'PowerPoint: its timed copy’s movie, cut with every step it can see within 0.2 s, then quit',
      async () => {
        const work = mkdtempSync(join(dir, 'powerpoint-'));
        const result = await bakeDeck(
          'powerpoint',
          { source: 'pptx', input: deck, read: await readPptxDeck(deck), work },
          { ffmpeg, log },
        );
        keep(work, 'powerpoint');
        if (!result.ok) log(`PowerPoint: ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { baked } = result;
        log(
          `PowerPoint: ${String(baked.bakeMs)} ms; movie ${String(baked.movie.width)}x${String(baked.movie.height)} at ${String(baked.movie.fps)} fps, ${String(baked.movie.durationMs)} ms; offsets ${JSON.stringify(baked.cuts.offsets)}; lost ${JSON.stringify(baked.cuts.lostSlides)}`,
        );
        expect(baked.movie.height).toBe(1080);
        expect(baked.files.map((f) => f.length)).toEqual([5, 3, 2, 1, 2]);
        const measured = baked.cuts.offsets.filter((o) => o.offsetMs !== null);
        expect(measured.length).toBeGreaterThanOrEqual(5);
        for (const o of measured) expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        // The spin's slide holds one turn after each step.
        expect(baked.files[2]?.map((f) => f.hold?.ms)).toEqual([2000, 2000]);
        for (const f of baked.files.flat()) {
          expect(existsSync(f.clip)).toBe(true);
          expect(existsSync(f.last)).toBe(true);
          const info = await readInfo(ffmpeg, f.clip);
          expect(info.audio).toBeNull();
          expect(info.video?.height).toBe(1080);
        }
        // The pictures too, should the movie not do.
        expect(result.pdf && existsSync(result.pdf)).toBe(true);
        // Its videos and sounds as real media, from the deck.
        const parsed = await bakedPresentation('Placeholder trial.pptx', deck, baked, work, ffmpeg);
        expect(parsed.groups[0]?.slides.map((s) => s.deck?.media.length)).toEqual([0, 0, 0, 1, 2]);
        expect(parsed.groups[0]?.slides[3]?.deck?.media[0]?.clip).toEqual({ startMs: 1000, endMs: 4000 });
        // Drashti started it: it is quit.
        expect(running('Microsoft PowerPoint')).toBe(false);
      },
      900_000,
    );

    it.skipIf(!has.keynote)(
      'Keynote: its own movie at its rule, its movies and sounds out first, cut with every step it can see within 0.2 s',
      async () => {
        const work = mkdtempSync(join(dir, 'keynote-'));
        const result = await bakeDeck(
          'keynote',
          { source: 'pptx', input: deck, read: null, work },
          { ffmpeg, log },
        );
        keep(work, 'keynote');
        if (!result.ok) log(`Keynote: ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { baked } = result;
        log(
          `Keynote: ${String(baked.bakeMs)} ms; movie ${String(baked.movie.width)}x${String(baked.movie.height)}, ${String(baked.movie.durationMs)} ms; offsets ${JSON.stringify(baked.cuts.offsets)}; media ${JSON.stringify(baked.keynoteMedia)}`,
        );
        expect(baked.movie.height).toBe(1080);
        expect(baked.plan.slides).toHaveLength(5);
        const measured = baked.cuts.offsets.filter((o) => o.offsetMs !== null);
        for (const o of measured) expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        // Keynote says each movie's volume and loop (its PowerPoint copy leaves the loop out).
        expect(baked.keynoteMedia.filter((m) => m.kind === 'video').map((m) => [m.slide, m.loop])).toEqual([
          [4, true],
          [5, false],
        ]);
        expect(running('Keynote')).toBe(false);
      },
      900_000,
    );

    it.skipIf(!has.keynote)(
      'Keynote: a Keynote file of its own, its steps from its own PowerPoint copy, its videos and sound out of that copy',
      async () => {
        // A Keynote file, made by Keynote from the trial deck (as the PDF test makes one).
        const key = join(dir, 'Placeholder trial.key');
        execFileSync('open', ['-g', '-j', '-b', 'com.apple.iWork.Keynote', deck]);
        execFileSync(
          'osascript',
          [
            ...[
              'on run argv',
              'tell application id "com.apple.iWork.Keynote"',
              'repeat 300 times',
              'if (count of documents) > 0 then exit repeat',
              'delay 0.1',
              'end repeat',
              'set d to document 1',
              'save d in (POSIX file (item 1 of argv))',
              'close d saving no',
              'quit',
              'end tell',
              'end run',
            ].flatMap((l) => ['-e', l]),
            key,
          ],
          { timeout: 120_000 },
        );
        for (let i = 0; i < 60 && running('Keynote'); i++) await new Promise((r) => setTimeout(r, 250));
        const work = mkdtempSync(join(dir, 'keynote-key-'));
        const result = await bakeDeck(
          'keynote',
          { source: 'key', input: key, read: null, work },
          { ffmpeg, log },
        );
        keep(work, 'keynote-key');
        if (!result.ok) log(`Keynote (.key): ${JSON.stringify(result.why)}`);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { baked } = result;
        log(
          `Keynote (.key): ${String(baked.bakeMs)} ms; movie ${String(baked.movie.durationMs)} ms; offsets ${JSON.stringify(baked.cuts.offsets)}`,
        );
        expect(baked.plan.slides).toHaveLength(5);
        for (const o of baked.cuts.offsets.filter((x) => x.offsetMs !== null))
          expect(Math.abs(o.offsetMs ?? 0)).toBeLessThanOrEqual(200);
        const parsed = await bakedPresentation('Placeholder trial.key', key, baked, work, ffmpeg);
        // Its videos and sound, from Keynote's own copy, with Keynote's loop and volume.
        expect(parsed.groups[0]?.slides.map((s) => s.deck?.media.map((m) => m.kind))).toEqual([
          [],
          [],
          [],
          ['video'],
          expect.arrayContaining(['video', 'audio']),
        ]);
        expect(parsed.groups[0]?.slides[3]?.deck?.media[0]).toMatchObject({ loop: true, volume: 0.8 });
        expect(running('Keynote')).toBe(false);
      },
      900_000,
    );
  },
);
