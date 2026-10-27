import type { Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeckMedia, DeckSlide } from '../../src/shared/deck';
import type { SlideElement } from '../../src/shared/model';
import type { PageGlobals } from './helpers';
import { importAndGetIds } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestTone } from './test-media';

/*
 * A deck's slides made in the test (Session 54, C2), with no PowerPoint, no Keynote and no import of a deck: the
 * bundled FFmpeg makes each step's clip as a flat dark colour and its last frame as a bright one, a hold that goes
 * round in magenta, a placeholder video with a poster and a tone; they come into Media as any file does, and the test
 * writes the deck's slides into the library through the slide editor's own save, as C2's import stores them (each
 * slide's picture its last step's last frame, its videos on it at their boxes). Generated media and placeholder words
 * only, so the screens' pixels say which step shows: dark while its clip plays, bright once it is over.
 */

export const ffmpeg = testFfmpeg();

/** Each step's colours (rgb), dark while its clip plays and bright once it is over. */
export const STEP_COLOURS = [
  { clip: [96, 0, 0], last: [224, 32, 32] },
  { clip: [0, 96, 0], last: [32, 224, 32] },
  { clip: [0, 0, 96], last: [32, 32, 224] },
] as const;
/** Step 2's hold, going round while it waits for the next click. */
export const HOLD_COLOUR = [192, 32, 192] as const;
/** The second slide's one step. */
export const NEXT_COLOURS = { clip: [96, 96, 0], last: [224, 224, 32] } as const;
/** How long each step's clip is (ms), and how much of the coming-in clip is the deck's own transition. */
export const CLIP_MS = 1500;
export const TRANSITION_MS = 400;

const hex = (rgb: readonly number[]) => rgb.map((c) => c.toString(16).padStart(2, '0')).join('');

