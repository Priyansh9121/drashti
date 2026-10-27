import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { DeckMedia, DeckSlide, DeckStep } from '../../../shared/deck';
import type { ImportIssue } from '../../../shared/import';
import type { MediaElement, SlideElement } from '../../../shared/model';
import { tidyNotes } from '../../../shared/pictures';
import { cutText, plural } from '../../../shared/text';
import { readInfo } from '../../convert/read-info';
import { nameFromFile } from '../formats/text';
import type { ParsedCue, ParsedMediaRef, ParsedPresentation } from '../model';
import { mediaRef } from '../model';
import type { PptxDeck, PptxSlide } from '../pictures';
import { withZip, writeEntry } from '../zip';
import { fileNameOf, pathFromReference } from '../media-resolver';
import { realPlaceAsync } from '../../media/contained';
import type { BakedDeck, BakeFailure, KeynoteMedia } from './bake';
import { MAX_OFFSET_MS } from './cut';
import type { Baker } from './plan';
import { type PptxMedia, stepOfGroup } from './pptx-deck';

/*
 * A deck shown as it was, as the import writes it (Session 54, C2): one slide per shown slide, holding ONE picture
 * (its last step's last frame, so every place that draws a slide today shows it whole), each of the deck's videos
 * as a video on the slide at its box (so the time bar and the play bar apply), and beside them the slide's `deck`
 * (shared/deck.ts): its steps' clips and last frames, its own transition and its sound, and its videos and sounds
 * with how the deck plays them. Every file is a media item hidden from the Media list, as a deck's pages are.
 *
 * Without the steps (no PowerPoint or Keynote to make them, the stream on air, a movie off its plan) the deck comes
 * in as pictures, as before Session 54, and its videos still come in as real videos on their slides, and a sound
 * that starts with its slide as the slide's sound. The report says plainly which, and why.
 */

/** A deck's media file taken out of it (or found where it links to), for the import to copy into Media. */
interface Taken {
  /** Where the import finds it: a file taken out of the deck, or the path or URL the deck links to. */
  path: string;
  /** How long it plays, when FFmpeg could tell (ms). */
  durationMs: number | null;
}

/** The parts of a deck, taken out into `dir` under readable names: each part once. */
export async function takeParts(
  deckFile: string,
  wanted: ReadonlyMap<string, string>,
  dir: string,
): Promise<Map<string, string>> {
  await mkdir(dir, { recursive: true });
  const out = new Map<string, string>();
  const used = new Set<string>();
  await withZip(deckFile, async (entries, fh) => {
    for (const entry of entries) {
      const name = wanted.get(entry.name);
      if (name === undefined || entry.isDirectory) continue;
      // Each its own name in the folder (two videos may be called alike).
      let file = name;
      for (let n = 2; used.has(file.toLowerCase()); n++)
        file = `${basename(name, extname(name))} ${String(n)}${extname(name)}`;
      used.add(file.toLowerCase());
      const target = join(dir, file);
      await writeEntry(fh, entry, target);
      out.set(entry.name, target);
    }
  });
  return out;
}

