import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type DeckSlide, stepCount } from '../../../shared/deck';
import type { ConflictChoice } from '../../../shared/import';
import type { PicturesResult } from '../../../shared/pictures';
import { readInfo } from '../../convert/read-info';
import { openDatabase } from '../../db/database';
import { ImportRepo } from '../../db/imports';
import { MediaRepo } from '../../db/media';
import { PresentationRepo } from '../../db/presentations';
import { ffmpegHere, testFfmpeg } from '../../testing/ffmpeg-here';
import { MediaStore, UPLOADS_DIR } from '../media-store';
import { runImport } from '../pipeline';
import * as bake from './bake';
import { makeDeckMedia, makeTestDeck, type TestDeckSlide, TRIAL_SLIDES } from '../testing/make-deck';
import { placeholderSlides } from '../testing/timing-placeholders';
import { readZipEntries } from '../zip';
import { copyZipReplacing } from './zip-copy';

/*
 * A deck imported "with its animations" (Session 54, C2), end to end in the import: C1's trial deck, its media made
 * by FFmpeg, its movie made by the stand-in (as on CI, which has no Office) and cut for real. Then the same deck
 * as pictures (nothing here makes its movie), with its videos as real videos; again with its animations in place
 * of those pictures; as pictures while the stream is on air; and on a computer with neither PowerPoint nor Keynote.
 */