/** A flat colour for `seconds` (an H.264 MP4, 320 × 180, 30 frames a second), or one frame of it as a PNG. */
function colour(file: string, rgb: readonly number[], seconds: number | null): string {
  const input = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x${hex(rgb)}:s=320x180:r=30`,
  ];
  const out =
    seconds === null
      ? ['-frames:v', '1', file]
      : [
          '-t',
          String(seconds),
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '15',
          file,
        ];
  const r = spawnSync(ffmpeg ?? '', [...input, ...out]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  return file;
}

/**
 * Two flat colours one after the other (an H.264 MP4): a coming-in clip as a deck's movie cuts it, beginning on the
 * slide before's last colour for `firstSeconds` (the deck's own transition), then the slide's own.
 */
function twoColours(
  file: string,
  first: readonly number[],
  second: readonly number[],
  firstSeconds: number,
): string {
  const lavfi = (rgb: readonly number[], d: number) => [
    '-f',
    'lavfi',
    '-i',
    `color=c=0x${hex(rgb)}:s=320x180:r=30:d=${String(d)}`,
  ];
  const r = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...lavfi(first, firstSeconds),
    ...lavfi(second, CLIP_MS / 1000 - firstSeconds),
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '15',
    file,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  return file;
}

/** A placeholder video of FFmpeg's test pattern, `seconds` long, with no sound. */
function pattern(file: string, seconds: number): string {
  const r = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=30',
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '15',
    file,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  return file;
}

/** The stand-in deck's files, by what each is, as Media has them (their ids). */
export interface DeckFiles {
  clips: string[];
  lasts: string[];
  hold: string;
  nextClip: string;
  nextLast: string;
  video: string;
  poster: string;
  tone: string;
  /** A coming-in clip beginning on step 1's last colour (green), then the next slide's own (yellow). */
  through: string;
}

/** Make the stand-in deck's files and bring them into Media. */
export async function makeDeckFiles(win: Page): Promise<DeckFiles> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-stand-in-'));
  const files = [
    ...STEP_COLOURS.map((c, i) =>
      colour(join(dir, `Placeholder step ${String(i)}.mp4`), c.clip, CLIP_MS / 1000),
    ),
    ...STEP_COLOURS.map((c, i) => colour(join(dir, `Placeholder step ${String(i)} end.png`), c.last, null)),
    colour(join(dir, 'Placeholder hold.mp4'), HOLD_COLOUR, 1),
    colour(join(dir, 'Placeholder next step.mp4'), NEXT_COLOURS.clip, CLIP_MS / 1000),
    colour(join(dir, 'Placeholder next end.png'), NEXT_COLOURS.last, null),
    pattern(join(dir, 'Placeholder deck video.mp4'), 6),
    colour(join(dir, 'Placeholder poster.png'), [40, 40, 40], null),
    makeTestTone(join(dir, 'Placeholder deck sound.wav'), { seconds: 8, hz: 440 }),
    twoColours(
      join(dir, 'Placeholder through.mp4'),
      STEP_COLOURS[1].last,
      NEXT_COLOURS.last,
      TRANSITION_MS / 1000,
    ),
  ];
  const ids = await importAndGetIds(win, files);
  const at = (i: number) => ids[i] ?? '';
  return {
    clips: [at(0), at(1), at(2)],
    lasts: [at(3), at(4), at(5)],
    hold: at(6),
    nextClip: at(7),
    nextLast: at(8),
    video: at(9),
    poster: at(10),
    tone: at(11),
    through: at(12),
  };
}

/** The stand-in deck's two slides: three steps (the last with its hold), then one. */
export function standInDecks(
  f: DeckFiles,
  more: { first?: Partial<DeckSlide>; second?: Partial<DeckSlide> } = {},
) {
  const first: DeckSlide = {
    transition: { name: 'push', durationMs: TRANSITION_MS },
    steps: f.clips.map((clipId, i) => ({
      clipId,
      clipMs: CLIP_MS,
      lastId: f.lasts[i] ?? '',
      ...(i === 0 ? { transitionMs: TRANSITION_MS } : {}),
      ...(i === 2 ? { holdId: f.hold, holdMs: 1000 } : {}),
    })),
    media: [],
    ...more.first,
  };
  const second: DeckSlide = {
    transition: { name: 'fade', durationMs: TRANSITION_MS },
    // Made after the first slide, as an import of the whole deck makes it (C review): it comes in order after it.
    after: f.lasts[2] ?? '',
    steps: [{ clipId: f.nextClip, clipMs: CLIP_MS, transitionMs: TRANSITION_MS, lastId: f.nextLast }],
    media: [],
    ...more.second,
  };
  return [first, second];
}

/** A deck's video on its slide, as a deck's import places it (its box a fraction of the slide). */
export function deckVideo(f: DeckFiles, start: DeckMedia['start']): DeckMedia {
  return {
    kind: 'video',
    mediaId: f.video,
    box: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
    posterId: f.poster,
    loop: false,
    volume: 1,
    start,
  };
}

/** A deck's sound (DeckMedia only, no element), as a deck's import keeps it. */
export function deckSound(f: DeckFiles, start: DeckMedia['start']): DeckMedia {
  return {
    kind: 'audio',
    mediaId: f.tone,
    box: { x: 0, y: 0, w: 0.05, h: 0.05 },
    loop: true,
    volume: 1,
    start,
  };
}

/**
 * A presentation of the deck's slides, written into the library as C2's import stores them (through the slide
 * editor's own save): each slide's picture its last step's last frame over the whole slide, its videos at their boxes.
 */
export async function writeDeck(
  win: Page,
  name: string,
  decks: DeckSlide[],
  /** Slides left unticked (by index: kept, skipped in the show), and the presentation's own transition. */
  more: { unticked?: number[]; transition?: { kind: 'dissolve'; durationMs: number } } = {},
): Promise<string> {
  return win.evaluate(
    async ({ name, decks, more }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.library.newFromWords(
        name,
        decks.map((_, i) => `Placeholder deck slide ${String(i + 1)}`).join('\n\n'),
      );
      if (!made.ok) throw new Error(made.message);
      const opened = await d.library.slidesForEdit(made.id);
      if (!opened.ok) throw new Error(opened.message);
      const { doc } = opened;
      const all = doc.groups.flatMap((g) => g.slides);
      if (all.length !== decks.length)
        throw new Error(`${String(all.length)} slides, not ${String(decks.length)}`);
      const full = { x: 0, y: 0, width: doc.width, height: doc.height };
      all.forEach((slide, i) => {
        const deck = decks[i];
        if (!deck) return;
        const last = deck.steps.at(-1)?.lastId ?? '';
        const picture: SlideElement = {
          id: `deck-picture-${String(i)}`,
          kind: 'image',
          frame: full,
          mediaId: last,
          fit: 'fit',
        };
        const videos: SlideElement[] = deck.media
          .filter((m) => m.kind === 'video')
          .map((m, j) => ({
            id: `deck-video-${String(i)}-${String(j)}`,
            kind: 'video',
            frame: {
              x: m.box.x * doc.width,
              y: m.box.y * doc.height,
              width: m.box.w * doc.width,
              height: m.box.h * doc.height,
            },
            mediaId: m.mediaId,
            fit: 'fit',
            loop: m.loop,
            volume: m.volume,
          }));
        slide.elements = [picture, ...videos];
        slide.deck = deck;
        if (more.unticked?.includes(i)) slide.enabled = false;
      });
      if (more.transition) doc.transition = more.transition;
      const saved = await d.library.saveSlides(made.id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return made.id;
    },
    { name, decks, more },
  );
}
