import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../../shared/deck';
import type { PicturesResult } from '../../../shared/pictures';
import { readInfo } from '../../convert/read-info';
import { openDatabase } from '../../db/database';
import { ImportRepo } from '../../db/imports';
import { MediaRepo } from '../../db/media';
import { PresentationRepo } from '../../db/presentations';
import { ffmpegHere } from '../../testing/ffmpeg-here';
import { MediaStore } from '../media-store';
import { runImport } from '../pipeline';
import { makeDeckMedia, makeTestDeck, TRIAL_SLIDES } from '../testing/make-deck';

/*
 * A deck imported "with its animations" (Session 54, C2), end to end in the import: C1's trial deck, its media made
 * by FFmpeg, its movie made by the stand-in (as on CI, which has no Office) and cut for real. Then the same deck
 * as pictures (nothing here makes its movie), with its videos as real videos; again with its animations in place
 * of those pictures; as pictures while the stream is on air; and on a computer with neither PowerPoint nor Keynote.
 */

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);

/** A tiny PNG of one colour (a page as the main process would draw it). */
function png(rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(3, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.from([0, ...Array.from({ length: 4 }, () => rgb).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat([row, row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe.skipIf(!ffmpegHere(ffmpeg))(
  'a deck imported with its animations (the stand-in makes its movie)',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-import-'));
    const deck = join(dir, 'Placeholder trial.pptx');
    beforeAll(() => {
      writeFileSync(deck, makeTestDeck(TRIAL_SLIDES, makeDeckMedia(ffmpeg, join(dir, 'made'))));
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function setup() {
      const root = mkdtempSync(join(dir, 'library-'));
      const mediaDir = join(root, 'Media');
      mkdirSync(mediaDir);
      const db = openDatabase(join(root, 'drashti.sqlite'));
      const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
      const run = (
        options: { baker: boolean | 'stand-in'; converters: boolean | 'stand-in'; onAir?: boolean },
        paths = [deck],
      ) =>
        runImport({
          db,
          media,
          runId: randomUUID(),
          paths,
          options: {},
          progressEveryMs: 0,
          tempDir: root,
          ffmpeg,
          baker: options.baker,
          converters: options.converters,
          onAir: () => Promise.resolve(options.onAir === true),
          drawPdf: (_pdf, outDir): Promise<PicturesResult> => {
            // The stand-in's PDF has a page per shown slide: five.
            mkdirSync(outDir, { recursive: true });
            const pages = [0, 1, 2, 3, 4].map((index) => {
              const file = join(outDir, `page-${String(index + 1)}.png`);
              writeFileSync(file, png([20 + index * 40, 30, 90]));
              return { index, file, notes: '' };
            });
            return Promise.resolve({ ok: true, width: 1920, height: 1080, pages, total: 5, failed: [] });
          },
        });
      const repo = new PresentationRepo(db);
      const slidesOf = (id: string) => repo.get(id)?.groups.flatMap((g) => g.slides) ?? [];
      return { db, mediaDir, run, repo, slidesOf, report: (id: string) => new ImportRepo(db).report(id) };
    }

    it('comes in with each slide’s steps, its one picture, its real videos and sounds, and the report’s words', async () => {
      const t = setup();
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in' });
      expect(summary.totals).toMatchObject({ imported: 1, failed: 0, presentations: 1, slides: 5 });
      const item = t.report(summary.id)?.items[0];
      const id = item?.target?.id ?? '';
      const slides = t.slidesOf(id);
      const decks: DeckSlide[] = slides.flatMap((s) => (s.slide.deck ? [s.slide.deck] : []));
      // Step 0 coming in, then one per click; the hidden slide left out.
      expect(decks.map((d) => d.steps.length)).toEqual([5, 3, 2, 1, 2]);
      expect(slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.filter((s) => !s.hidden).map((s) => s.notes));
      // ONE picture each: the last step's last frame, over the whole slide (the stand-in's movie is 320 × 180).
      for (const s of slides) {
        const [picture] = s.slide.elements;
        expect(picture).toMatchObject({ kind: 'image', frame: { x: 0, y: 0, width: 320, height: 180 } });
        expect(picture?.kind === 'image' ? picture.mediaId : '').toBe(s.slide.deck?.steps.at(-1)?.lastId);
      }
      // Each slide but the first was made after the one before it: its step-0 clip starts on that one's last still.
      expect(decks.map((d) => d.after)).toEqual([
        undefined,
        ...decks.slice(0, -1).map((d) => d.steps.at(-1)?.lastId),
      ]);
      // The deck's own transitions, with their lengths; the chime as real sound.
      expect(decks.map((d) => [d.transition?.name, d.transition?.durationMs])).toEqual([
        ['p:fade', 700],
        ['p:push', 1000],
        ['p:wipe', 800],
        ['p:cover', 1000],
        ['p14:vortex', 1500],
      ]);
      expect(decks.map((d) => Boolean(d.transition?.soundId))).toEqual([false, true, false, false, false]);
      expect(decks[0]?.steps[0]?.transitionMs).toBe(700);
      // The spin's slide holds one turn after each step.
      expect(decks[2]?.steps.map((s) => s.holdMs)).toEqual([2000, 2000]);
      expect(decks[2]?.steps.every((s) => s.holdId)).toBe(true);
      // The trimmed, looping video at 80 %, starting by itself after its slide's transition (1 s, and PowerPoint's 60 ms).
      const [auto] = decks[3]?.media ?? [];
      expect(auto).toMatchObject({
        kind: 'video',
        clip: { startMs: 1000, endMs: 4000 },
        loop: true,
        volume: 0.8,
        start: { step: 0, offsetMs: 1060 },
      });
      expect(auto?.posterId).toBeTruthy();
      // ...and as a video on the slide at its box, so the time bar and the play bar apply.
      const video = slides[3]?.slide.elements[1];
      expect(video).toMatchObject({ kind: 'video', fit: 'stretch', loop: true, volume: 0.8 });
      expect(video?.kind === 'video' ? video.mediaId : '').toBe(auto?.mediaId);
      expect(video?.frame.x).toBe(Math.round((2.4 / 13.3333) * 320));
      // The click's video at 50 % with its fade in, at the click; the sound by itself as the slide comes in.
      const [clickVideo, sound] = decks[4]?.media ?? [];
      expect(clickVideo).toMatchObject({ kind: 'video', volume: 0.5, fadeInMs: 500, start: { step: 1 } });
      expect(sound).toMatchObject({ kind: 'audio', volume: 1, start: { step: 0, offsetMs: 1560 } });
      expect(slides[4]?.slide.elements.filter((e) => e.kind === 'video')).toHaveLength(1);
      // Every file is the deck's, out of the Media list, as a deck's pages are.
      expect(new MediaRepo(t.db).list()).toEqual([]);
      // A step's clip is as long as it says.
      const clipFile = new MediaRepo(t.db).kindAndFile(decks[1]?.steps[1]?.clipId ?? '');
      expect(clipFile?.kind).toBe('video');
      const info = await readInfo(ffmpeg, join(t.mediaDir, clipFile?.path ?? ''));
      expect(Math.abs((info.durationMs ?? 0) - (decks[1]?.steps[1]?.clipMs ?? 0))).toBeLessThanOrEqual(100);
      expect(info.audio).toBeNull();
      const codes = item?.issues.map((i) => i.code) ?? [];
      expect(codes).toEqual(
        expect.arrayContaining([
          'deck-animations',
          'deck-steps-checked',
          'deck-media',
          'deck-transition-sounds',
        ]),
      );
      expect(item?.issues.find((i) => i.code === 'deck-animations')?.message).toMatch(
        /^The stand-in made this deck’s movie with its animations in \d+ s: 5 slides with 8 clicks\./u,
      );
      expect(item?.issues.find((i) => i.code === 'pictures-hidden')?.message).toBe(
        '1 slide is hidden in the file and left out, as in its slide show.',
      );
      // Imported again, unchanged: it is in the library already, with its animations.
      const again = await t.run({ baker: 'stand-in', converters: 'stand-in' });
      expect(t.report(again.id)?.items[0]?.outcome).toBe('skipped');
    }, 240_000);

    it('a slide after a hidden one was made after the shown slide before it', async () => {
      const t = setup();
      const [build, chain, , , , hidden] = TRIAL_SLIDES;
      if (!build || !chain || !hidden) throw new Error('no trial slides');
      const skipping = join(dir, 'Placeholder skipping.pptx');
      writeFileSync(skipping, makeTestDeck([build, hidden, chain], makeDeckMedia(ffmpeg, join(dir, 'made'))));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in' }, [skipping]);
      const slides = t.slidesOf(t.report(summary.id)?.items[0]?.target?.id ?? '');
      expect(slides).toHaveLength(2);
      const [first, second] = slides.map((s) => s.slide.deck);
      expect(first?.after).toBeUndefined();
      expect(second?.after).toBe(first?.steps.at(-1)?.lastId);
    }, 240_000);

    it('as pictures where nothing makes its movie: its videos real videos on their slides, its sound the slide’s', async () => {
      const t = setup();
      const summary = await t.run({ baker: false, converters: 'stand-in' });
      const item = t.report(summary.id)?.items[0];
      expect(item?.outcome).toBe('imported');
      const slides = t.slidesOf(item?.target?.id ?? '');
      expect(slides).toHaveLength(5);
      expect(slides.every((s) => !('deck' in s.slide))).toBe(true);
      expect(slides.map((s) => s.slide.elements.map((e) => e.kind))).toEqual([
        ['image'],
        ['image'],
        ['image'],
        ['image', 'video'],
        ['image', 'video'],
      ]);
      expect(slides[3]?.slide.elements[1]).toMatchObject({
        kind: 'video',
        loop: true,
        volume: 0.8,
        fit: 'stretch',
      });
      // The sound that starts by itself plays as its slide goes up.
      expect(slides[4]?.cues).toMatchObject([{ kind: 'audio', volume: 1, loop: false }]);
      // The trimmed video keeps its trims as its own start and end points.
      const videoId =
        slides[3]?.slide.elements[1]?.kind === 'video' ? slides[3].slide.elements[1].mediaId : '';
      expect(new MediaRepo(t.db).markersOf(videoId)).toMatchObject({ startMs: 1000, endMs: 4000 });
      const codes = item?.issues.map((i) => i.code) ?? [];
      expect(codes).toEqual(expect.arrayContaining(['pictures', 'deck-media', 'deck-sounds']));
      expect(item?.issues.find((i) => i.code === 'deck-media')?.message).toBe(
        'Its 2 videos came in as real videos where the slides have them, with the time bar under LIVE; they start as their slide goes up.',
      );

      // Imported again where its movie can be made: in place of the pictures, with its animations.
      const again = await t.run({ baker: 'stand-in', converters: 'stand-in' });
      const replaced = t.report(again.id)?.items[0];
      expect(replaced?.outcome).toBe('replaced');
      expect(replaced?.target?.id).toBe(item?.target?.id);
      expect(t.slidesOf(item?.target?.id ?? '').map((s) => s.slide.deck?.steps.length)).toEqual([
        5, 3, 2, 1, 2,
      ]);
    }, 240_000);

    it('as pictures while the stream is on air, saying so', async () => {
      const t = setup();
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in', onAir: true });
      const item = t.report(summary.id)?.items[0];
      expect(item?.outcome).toBe('imported');
      expect(t.slidesOf(item?.target?.id ?? '').every((s) => !s.slide.deck)).toBe(true);
      expect(item?.issues.find((i) => i.code === 'deck-pictures')?.message).toBe(
        'The stream was on air, so Drashti did not make this deck’s animations (that would slow the stream): its slides came in as pictures, without their animations. Import it again once the stream is off air.',
      );
    }, 120_000);

    it('on a computer with neither PowerPoint nor Keynote: its videos and sound as media, and what needs one said plainly', async () => {
      const t = setup();
      const summary = await t.run({ baker: false, converters: false });
      const items = t.report(summary.id)?.items ?? [];
      const deckItem = items.find((i) => i.sourcePath === deck);
      expect(deckItem?.outcome).toBe('failed');
      expect(deckItem?.message).toContain('no Keynote or PowerPoint');
      expect(deckItem?.issues.find((i) => i.code === 'deck-needs-app')?.message).toBe(
        'Its 3 videos and sounds came in as media (in the Media list), with the time bar. Its slides as pictures, and its animations, clicks and transitions, need PowerPoint (or Keynote on a Mac): import it on a computer with one, or save it as PDF there and import the PDF here.',
      );
      expect(
        new MediaRepo(t.db)
          .list()
          .map((m) => m.kind)
          .sort(),
      ).toEqual(['audio', 'video', 'video']);
    }, 120_000);
  },
);