/** A name for a file that is safe on every disk, from a shape's name and the part's own extension. */
function fileName(label: string, part: string, fallback: string): string {
  const ext = extname(part) || '.bin';
  const base = cutText(
    (label || fallback)
      .replace(/[\\/:*?"<>|]|\p{Cc}/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
    80,
  );
  const named = base === '' ? fallback : base;
  return named.toLowerCase().endsWith(ext.toLowerCase()) ? named : `${named}${ext}`;
}

/** Media references for the presentation, each file once. */
class MediaRefs {
  readonly list: ParsedMediaRef[] = [];
  private readonly at = new Map<string, number>();
  ref(
    path: string,
    kind: ParsedMediaRef['kind'],
    sourcePath: string,
    markers?: ParsedMediaRef['markers'],
  ): string {
    let i = this.at.get(path);
    if (i === undefined) {
      i = this.list.length;
      this.list.push({ originalPath: path, kind, sourcePath, ...(markers ? { markers } : {}) });
      this.at.set(path, i);
    }
    return mediaRef(i);
  }
  /** The index a reference made by `ref` points at. */
  indexOf(ref: string): number {
    return Number(ref.slice(ref.lastIndexOf(':') + 1));
  }
}

/** Keynote's own word on a slide's media (its loop, its volume), matched by kind and the nearest place. */
function keynoteFor(media: PptxMedia, slide: number, told: readonly KeynoteMedia[]): KeynoteMedia | null {
  const centre = (b: { x: number; y: number; w: number; h: number }) =>
    [b.x + b.w / 2, b.y + b.h / 2] as const;
  const [x, y] = centre(media.box);
  let best: KeynoteMedia | null = null;
  let bestD = Infinity;
  for (const k of told) {
    if (k.slide !== slide || k.kind !== media.kind) continue;
    const [kx, ky] = k.box ? centre(k.box) : [x, y];
    const d = Math.hypot(kx - x, ky - y);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

/** Every video and sound of the deck's shown slides, taken out of it (or found where it links to). */
/**
 * Where a deck's linked video or sound is taken from (Session 54, C review): the file it names only when that
 * really is inside the deck's own folder; otherwise a file of its name beside the deck, or nothing. A deck from a
 * phone (or anywhere) never brings in a file from elsewhere on this computer by naming it.
 */
export async function followLink(link: string, deckDir: string): Promise<string> {
  const named = pathFromReference(link);
  const full = isAbsolute(named) ? named : resolve(deckDir, named);
  const place = await realPlaceAsync(deckDir, full);
  return place?.inside ? place.path : join(deckDir, fileNameOf(link));
}

async function takeMedia(
  deckFile: string,
  /** The deck's own folder (the operator's file's, not a copy's): links are followed only inside it. */
  deckDir: string,
  slides: readonly PptxSlide[],
  shown: readonly number[],
  dir: string,
  ffmpeg: string | null,
): Promise<{ media: Map<string, Taken>; posters: Map<string, string>; sounds: Map<string, string> }> {
  const wanted = new Map<string, string>();
  const deckName = nameFromFile(basename(deckFile));
  for (const index of shown) {
    const deck = slides[index]?.deck;
    if (!deck) continue;
    deck.media.forEach((m, n) => {
      if (m.part && !wanted.has(m.part))
        wanted.set(
          m.part,
          fileName(m.name, m.part, `${deckName} ${m.kind === 'audio' ? 'sound' : 'video'} ${String(n + 1)}`),
        );
      if (m.poster && !wanted.has(m.poster))
        wanted.set(m.poster, fileName(`${m.name || deckName} poster`, m.poster, `${deckName} poster`));
    });
    const sound = deck.transition?.sound?.part;
    if (sound && !wanted.has(sound))
      wanted.set(sound, fileName(`${deckName} transition sound`, sound, 'transition sound'));
  }
  const taken = wanted.size > 0 ? await takeParts(deckFile, wanted, dir) : new Map<string, string>();
  const media = new Map<string, Taken>();
  for (const index of shown)
    for (const m of slides[index]?.deck?.media ?? []) {
      const key = m.part ?? m.link ?? '';
      if (key === '' || media.has(key)) continue;
      const path = m.part ? taken.get(m.part) : m.link ? await followLink(m.link, deckDir) : undefined;
      if (!path) continue;
      const info = m.part && ffmpeg ? await readInfo(ffmpeg, path).catch(() => null) : null;
      media.set(key, { path, durationMs: info?.durationMs ?? null });
    }
  const posters = new Map<string, string>();
  const sounds = new Map<string, string>();
  for (const [part, path] of taken) {
    if (/\.(png|jpe?g|gif|bmp|tiff?|emf|wmf)$/iu.test(part)) posters.set(part, path);
    sounds.set(part, path);
  }
  return { media, posters, sounds };
}

/** The deck's trims as points in the file: `end` is cut from the END (PowerPoint's p14:trim). */
function clipOf(m: PptxMedia, durationMs: number | null): { startMs: number; endMs: number | null } | null {
  if (!m.trim) return null;
  const endMs =
    m.trim.endMs > 0 && durationMs !== null ? Math.max(m.trim.startMs + 1, durationMs - m.trim.endMs) : null;
  return { startMs: m.trim.startMs, endMs };
}

const frameOf = (box: PptxMedia['box'], width: number, height: number) => ({
  x: Math.round(box.x * width),
  y: Math.round(box.y * height),
  width: Math.max(1, Math.round(box.w * width)),
  height: Math.max(1, Math.round(box.h * height)),
});

/** What the import makes of a deck with its steps: the presentation, with its media references and report. */
export async function bakedPresentation(
  fileName: string,
  sourcePath: string,
  baked: BakedDeck,
  work: string,
  ffmpeg: string | null,
  /** The deck's own folder: its links are followed only inside it. */
  deckDir: string,
): Promise<ParsedPresentation> {
  const { deck, plan, cuts, files } = baked;
  const width = baked.movie.width > 0 ? baked.movie.width : 1920;
  const height = baked.movie.height > 0 ? baked.movie.height : 1080;
  const shown = plan.slides.map((s) => s.index);
  const { media, posters, sounds } = await takeMedia(
    baked.deckFile,
    deckDir,
    deck.slides,
    shown,
    join(work, 'media'),
    ffmpeg,
  );
  const refs = new MediaRefs();
  const steps = join(work, 'named');
  await mkdir(steps, { recursive: true });
  const slides = [];
  let videos = 0;
  let audios = 0;
  let clicked = 0;
  /** Sounds set to play across slides: the slide's sound; on their own slide, starting later or a second one. */
  let acrossCued = 0;
  let acrossLater = 0;
  let acrossSecond = 0;
  let advancing = 0;
  let transitionSounds = 0;
  let trimmed = 0;
  /** The last still of the shown slide before, which the movie's next transition starts from. */
  let before: string | null = null;
  for (const [i, planned] of plan.slides.entries()) {
    const source = deck.slides[planned.index];
    const d = source?.deck;
    const cut = cuts.slides[i];
    const made = files[i] ?? [];
    const at = `${sourcePath}#slide=${String(planned.index + 1)}`;
    // Readable names for the steps' files (they show where what plays is named).
    const named = async (from: string, label: string) => {
      const to = join(steps, `${label}${extname(from)}`);
      await rename(from, to);
      return to;
    };
    const deckSteps: DeckStep[] = [];
    for (const [k, f] of made.entries()) {
      const label = `Slide ${String(i + 1)} step ${String(k)}`;
      const clip = refs.ref(await named(f.clip, label), 'video', `${at}&step=${String(k)}`);
      const last = refs.ref(await named(f.last, `${label} last`), 'image', `${at}&step=${String(k)}&last`);
      const hold = f.hold
        ? refs.ref(await named(f.hold.file, `${label} hold`), 'video', `${at}&step=${String(k)}&hold`)
        : null;
      deckSteps.push({
        clipId: clip,
        clipMs: f.clipMs,
        ...(k === 0 ? { transitionMs: cut?.steps[0]?.transitionMs ?? planned.transitionMs } : {}),
        lastId: last,
        ...(hold && f.hold ? { holdId: hold, holdMs: f.hold.ms } : {}),
      });
    }
    const lastStep = deckSteps[deckSteps.length - 1];
    const elements: SlideElement[] = lastStep
      ? [
          {
            id: 'picture',
            kind: 'image',
            frame: { x: 0, y: 0, width, height },
            mediaId: lastStep.lastId,
            fit: 'fit',
          },
        ]
      : [];
    const deckMedia: DeckMedia[] = [];
    const cues: ParsedCue[] = [];
    const timeline = (cut?.steps[0]?.fromMs ?? 0) + planned.transitionMs + plan.settleMs;
    for (const m of d?.media ?? []) {
      const taken = media.get(m.part ?? m.link ?? '');
      if (!taken) continue;
      const told = baked.baker === 'keynote' ? keynoteFor(m, planned.index + 1, baked.keynoteMedia) : null;
      const clip = clipOf(m, taken.durationMs);
      if (clip) trimmed++;
      const mediaId = refs.ref(
        taken.path,
        m.kind,
        m.part ? `${sourcePath}#${m.part}` : taken.path,
        clip ? { startMs: clip.startMs, endMs: clip.endMs, markers: [] } : undefined,
      );
      const loop = told ? told.loop : m.loop;
      const volume = told ? told.volume : m.volume;
      // A sound set to play across slides (C review): starting with its slide, it is the slide's sound, which plays
      // on as the next slides go up (Drashti's sound layer); one that starts later stays on its own slide.
      if (m.kind === 'audio' && m.acrossSlides) {
        const withSlide = !('clicked' in m.start) && stepOfGroup(d?.groups ?? [], m.start.group) === 0;
        if (withSlide && cues.length === 0) {
          cues.push({
            kind: 'audio',
            label: m.name,
            media: refs.indexOf(mediaId),
            props: { volume: m.muted ? 0 : volume, loop },
          });
          acrossCued++;
          continue;
        }
        if (withSlide) acrossSecond++;
        else acrossLater++;
      }
      let start: DeckMedia['start'];
      if ('clicked' in m.start) {
        start = { clicked: true };
        clicked++;
      } else {
        const step = stepOfGroup(d?.groups ?? [], m.start.group);
        // From the step's own start (its clip's first frame) to its group's start, then the media's own delay.
        const groupAt = timeline + (planned.groups[m.start.group]?.startMs ?? 0);
        const stepFrom = cut?.steps[step]?.fromMs ?? groupAt;
        start = { step, offsetMs: Math.max(0, Math.round(groupAt - stepFrom + m.start.offsetMs)) };
      }
      const poster = m.poster ? posters.get(m.poster) : undefined;
      deckMedia.push({
        kind: m.kind,
        mediaId,
        box: m.box,
        ...(poster ? { posterId: refs.ref(poster, 'image', `${sourcePath}#${m.poster ?? ''}`) } : {}),
        ...(clip ? { clip } : {}),
        loop,
        volume,
        ...(m.muted ? { muted: true } : {}),
        ...(m.fadeInMs > 0 ? { fadeInMs: m.fadeInMs } : {}),
        ...(m.fadeOutMs > 0 ? { fadeOutMs: m.fadeOutMs } : {}),
        start,
        ...(m.acrossSlides ? { acrossSlides: m.acrossSlides } : {}),
        ...(m.hideWhenStopped ? { hideWhenStopped: true } : {}),
        // Shown only from its entrance and until its exit, where the deck animates it in or out (C review).
        ...(m.enterGroup !== null ? { enterStep: stepOfGroup(d?.groups ?? [], m.enterGroup) } : {}),
        ...(m.exitGroup !== null ? { exitStep: stepOfGroup(d?.groups ?? [], m.exitGroup) } : {}),
      });
      if (m.kind === 'video') {
        videos++;
        const element: MediaElement = {
          id: `video-${String(deckMedia.length)}`,
          kind: 'video',
          frame: frameOf(m.box, width, height),
          mediaId,
          // PowerPoint stretches a video to its box.
          fit: 'stretch',
          ...(loop ? { loop: true } : {}),
          ...(m.muted ? { volume: 0 } : volume < 1 ? { volume } : {}),
        };
        elements.push(element);
      } else audios++;
    }
    const t = d?.transition;
    const sound = t?.sound ? sounds.get(t.sound.part) : undefined;
    if (sound) transitionSounds++;
    if (t?.advanceMs) advancing++;
    const deckSlide: DeckSlide = {
      ...(planned.transitionName
        ? {
            transition: {
              name: planned.transitionName,
              durationMs: planned.transitionMs,
              ...(sound
                ? { soundId: refs.ref(sound, 'audio', `${sourcePath}#${t?.sound?.part ?? ''}`) }
                : {}),
            },
          }
        : {}),
      ...(t?.advanceMs ? { deckAdvanceMs: t.advanceMs } : {}),
      // Its step-0 clip was made after the shown slide before it (Session 54, C review): the show plays the deck's
      // own transition only where that slide's last still is what is up.
      ...(before ? { after: before } : {}),
      steps: deckSteps,
      media: deckMedia,
    };
    before = deckSteps.at(-1)?.lastId ?? null;
    slides.push({
      label: '',
      notes: tidyNotes(source?.notes ?? ''),
      background: null,
      enabled: true,
      elements,
      cues,
      deck: deckSlide,
    });
  }
  const hidden = deck.slides.length - plan.slides.length;
  const stepsCount = slides.reduce((n, s) => n + (s.deck.steps.length > 0 ? s.deck.steps.length - 1 : 0), 0);
  return {
    name: nameFromFile(basename(fileName)),
    ref: null,
    width,
    height,
    notes: '',
    groups: [{ name: '', color: null, slides }],
    arrangements: [],
    selectedArrangement: null,
    media: refs.list,
    issues: bakedIssues({
      baker: baked.baker,
      bakeMs: baked.bakeMs,
      slides: slides.length,
      clicks: stepsCount,
      worstMs: baked.cuts.worst ? Math.abs(baked.cuts.worst.offsetMs) : null,
      hidden,
      withNotes: slides.filter((s) => s.notes !== '').length,
      videos,
      audios,
      clicked,
      acrossCued,
      acrossLater,
      acrossSecond,
      transitionSounds,
      advancing,
      trimmed,
      triggers: shown.reduce((n, index) => n + (deck.slides[index]?.deck?.triggers ?? 0), 0),
    }),
  };
}

// ---- the report ---------------------------------------------------------------------------------------

const APP: Record<Baker, string> = {
  powerpoint: 'PowerPoint',
  keynote: 'Keynote',
  'stand-in': 'The stand-in',
};

/** "video", "2 videos", or '' for none: what a deck has, after "Its". */
const some = (n: number, one: string) => (n === 0 ? '' : n === 1 ? one : `${String(n)} ${one}s`);

/** "17 s", "1 min 5 s". */
export function took(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${String(s)} s` : `${String(Math.floor(s / 60))} min ${String(s % 60)} s`;
}

/** What the report says of a deck that came in with its steps. */
export function bakedIssues(d: {
  baker: Baker;
  bakeMs: number;
  slides: number;
  /** Its clicks: every step but each slide's coming in. */
  clicks: number;
  /** The furthest a step was from its moment, as measured (ms), or null when none could be seen. */
  worstMs: number | null;
  hidden: number;
  withNotes: number;
  videos: number;
  audios: number;
  /** Videos and sounds that start only when clicked on (a trigger in the deck). */
  clicked: number;
  /** Sounds set to play across slides: as their slide's sound; starting later, or a slide's second, on their own slide. */
  acrossCued: number;
  acrossLater: number;
  acrossSecond: number;
  transitionSounds: number;
  /** Slides that moved on by themselves in the deck. */
  advancing: number;
  trimmed: number;
  /** Effects that ran when a shape was clicked. */
  triggers: number;
}): ImportIssue[] {
  const info = (code: string, message: string): ImportIssue => ({
    severity: 'info',
    code,
    message,
    fix: null,
  });
  const out: ImportIssue[] = [
    info(
      'deck-animations',
      `${APP[d.baker]} made this deck’s movie with its animations in ${took(d.bakeMs)}: ${plural(d.slides, 'slide')} with ${plural(d.clicks, 'click')}. Next and Back step through the clicks as in its slide show, then on to the next slide; each slide’s own transition plays as it comes in.`,
    ),
  ];
  if (d.worstMs !== null)
    out.push(
      info(
        'deck-steps-checked',
        `Every step was found where it should be in the movie, the furthest ${(d.worstMs / 1000).toFixed(2)} s from its moment.`,
      ),
    );
  if (d.videos + d.audios > 0)
    out.push(
      info(
        'deck-media',
        `Its ${[some(d.videos, 'video'), some(d.audios, 'sound')].filter(Boolean).join(' and ')} came in as real media, played as the deck plays ${d.videos + d.audios === 1 ? 'it' : 'them'} (when ${d.videos + d.audios === 1 ? 'it starts' : 'they start'}, ${d.trimmed > 0 ? 'trims, ' : ''}loop and volume), with the time bar under LIVE.`,
      ),
    );
  if (d.acrossCued > 0)
    out.push(
      info(
        'deck-across-slides',
        d.acrossCued === 1
          ? '1 sound set to play across slides came in as its slide’s sound: it plays on as the next slides go up, until it ends or another sound takes its place.'
          : `${String(d.acrossCued)} sounds set to play across slides came in as their slides’ sounds: each plays on as the next slides go up, until it ends or another sound takes its place.`,
      ),
    );
  if (d.acrossLater > 0)
    out.push(
      info(
        'deck-across-own-slide',
        d.acrossLater === 1
          ? '1 sound set to play across slides starts on a click: here it plays on its own slide only.'
          : `${String(d.acrossLater)} sounds set to play across slides start on a click: here they play on their own slides only.`,
      ),
    );
  if (d.acrossSecond > 0)
    out.push(
      info(
        'deck-across-own-slide',
        `${plural(d.acrossSecond, 'sound', 'sounds')} set to play across slides ${d.acrossSecond === 1 ? 'plays' : 'play'} on ${d.acrossSecond === 1 ? 'its' : 'their'} own slide only here: ${d.acrossSecond === 1 ? 'its slide has' : 'their slides have'} another sound that plays on.`,
      ),
    );
  if (d.transitionSounds > 0)
    out.push(
      info(
        'deck-transition-sounds',
        `${plural(d.transitionSounds, 'transition sound plays', 'transition sounds play')} as its slide comes in.`,
      ),
    );
  if (d.baker === 'keynote' && d.videos > 0)
    out.push(
      info(
        'deck-keynote-trims',
        'Keynote does not tell a video’s trims: a video trimmed in Keynote plays whole here. Its start and end points can be set in Media (Markers).',
      ),
    );
  if (d.clicked > 0)
    out.push(
      info(
        'deck-clicked-media',
        `${plural(d.clicked, 'video or sound starts', 'videos or sounds start')} only when clicked on in the deck: in Drashti, start ${d.clicked === 1 ? 'it' : 'them'} with Play on the time bar under LIVE.`,
      ),
    );
  if (d.triggers > 0)
    out.push(
      info(
        'deck-triggers',
        `${plural(d.triggers, 'effect ran', 'effects ran')} only when a shape was clicked, which Next never does: ${d.triggers === 1 ? 'it is' : 'they are'} left out.`,
      ),
    );
  if (d.advancing > 0)
    out.push(
      info(
        'deck-advance',
        `${plural(d.advancing, 'slide moved on by itself', 'slides moved on by themselves')} after some seconds in the deck: in Drashti each waits for Next (a Repeat Slides playlist moves on by itself).`,
      ),
    );
  if (d.hidden > 0)
    out.push(
      info(
        'pictures-hidden',
        `${d.hidden === 1 ? '1 slide is' : `${String(d.hidden)} slides are`} hidden in the file and left out, as in its slide show.`,
      ),
    );
  out.push(
    info(
      'pictures-notes',
      d.withNotes > 0
        ? `${plural(d.withNotes, 'slide has', 'slides have')} speaker notes, kept as the slide’s notes (the stage screen shows them).`
        : 'The file has no speaker notes.',
    ),
  );
  return out;
}

/** Why a deck came in as pictures, said plainly (the report's first word on it). */
export function whyPictures(why: BakeFailure, baker: Baker, kept = false): ImportIssue {
  const app = APP[baker];
  // The deck was imported as pictures before, and asked for again for its animations: that import stays.
  const lost = kept
    ? 'the earlier import was kept as it was'
    : 'its slides came in as pictures, without their animations';
  const message =
    why.kind === 'on-air'
      ? why.during
        ? `The stream went on air, so Drashti stopped making this deck’s animations (that would slow the stream): ${lost}. Import it again once the stream is off air.`
        : `The stream was on air, so Drashti did not make this deck’s animations (that would slow the stream): ${lost}. Import it again once the stream is off air.`
      : why.kind === 'off-plan'
        ? `${app} made the deck’s movie, but ${
            why.cuts.lostSlides.length > 0
              ? `slide ${String((why.cuts.lostSlides[0] ?? 0) + 1)} was not where it should be in it`
              : `a step on slide ${String((why.cuts.worst?.slide ?? 0) + 1)} came ${(Math.abs(why.cuts.worst?.offsetMs ?? 0) / 1000).toFixed(2)} s from its moment (more than ${(MAX_OFFSET_MS / 1000).toFixed(1)} s)`
          }, so its clicks could not be cut exactly: ${lost}.`
        : why.kind === 'cut'
          ? `${app} made the deck’s movie, but it could not be cut into its steps (${why.detail}): ${lost}.`
          : why.kind === 'nothing'
            ? `This deck has nothing to show with its animations (${why.detail}).`
            : why.kind === 'cancelled'
              ? `Cancelled while its animations were being made: ${lost}.`
              : `${app} could not make the deck’s movie (${why.reason}): ${lost}.`;
  return { severity: 'warning', code: 'deck-pictures', message, fix: null };
}

/** The report's word on a deck's videos and sounds, brought in beside its pictures. */
export function picturesMediaIssues(d: {
  videos: number;
  cued: number;
  left: number;
  /** Its videos and sounds that could not be put on their slides (its pictures not one a slide; C review). */
  unmatched?: number;
}): ImportIssue[] {
  const out: ImportIssue[] = [];
  if ((d.unmatched ?? 0) > 0)
    out.push({
      severity: 'warning',
      code: 'deck-media-unmatched',
      message: `${d.unmatched === 1 ? 'Its video or sound was' : `Its ${String(d.unmatched)} videos and sounds were`} left out: its pictures could not be matched to its slides one for one (some pages could not be drawn, or the PDF has a different number of pages than it has slides shown).`,
      fix: null,
    });
  if (d.videos > 0)
    out.push({
      severity: 'info',
      code: 'deck-media',
      message:
        d.videos === 1
          ? 'Its video came in as a real video where its slide has it, with the time bar under LIVE; it starts as its slide goes up.'
          : `Its ${String(d.videos)} videos came in as real videos where the slides have them, with the time bar under LIVE; they start as their slide goes up.`,
      fix: null,
    });
  if (d.cued > 0)
    out.push({
      severity: 'info',
      code: 'deck-sounds',
      message: `${plural(d.cued, 'sound plays', 'sounds play')} as ${d.cued === 1 ? 'its' : 'their'} slide goes up.`,
      fix: null,
    });
  if (d.left > 0)
    out.push({
      severity: 'info',
      code: 'deck-sounds-left',
      message: `${plural(d.left, 'sound', 'sounds')} that started on a click, or with a transition, ${d.left === 1 ? 'is' : 'are'} left out: they need the deck’s animations, which PowerPoint or Keynote makes.`,
      fix: null,
    });
  return out;
}

/** What needs PowerPoint or Keynote, on a computer with neither (the deck's own media came in all the same). */
export function noAppIssue(d: { media: number }): ImportIssue {
  return {
    severity: 'info',
    code: 'deck-needs-app',
    message: `${
      d.media === 1
        ? 'Its video or sound came in as media (in the Media list), with the time bar. '
        : d.media > 1
          ? `Its ${String(d.media)} videos and sounds came in as media (in the Media list), with the time bar. `
          : ''
    }Its slides as pictures, and its animations, clicks and transitions, need PowerPoint (or Keynote on a Mac): import it on a computer with one, or save it as PDF there and import the PDF here.`,
    fix: null,
  };
}

// ---- pictures, with the deck's own videos and sounds ----------------------------------------------------

/**
 * The deck's videos and sounds put on its pictures' slides (Session 54, C2): each video at its box, with its loop
 * and volume (its trims as the file's own start and end points), and a sound that starts with its slide as the
 * slide's sound. `pages` are the pictures' slides in order, one per shown slide. Returns the media refs to add.
 */
export async function addDeckMedia(
  parsed: ParsedPresentation,
  deck: PptxDeck,
  deckFile: string,
  sourcePath: string,
  work: string,
  ffmpeg: string | null,
  /** The deck's own folder: its links are followed only inside it. */
  deckDir: string,
): Promise<{ videos: number; cued: number; left: number; unmatched?: number }> {
  const shown = deck.slides.flatMap((s, i) => (s.hidden ? [] : [i]));
  const slides = parsed.groups.flatMap((g) => g.slides);
  if (slides.length !== shown.length) return { videos: 0, cued: 0, left: 0, unmatched: deckMediaCount(deck) };
  const { media } = await takeMedia(deckFile, deckDir, deck.slides, shown, join(work, 'media'), ffmpeg);
  let videos = 0;
  let cued = 0;
  let left = 0;
  const refFor = (path: string, kind: ParsedMediaRef['kind'], markers?: ParsedMediaRef['markers']) => {
    parsed.media.push({ originalPath: path, kind, sourcePath, ...(markers ? { markers } : {}) });
    return parsed.media.length - 1;
  };
  shown.forEach((index, i) => {
    const slide = slides[i];
    const d = deck.slides[index]?.deck;
    if (!slide || !d) return;
    for (const m of d.media) {
      const taken = media.get(m.part ?? m.link ?? '');
      if (!taken) continue;
      const clip = clipOf(m, taken.durationMs);
      const markers = clip ? { startMs: clip.startMs, endMs: clip.endMs, markers: [] } : undefined;
      if (m.kind === 'video') {
        const n = refFor(taken.path, 'video', markers);
        slide.elements.push({
          id: `video-${String(n)}`,
          kind: 'video',
          frame: frameOf(m.box, parsed.width, parsed.height),
          mediaId: mediaRef(n),
          fit: 'stretch',
          ...(m.loop ? { loop: true } : {}),
          ...(m.muted ? { volume: 0 } : m.volume < 1 ? { volume: m.volume } : {}),
        });
        videos++;
      } else if (
        !('clicked' in m.start) &&
        stepOfGroup(d.groups, m.start.group) === 0 &&
        slide.cues.length === 0
      ) {
        // With the slide: the slide's sound, as Drashti plays one (one a slide).
        const cue: ParsedCue = {
          kind: 'audio',
          label: m.name,
          media: refFor(taken.path, 'audio', markers),
          props: { volume: m.muted ? 0 : m.volume, loop: m.loop },
        };
        slide.cues.push(cue);
        cued++;
      } else left++;
    }
  });
  return { videos, cued, left };
}

/** How many videos and sounds the deck's shown slides have. */
export function deckMediaCount(deck: PptxDeck): number {
  return deck.slides.reduce((n, s) => n + (s.hidden ? 0 : (s.deck?.media.length ?? 0)), 0);
}

/** The deck's videos and sounds as files of their own (a computer with neither PowerPoint nor Keynote). */
export async function deckMediaFiles(deckFile: string, deck: PptxDeck, dir: string): Promise<string[]> {
  const shown = deck.slides.flatMap((s, i) => (s.hidden ? [] : [i]));
  // Taken out of the deck only: a link is never followed here.
  const { media } = await takeMedia(deckFile, dir, deck.slides, shown, dir, null);
  return [...media.values()].map((m) => m.path).filter((p) => dirname(p) === dir);
}