// Drashti's own FFmpeg; on CI's Ubuntu, CI's own Linux one, so the whole unit suite there runs this too (Session 58).
const ffmpeg = testFfmpeg({ linux: true });

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
    // Every library a test opens, closed before the folder goes: Windows will not delete a file still open.
    const opened: { close(): unknown }[] = [];
    beforeAll(() => {
      writeFileSync(deck, makeTestDeck(TRIAL_SLIDES, makeDeckMedia(ffmpeg, join(dir, 'made'))));
    });
    afterAll(() => {
      for (const db of opened) db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    function setup() {
      const root = mkdtempSync(join(dir, 'library-'));
      const mediaDir = join(root, 'Media');
      mkdirSync(mediaDir);
      const db = openDatabase(join(root, 'drashti.sqlite'));
      opened.push(db);
      const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
      const run = (
        options: {
          baker: boolean | 'stand-in';
          converters: boolean | 'stand-in';
          /** On air now, or from the nth time it is asked (the stream going on air while the deck is made). */
          onAir?: boolean | { from: number };
          /** The operator's answer to an earlier run's question, for the deck. */
          decision?: ConflictChoice;
          /** The policy for files updated by a smart playlist. */
          onConflict?: ConflictChoice;
          /** An FFmpeg that is not there: the stand-in cannot make the movie. */
          noFfmpeg?: boolean;
          /** The disk's free space, as the deck's bake sees it (the media folder's own is plenty). */
          freeBytes?: number;
          /** How many pages the stand-in's PDF has (one per shown slide; the trial deck's five). */
          pages?: number;
          log?: (line: string) => void;
          /** Each presentation written, as soon as its group is committed. */
          onWrote?: (wrote: { presentationId: string; replaced: boolean }) => void;
        },
        paths = [deck],
      ) =>
        runImport({
          db,
          media,
          runId: randomUUID(),
          paths,
          options: {
            onConflict: options.onConflict,
            ...(options.decision ? { decisions: { [paths[0] ?? '']: options.decision } } : {}),
          },
          progressEveryMs: 0,
          tempDir: root,
          ffmpeg: options.noFfmpeg ? join(root, 'no-ffmpeg-here') : ffmpeg,
          baker: options.baker,
          log: options.log,
          converters: options.converters,
          ...(options.freeBytes === undefined ? {} : { freeBytes: () => options.freeBytes ?? 0 }),
          ...(options.onWrote ? { onWrote: options.onWrote } : {}),
          onAir: (() => {
            let asked = 0;
            const on = options.onAir;
            return () => Promise.resolve(on === true || (typeof on === 'object' && ++asked >= on.from));
          })(),
          drawPdf: (_pdf, outDir): Promise<PicturesResult> => {
            // The stand-in's PDF has a page per shown slide: the trial deck's five.
            mkdirSync(outDir, { recursive: true });
            const total = options.pages ?? 5;
            const pages = Array.from({ length: total }, (_, index) => {
              const file = join(outDir, `page-${String(index + 1)}.png`);
              writeFileSync(file, png([20 + index * 40, 30, 90]));
              return { index, file, notes: '' };
            });
            return Promise.resolve({ ok: true, width: 1920, height: 1080, pages, total, failed: [] });
          },
        });
      const repo = new PresentationRepo(db);
      const slidesOf = (id: string) => repo.get(id)?.groups.flatMap((g) => g.slides) ?? [];
      return { db, mediaDir, run, repo, slidesOf, report: (id: string) => new ImportRepo(db).report(id) };
    }

    it('keeps the baked steps, plays a supported slide natively, and keeps the deck’s real videos and sounds', async () => {
      const t = setup();
      const log: string[] = [];
      const summary = await t.run({
        baker: 'stand-in',
        converters: 'stand-in',
        log: (line) => log.push(line),
      });
      expect(summary.totals).toMatchObject({ imported: 1, failed: 0, presentations: 1, slides: 5 });
      expect(log.filter((line) => line.includes('steps checked'))).toEqual([
        expect.stringMatching(/^Deck: \d+ steps checked, the furthest/u),
      ]);
      const item = t.report(summary.id)?.items[0];
      const id = item?.target?.id ?? '';
      const slides = t.slidesOf(id);
      const decks: DeckSlide[] = slides.flatMap((s) => (s.slide.deck ? [s.slide.deck] : []));
      // Step 0 coming in, then one per click. Slide 4 can play its push and video without a clip.
      expect(decks.map(stepCount)).toEqual([5, 3, 2, 1, 2]);
      expect(decks.map((d) => d.steps.length)).toEqual([5, 3, 2, 0, 2]);
      expect(decks[3]?.motion).toMatchObject({ approximate: false, stepsMs: [0] });
      expect(slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.filter((s) => !s.hidden).map((s) => s.notes));
      // Baked slides draw the movie's last frame. The native slide keeps its editable title.
      for (const i of [0, 1, 2, 4]) {
        const [picture] = slides[i]?.slide.elements ?? [];
        expect(picture).toMatchObject({ kind: 'image', frame: { x: 0, y: 0, width: 320, height: 180 } });
        expect(picture?.kind === 'image' ? picture.mediaId : '').toBe(decks[i]?.steps.at(-1)?.lastId);
      }
      expect(slides[3]?.slide.elements).toContainEqual(
        expect.objectContaining({ kind: 'text', text: 'Moving tessel plays by itself' }),
      );
      // The final baked transition can still use the native slide's last still as its lead-in.
      expect(decks[3]?.sourceStillId).toBeTruthy();
      expect(decks.map((d) => d.after)).toEqual([
        undefined,
        decks[0]?.steps.at(-1)?.lastId,
        decks[1]?.steps.at(-1)?.lastId,
        undefined,
        decks[3]?.sourceStillId,
      ]);
      // The deck's own transitions, with their lengths; the chime as real sound.
      expect(decks.map((d) => [d.transition?.name, d.transition?.durationMs])).toEqual([
        ['p:fade', 700],
        ['p:push', 1000],
        ['p:wipe', 800],
        ['p:push', 1000],
        ['p14:vortex', 1500],
      ]);
      expect(decks.map((d) => Boolean(d.transition?.soundId))).toEqual([false, true, false, false, false]);
      expect(decks[0]?.steps[0]?.transitionMs).toBe(700);
      // The spin's slide holds one turn after each step.
      expect(decks[2]?.steps.map((s) => s.holdMs)).toEqual([2000, 2000]);
      expect(decks[2]?.steps.every((s) => s.holdId)).toBe(true);
      // Shown from the slide's start to its end: no entrance or exit of their own.
      expect(decks.flatMap((d) => d.media.map((m) => [m.enterStep, m.exitStep]))).toEqual([
        [undefined, undefined],
        [undefined, undefined],
        [undefined, undefined],
      ]);
      // The native clock starts the trimmed, looping video as soon as its slide's transition ends.
      const [auto] = decks[3]?.media ?? [];
      expect(auto).toMatchObject({
        kind: 'video',
        clip: { startMs: 1000, endMs: 4000 },
        loop: true,
        volume: 0.8,
        start: { step: 0, offsetMs: 0 },
      });
      expect(auto?.posterId).toBeTruthy();
      // It stays a video on the slide at its own box, with the time bar and play bar.
      const nativeVideos = slides[3]?.slide.elements.filter((element) => element.kind === 'video') ?? [];
      expect(nativeVideos).toHaveLength(1);
      const [video] = nativeVideos;
      expect(video).toMatchObject({ kind: 'video', fit: 'stretch', loop: true, volume: 0.8 });
      expect(video?.kind === 'video' ? video.mediaId : '').toBe(auto?.mediaId);
      expect(video?.frame.x).toBeCloseTo((2.4 / 13.3333) * 320, 1);
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
      // The tests' stand-in makes the movie as PowerPoint does, and the report names PowerPoint, as a real computer's
      // says (Session 55: the guides' pictures never show the tests' own words).
      expect(item?.issues.find((i) => i.code === 'deck-animations')?.message).toMatch(
        /^PowerPoint made this deck’s movie with its animations in \d+ s: 5 slides with 8 clicks\./u,
      );
      expect(item?.issues.find((i) => i.code === 'pictures-hidden')?.message).toBe(
        '1 slide is hidden in the file and left out, as in its slide show.',
      );
      // Imported again, unchanged: it is in the library already, with its animations.
      const again = await t.run({ baker: 'stand-in', converters: 'stand-in' });
      expect(t.report(again.id)?.items[0]?.outcome).toBe('skipped');
    }, 240_000);

    it('only the slides that move go through its movie: the rest come in as their pictures straight away (Session 56)', async () => {
      const t = setup();
      // A transition and three clicks, plain, plain, two clicks, plain, plain.
      const mixed = join(dir, 'Placeholder mixed.pptx');
      writeFileSync(mixed, makeTestDeck(placeholderSlides(6), makeDeckMedia(ffmpeg, join(dir, 'made'))));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in', pages: 6 }, [mixed]);
      const item = t.report(summary.id)?.items[0];
      expect(item?.outcome).toBe('imported');
      const slides = t.slidesOf(item?.target?.id ?? '');
      expect(slides).toHaveLength(6);
      const decks = slides.map((s) => s.slide.deck);
      // The two that move with their steps; the slide before the second as its picture, a still step of its own;
      // the rest as their pictures, no deck at all.
      expect(decks.map((d) => d?.steps.length)).toEqual([4, undefined, 1, 3, undefined, undefined]);
      expect(decks[2]?.steps[0]?.clipMs).toBe(0);
      const pictureOf = (i: number) => {
        const e = slides[i]?.slide.elements[0];
        return e?.kind === 'image' ? e.mediaId : '';
      };
      expect(decks[2]?.steps[0]?.lastId).toBe(pictureOf(2));
      // The second plays its own transition-free coming in after that very picture.
      expect(decks[3]?.after).toBe(pictureOf(2));
      // The still slides' pictures are the PDF's pages (the stand-in's 4 × 3), the others the movie's (320 × 180).
      const widthOf = (i: number) => {
        const file = new MediaRepo(t.db).kindAndFile(pictureOf(i));
        return readFileSync(join(t.mediaDir, file?.path ?? '')).readUInt32BE(16);
      };
      expect([0, 1, 2, 3, 4, 5].map(widthOf)).toEqual([320, 4, 4, 320, 4, 4]);
      expect(slides.map((s) => s.notes)).toEqual(placeholderSlides(6).map((s) => s.notes));
      // Each slide knows its own page of the original (Edit slides reads its words from it).
      const pages = (
        t.db
          .prepare(
            `SELECT s.document_page AS page FROM slides s JOIN slide_groups g ON g.id = s.group_id
             WHERE g.presentation_id = ? ORDER BY g.position, s.position`,
          )
          .all(item?.target?.id ?? '') as { page: string | null }[]
      ).map((r) => (JSON.parse(r.page ?? 'null') as { page?: number } | null)?.page);
      expect(pages).toEqual([0, 1, 2, 3, 4, 5]);
      expect(item?.issues.find((i) => i.code === 'deck-animations')?.message).toMatch(
        /^PowerPoint made this deck’s movie with its animations in \d+ s: 2 slides with 5 clicks\./u,
      );
      expect(item?.issues.find((i) => i.code === 'deck-still-slides')?.message).toBe(
        '4 slides have nothing that moves (no animations, transition, video or sound), so they came in as their pictures straight away.',
      );
    }, 240_000);

    /** Each slide's deck in the library now, in a word: preparing, its steps, or a plain picture. */
    const decksNow = (t: ReturnType<typeof setup>, id: string) =>
      t.slidesOf(id).map((s) => {
        const d = s.slide.deck;
        return d?.preparing ? 'preparing' : d ? `${String(d.steps.length)} steps` : 'picture';
      });

    it('shows its slides as their pictures at once, those that move marked as preparing, then their steps in their place (Session 56)', async () => {
      const t = setup();
      const deckFile = join(dir, 'Placeholder preparing.pptx');
      writeFileSync(deckFile, makeTestDeck(placeholderSlides(6), makeDeckMedia(ffmpeg, join(dir, 'made'))));
      const writes: { id: string; replaced: boolean; decks: string[] }[] = [];
      const summary = await t.run(
        {
          baker: 'stand-in',
          converters: 'stand-in',
          pages: 6,
          onWrote: (w) =>
            writes.push({ id: w.presentationId, replaced: w.replaced, decks: decksNow(t, w.presentationId) }),
        },
        [deckFile],
      );
      // First its pictures, the two that move preparing (the lead-in a still step of its own); then the deck in place.
      expect(writes).toEqual([
        {
          id: writes[0]?.id,
          replaced: false,
          decks: ['preparing', 'picture', '1 steps', 'preparing', 'picture', 'picture'],
        },
        {
          id: writes[0]?.id,
          replaced: true,
          decks: ['4 steps', 'picture', '1 steps', '3 steps', 'picture', 'picture'],
        },
      ]);
      // One line in the report, as an import of it.
      const items = t.report(summary.id)?.items ?? [];
      expect(items.map((i) => [i.outcome, i.target?.id])).toEqual([['imported', writes[0]?.id]]);
      expect(summary.totals).toMatchObject({ imported: 1, presentations: 1, slides: 6 });
    }, 240_000);

    it('an edit to its slides while their animations are made wins: they stay as they are, the marks gone, said in the report (Session 56)', async () => {
      const t = setup();
      const deckFile = join(dir, 'Placeholder edited.pptx');
      writeFileSync(deckFile, makeTestDeck(placeholderSlides(6), makeDeckMedia(ffmpeg, join(dir, 'made'))));
      let edited = false;
      const summary = await t.run(
        {
          baker: 'stand-in',
          converters: 'stand-in',
          pages: 6,
          // The operator changes it as soon as it shows (its content moves on, as a save in Edit slides moves it).
          onWrote: (w) => {
            if (edited) return;
            edited = true;
            t.db
              .prepare('UPDATE presentations SET content_rev = content_rev + 1 WHERE id = ?')
              .run(w.presentationId);
          },
        },
        [deckFile],
      );
      const item = t.report(summary.id)?.items[0];
      expect(item).toMatchObject({
        outcome: 'imported',
        message:
          'It was changed while its animations were being made, so it was kept as it was, as its pictures: import it again for its animations.',
      });
      expect(decksNow(t, item?.target?.id ?? '')).toEqual([
        'picture',
        'picture',
        '1 steps',
        'picture',
        'picture',
        'picture',
      ]);
    }, 240_000);

    it('a deck where nothing moves comes in as its pictures straight away, with no movie made (Session 56)', async () => {
      const t = setup();
      const still = join(dir, 'Placeholder still.pptx');
      const plain = placeholderSlides(6).filter((_, i) => i % 3 !== 0);
      writeFileSync(still, makeTestDeck(plain, makeDeckMedia(ffmpeg, join(dir, 'made'))));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in', pages: 4 }, [still]);
      const item = t.report(summary.id)?.items[0];
      expect(item?.outcome).toBe('imported');
      const slides = t.slidesOf(item?.target?.id ?? '');
      expect(slides).toHaveLength(4);
      expect(slides.every((s) => !s.slide.deck)).toBe(true);
      const codes = item?.issues.map((i) => i.code) ?? [];
      expect(codes).toContain('deck-still');
      expect(codes).not.toContain('deck-animations');
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

    it('a sound set to play across slides keeps its slides, with its slide or on a click; as pictures, its slide’s sound says so (Session 54)', async () => {
      const t = setup();
      const tone = {
        id: 3,
        type: 'audio' as const,
        name: 'Long tone',
        media: 'tone' as const,
        poster: 'speaker' as const,
        x: 9_000_000,
        y: 2_000_000,
        w: 900_000,
        h: 900_000,
        acrossSlides: 3,
      };
      const across: TestDeckSlide[] = [
        {
          key: 'across-auto',
          bg: '1B2A4A',
          transition: { kind: 'fade', dur: 500 },
          notes: 'Placeholder notes: a sound across slides, by itself.',
          shapes: [tone],
          effects: [{ kind: 'play', target: 3, dur: 6000, start: 'after' }],
        },
        {
          key: 'across-click',
          bg: '0F3D2E',
          transition: { kind: 'fade', dur: 500 },
          notes: 'Placeholder notes: a sound across slides, on a click.',
          shapes: [tone],
          effects: [{ kind: 'play', target: 3, dur: 6000, start: 'click' }],
        },
      ];
      const made = makeDeckMedia(ffmpeg, join(dir, 'made'));
      const file = join(dir, 'Placeholder across.pptx');
      // An unsupported transition keeps the original baked audio path.
      const withVortex = across.map((slide) => ({ ...slide, transition: { kind: 'vortex', dur: 500 } }));
      writeFileSync(file, makeTestDeck(withVortex, made));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in' }, [file]);
      const item = t.report(summary.id)?.items[0];
      const [auto, click] = t.slidesOf(item?.target?.id ?? '');
      // The deck's own, with its slide and at its click, each across its three slides (main/engine/across-slides.ts):
      // never a slide's sound cue.
      expect([auto?.cues, click?.cues]).toEqual([[], []]);
      const mediaOf = (s: typeof auto) =>
        s?.slide.deck?.media.map((m) => [
          m.kind,
          m.name,
          m.acrossSlides,
          'step' in m.start ? m.start.step : null,
        ]);
      expect(mediaOf(auto)).toEqual([['audio', 'Long tone', 3, 0]]);
      expect(mediaOf(click)).toEqual([['audio', 'Long tone', 3, 1]]);
      const words = item?.issues.map((i) => i.message) ?? [];
      expect(words).toContain(
        '2 sounds set to play across slides play on as the slides and their clicks change, as in its slide show, each until its last slide; Next and Back never start one again.',
      );
      // With only supported transitions, the same audio starts on the same steps without a movie.
      const nativeFile = join(dir, 'Placeholder native across.pptx');
      writeFileSync(nativeFile, makeTestDeck(across, made));
      const native = setup();
      const played = await native.run({ baker: 'stand-in', converters: 'stand-in', pages: 2 }, [nativeFile]);
      const nativeItem = native.report(played.id)?.items[0];
      const nativeSlides = native.slidesOf(nativeItem?.target?.id ?? '');
      expect(nativeSlides.map((s) => s.slide.deck?.steps.length)).toEqual([0, 0]);
      expect(nativeSlides.map((s) => stepCount(s.slide.deck))).toEqual([1, 2]);
      expect(nativeSlides.map(mediaOf)).toEqual([
        [['audio', 'Long tone', 3, 0]],
        [['audio', 'Long tone', 3, 1]],
      ]);
      expect(nativeItem?.issues.map((i) => i.code)).not.toContain('deck-animations');
      // If the stream is on air, the unsupported deck comes in as pictures with its automatic sound.
      const pictures = setup();
      const again = await pictures.run({ baker: 'stand-in', converters: 'stand-in', onAir: true, pages: 2 }, [
        file,
      ]);
      const asPictures = pictures.report(again.id)?.items[0];
      const [first, second] = pictures.slidesOf(asPictures?.target?.id ?? '');
      expect(first?.cues).toMatchObject([{ kind: 'audio', label: 'Long tone', acrossSlides: 3 }]);
      expect(second?.cues).toEqual([]);
      const said = asPictures?.issues.map((i) => i.message) ?? [];
      expect(said).toContain(
        '1 sound set to play across slides plays on from its slide, as in its slide show, until its last slide; Next and Back never start it again.',
      );
      expect(said).toContain(
        '1 sound that started on a click, or with a transition, is left out: they need the deck’s animations, which PowerPoint or Keynote makes.',
      );
    }, 240_000);

    it('as pictures, a slide’s own sound where the music plays on takes its place, and the report says so; with its animations both play (Session 54)', async () => {
      const t = setup();
      const shape = (id: number, name: string, media: 'tone' | 'chime', acrossSlides?: number) => ({
        id,
        type: 'audio' as const,
        name,
        media,
        poster: 'speaker' as const,
        x: 9_000_000,
        y: 2_000_000,
        w: 900_000,
        h: 900_000,
        ...(acrossSlides ? { acrossSlides } : {}),
      });
      const slide = (key: string, shapes: TestDeckSlide['shapes'], play: number[]): TestDeckSlide => ({
        key,
        bg: '1B2A4A',
        transition: { kind: 'vortex', dur: 500 },
        notes: `Placeholder notes: ${key}.`,
        shapes,
        effects: play.map((target) => ({ kind: 'play' as const, target, dur: 600, start: 'after' as const })),
      });
      const deckSlides: TestDeckSlide[] = [
        slide('music', [shape(3, 'Placeholder music', 'tone', 999)], [3]),
        slide('quiet', [], []),
        slide('chime', [shape(3, 'Placeholder chime', 'chime')], [3]),
      ];
      const file = join(dir, 'Placeholder music and chime.pptx');
      writeFileSync(file, makeTestDeck(deckSlides, makeDeckMedia(ffmpeg, join(dir, 'made'))));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in', onAir: true, pages: 3 }, [
        file,
      ]);
      const item = t.report(summary.id)?.items[0];
      const slides = t.slidesOf(item?.target?.id ?? '');
      expect(
        slides.map((s) => s.cues.map((c) => (c.kind === 'audio' ? [c.label, c.acrossSlides] : []))),
      ).toEqual([[['Placeholder music', 999]], [], [['Placeholder chime', undefined]]]);
      expect(item?.issues.find((i) => i.code === 'deck-sound-over-music')?.message).toBe(
        'The sound of slide 3 takes the place of the sound playing across slides as that slide goes up: as pictures, one sound plays at a time (with the deck’s animations, both play).',
      );
      // With its animations: the music the deck's own across its slides, the chime its slide's own; nothing said.
      const baked = setup();
      const withSteps = await baked.run({ baker: 'stand-in', converters: 'stand-in' }, [file]);
      const bakedItem = baked.report(withSteps.id)?.items[0];
      const decks = baked.slidesOf(bakedItem?.target?.id ?? '').map((s) => s.slide.deck);
      expect(decks.map((d) => d?.media.map((m) => [m.name, m.acrossSlides]))).toEqual([
        [['Placeholder music', 999]],
        [],
        [[undefined, undefined]],
      ]);
      expect(bakedItem?.issues.some((i) => i.code === 'deck-sound-over-music')).toBe(false);
    }, 240_000);

    it('follows a linked video only inside the deck’s own folder: a link out of it (a phone’s crafted deck) is refused', async () => {
      const t = setup();
      const made = makeDeckMedia(ffmpeg, join(dir, 'made'));
      // A private video elsewhere on this computer, and another beside the deck.
      const elsewhere = join(dir, 'elsewhere');
      const folder = join(dir, 'deck folder');
      mkdirSync(elsewhere, { recursive: true });
      mkdirSync(folder, { recursive: true });
      const secret = join(elsewhere, 'Private clip.mp4');
      writeFileSync(secret, made.clip1);
      writeFileSync(join(folder, 'Beside clip.mp4'), made.clip2);
      const video = (id: number, name: string, link: string) => ({
        id,
        type: 'video' as const,
        name,
        media: 'clip1' as const,
        poster: 'poster1' as const,
        x: 1_000_000,
        y: 1_000_000,
        w: 4_000_000,
        h: 2_250_000,
        link,
      });
      const linked: TestDeckSlide[] = [
        {
          key: 'linked',
          bg: '1B2A4A',
          transition: { kind: 'fade', dur: 500 },
          notes: 'Placeholder notes: two linked videos.',
          shapes: [
            video(3, 'Out clip', pathToFileURL(secret).href),
            video(4, 'In clip', 'Beside%20clip.mp4'),
          ],
          effects: [],
        },
      ];
      const file = join(folder, 'Placeholder linked.pptx');
      writeFileSync(file, makeTestDeck(linked, made));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in' }, [file]);
      const item = t.report(summary.id)?.items[0];
      const [slide] = t.slidesOf(item?.target?.id ?? '');
      const files = new MediaRepo(t.db);
      const [out, inside] = slide?.slide.deck?.media ?? [];
      // The video beside the deck came in; the one elsewhere never did: missing, its bytes never copied.
      expect(files.kindAndFile(inside?.mediaId ?? '')).toMatchObject({ kind: 'video', missing: false });
      expect(files.kindAndFile(out?.mediaId ?? '')).toMatchObject({ missing: true });
      const sha = createHash('sha256').update(made.clip1).digest('hex');
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM media WHERE sha256 = ?').get(sha)).toEqual({ n: 0 });
      expect(item?.issues.map((i) => i.code)).toContain('missing-media');
    }, 240_000);

    it('a deck a phone sent follows no link at all, not even to a file beside it in the phones’ folder', async () => {
      const t = setup();
      const made = makeDeckMedia(ffmpeg, join(dir, 'made'));
      // What phones send waits in the media folder's own folder: another phone's video there, and the deck.
      const uploads = join(t.mediaDir, UPLOADS_DIR);
      mkdirSync(uploads, { recursive: true });
      writeFileSync(join(uploads, 'Another phone clip.mp4'), made.clip1);
      const sent: TestDeckSlide[] = [
        {
          key: 'sent',
          bg: '1B2A4A',
          transition: { kind: 'fade', dur: 500 },
          notes: 'Placeholder notes: a linked video.',
          shapes: [
            {
              id: 3,
              type: 'video',
              name: 'Linked clip',
              media: 'clip1',
              poster: 'poster1',
              x: 1_000_000,
              y: 1_000_000,
              w: 4_000_000,
              h: 2_250_000,
              link: 'Another%20phone%20clip.mp4',
            },
          ],
          effects: [],
        },
      ];
      const file = join(uploads, 'upload-1.pptx');
      writeFileSync(file, makeTestDeck(sent, made));
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in' }, [file]);
      const [slide] = t.slidesOf(t.report(summary.id)?.items[0]?.target?.id ?? '');
      const [linked] = slide?.slide.deck?.media ?? [];
      expect(new MediaRepo(t.db).kindAndFile(linked?.mediaId ?? '')).toMatchObject({ missing: true });
      const sha = createHash('sha256').update(made.clip1).digest('hex');
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM media WHERE sha256 = ?').get(sha)).toEqual({ n: 0 });
    }, 240_000);

    it('as pictures while the movie is deferred: its videos real videos on their slides, its sound the slide’s', async () => {
      const t = setup();
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in', onAir: true });
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

      // Import again with animations when they are available. The older pictures keep their own slides.
      const originalId = item?.target?.id ?? '';
      const original = t.repo.content(originalId);
      const again = await t.run({ baker: 'stand-in', converters: 'stand-in' });
      const kept = t.report(again.id)?.items[0];
      expect(kept?.outcome).toBe('kept-both');
      const newId = kept?.target?.id ?? '';
      expect(newId).not.toBe(originalId);
      expect(t.repo.content(originalId)).toEqual(original);
      expect(t.slidesOf(originalId).every((s) => !s.slide.deck)).toBe(true);
      expect(t.slidesOf(newId).map((s) => stepCount(s.slide.deck))).toEqual([5, 3, 2, 1, 2]);

      // The smart playlist’s replace policy updates the earlier deck in place.
      const explicit = setup();
      const first = await explicit.run({ baker: 'stand-in', converters: 'stand-in', onAir: true });
      expect(explicit.report(first.id)?.items[0]?.outcome).toBe('imported');
      const firstId = explicit.report(first.id)?.items[0]?.target?.id ?? '';
      expect(explicit.slidesOf(firstId).every((s) => !s.slide.deck)).toBe(true);
      const replacement = await explicit.run({
        baker: 'stand-in',
        converters: 'stand-in',
        onConflict: 'replace',
      });
      expect(explicit.report(replacement.id)?.items[0]).toMatchObject({
        outcome: 'replaced',
        target: { id: firstId },
      });
      expect(explicit.slidesOf(firstId).map((s) => stepCount(s.slide.deck))).toEqual([5, 3, 2, 1, 2]);
    }, 240_000);

    it('a deck that came in as pictures, answered Replace but whose animations cannot be made, is kept untouched', async () => {
      const t = setup();
      const first = await t.run({ baker: 'stand-in', converters: 'stand-in', onAir: true });
      const id = t.report(first.id)?.items[0]?.target?.id ?? '';
      const before = t.repo.content(id);
      const again = await t.run({
        baker: 'stand-in',
        converters: 'stand-in',
        decision: 'replace',
        noFfmpeg: true,
      });
      const kept = t.report(again.id)?.items[0];
      expect(kept?.outcome).toBe('skipped');
      expect(kept?.target?.id).toBe(id);
      expect(kept?.message).toBe(
        'It could not come in with its animations, so “Placeholder trial” was kept as it was: import it again once the reason below is put right.',
      );
      expect(kept?.issues.map((i) => i.code)).toEqual(['deck-pictures']);
      // Untouched: every row as it was.
      expect(t.repo.content(id)).toEqual(before);
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

    it('stops making its animations when the stream goes on air while its steps are cut, and comes in as pictures', async () => {
      const t = setup();
      // Off air as the import looks (twice) and as the movie is made; on air as its steps are cut.
      const summary = await t.run({ baker: 'stand-in', converters: 'stand-in', onAir: { from: 4 } });
      const item = t.report(summary.id)?.items[0];
      expect(item?.outcome).toBe('imported');
      expect(t.slidesOf(item?.target?.id ?? '').every((s) => !s.slide.deck)).toBe(true);
      expect(item?.issues.find((i) => i.code === 'deck-pictures')?.message).toBe(
        'The stream went on air, so Drashti stopped making this deck’s animations (that would slow the stream): its slides came in as pictures, without their animations. Import it again once the stream is off air.',
      );
    }, 120_000);

    it('makes no animations with too little free disk space for them, and comes in as pictures saying so', async () => {
      const t = setup();
      // 2 GB and 10 MB free: 2 GB is always kept free, and the deck's movie and steps need more than the rest.
      const summary = await t.run({
        baker: 'stand-in',
        converters: 'stand-in',
        freeBytes: 2 * 1024 ** 3 + 10 * 1024 ** 2,
      });
      const item = t.report(summary.id)?.items[0];
      expect(item?.outcome).toBe('imported');
      expect(t.slidesOf(item?.target?.id ?? '').every((s) => !s.slide.deck)).toBe(true);
      expect(item?.issues.find((i) => i.code === 'deck-pictures')?.message).toMatch(
        /^There is not enough free disk space to make this deck’s animations \(it needs about [\d.]+ [MG]B more than the 2 GB Drashti keeps free\): its slides came in as pictures, without their animations\.$/u,
      );
    }, 120_000);

    it.each([
      { reason: 'automation was refused', notAllowed: true },
      { reason: 'PowerPoint did not finish the movie' },
    ])('explains the editable fallback when $reason', async ({ reason, notAllowed }) => {
      const failure = vi.spyOn(bake, 'bakeDeck').mockResolvedValueOnce({
        ok: false,
        baker: 'stand-in',
        why: { kind: 'app', reason, message: reason, notAllowed },
        pdf: null,
        deck: null,
        deckFile: null,
      });
      try {
        const t = setup();
        const summary = await t.run({ baker: 'stand-in', converters: false });
        expect(failure).toHaveBeenCalledOnce();
        const item = t.report(summary.id)?.items[0];
        expect(item?.outcome).toBe('imported');
        expect(t.slidesOf(item?.target?.id ?? '')[0]?.slide.deck?.motion).toBeDefined();
        expect(item?.issues.find((issue) => issue.code === 'deck-pictures')?.message).toBe(
          `PowerPoint could not make the deck’s movie (${reason}): Drashti brought in editable slides with the effects it can play. Check the deck’s clicks and transitions before going live.`,
        );
      } finally {
        failure.mockRestore();
      }
    });

    it('without Office, keeps native clicks, real media starts, and warnings for the closest effects', async () => {
      const t = setup();
      const summary = await t.run({ baker: false, converters: false });
      const item = t.report(summary.id)?.items.find((i) => i.sourcePath === deck);
      expect(item?.outcome).toBe('imported');
      const slides = t.slidesOf(item?.target?.id ?? '');
      const decks = slides.map((s) => s.slide.deck);
      expect(slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.filter((s) => !s.hidden).map((s) => s.notes));
      expect(decks.map(stepCount)).toEqual([5, 3, 2, 1, 2]);
      expect(decks.map((d) => d?.steps.length)).toEqual([0, 0, 0, 0, 0]);
      expect(decks.map((d) => d?.motion?.approximate)).toEqual([true, true, true, false, true]);
      expect(decks[3]?.media[0]).toMatchObject({
        kind: 'video',
        clip: { startMs: 1000, endMs: 4000 },
        start: { step: 0, offsetMs: 0 },
      });
      expect(decks[4]?.media.map((m) => [m.kind, 'step' in m.start ? m.start.step : 'clicked'])).toEqual([
        ['video', 1],
        ['audio', 0],
      ]);
      expect(item?.issues.filter((i) => i.code === 'deck-motion-approximated').map((i) => i.message)).toEqual(
        [1, 2, 3, 5].map(
          (index) =>
            `Slide ${index} uses the closest effects Drashti can play. Check its clicks and transition before going live.`,
        ),
      );
      expect(new MediaRepo(t.db).list()).toEqual([]);
    }, 120_000);

    it('keeps the deck’s embedded media when the slide size cannot be drawn and no converter is available', async () => {
      const t = setup();
      const part = 'ppt/presentation.xml';
      const xml = (await readZipEntries(deck, (name) => name === part)).get(part)?.toString('utf8') ?? '';
      const size = /<p:sldSz cx="\d+"/u;
      expect(xml).toMatch(size);
      const tooWide = join(dir, 'Placeholder outside editable width.pptx');
      await copyZipReplacing(
        deck,
        tooWide,
        new Map([[part, Buffer.from(xml.replace(size, '<p:sldSz cx="200000000"'))]]),
      );
      const summary = await t.run({ baker: false, converters: false }, [tooWide]);
      const items = t.report(summary.id)?.items ?? [];
      const deckItem = items.find((i) => i.sourcePath === tooWide);
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
