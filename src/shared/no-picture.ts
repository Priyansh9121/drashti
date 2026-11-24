/*
 * A video whose picture this computer cannot draw (Session 60, x36; the owner, 19 Nov 2026: "when playing a video, the
 * wallpaper shows up, when toggled the wallpaper off, the screen in audience shows black, but the video is playing";
 * his answer "Yes, A"). Chromium plays such a file (a codec it has no decoder for here, HEVC on a computer that cannot
 * decode it, ProRes, FFV1) as sound only, with no error: the screens' video has data at 0 × 0 and no frame. A window
 * finds it as the file loads (render/no-picture.ts); the show takes the video off with its sound (a video on the slide
 * waits paused; the picture-in-picture box comes off, Q60-46), the operator window says so in these words, and Drashti converts the
 * file by itself once the show is idle (main/convert/convert-service.ts convertUndrawable).
 */

/** What the operator window says: the file by its name, and whether Drashti is converting it. */
export function noPictureNotice(name: string, converting: boolean): string {
  return converting
    ? `“${name}”: this computer can’t show its picture, so it came off the screens. Drashti is converting it to a copy that plays; it can go live once that is done.`
    : `“${name}”: this computer can’t show its picture, so it came off the screens. Convert it in Media to play it.`;
}

/**
 * What the operator window says when a video could not play on one of this computer's pictures (Q60-31): its element
 * failed there (that computer's decoder, a cut or damaged file), or its first frame never came (Q60-44). `where`: "the
 * screen “…”", "LIVE" or "the stream"; `took`: what came off (the background, by default), or, on the slide, what
 * waits paused, or the picture-in-picture box (x46's item 4).
 */
export function cannotPlayNotice(
  name: string,
  where: string,
  took: { background: boolean; slide: boolean; box: boolean } = {
    background: true,
    slide: false,
    box: false,
  },
): string {
  const what = took.background
    ? 'so it came off the screens with its sound'
    : took.slide
      ? 'so it stopped where it was on the slide, with its sound'
      : 'so the picture-in-picture box came off';
  return `“${name}” could not play on ${where}, ${what}. If it happens again, the file may be damaged: tell whoever looks after Drashti.`;
}

/**
 * What the operator window says when one of this computer's screens could not play a video that is up but not playing
 * (alpha.23, a22-halldrop: paused, waiting for its click, or at its end, on the slide or in the box), so nothing came
 * off: until then nobody was told. `where`: the screens, "the screen “…”" or "the screens “…” and “…”".
 */
export function cannotPlayWaitingNotice(name: string, where: string): string {
  return `“${name}” could not play on ${where}. It is still up but not playing: played, its sound may be heard without its picture there. Put something else up, and after the sabha tell whoever looks after Drashti which file it was.`;
}

/**
 * How long a page that draws the show waits for a video's first frame (Q60-44, the owner's answer A of 20 Nov 2026,
 * through the lead): with none by then, it says the video cannot play, as an element that failed does, and the show
 * takes it off with its sound, the Wallpaper or the cover over the picture staying up until then (render/Scene.tsx),
 * never black. Main heeds it from its own screens; LIVE's or the stream's page alone only logs it (a page out of sight
 * may wait longer, and the hall is what the audience sees); a paired computer's tells Main, as its errors do
 * (main/media/cannot-play.ts, NodeCannotPlay). Its one place: change it here.
 */
export const FIRST_FRAME_MS = 10_000;

/** The code a page sends for a video with no first frame within FIRST_FRAME_MS (MediaError's own codes are 1 to 4). */
export const NO_FIRST_FRAME = -1;

/*
 * Slow is not "cannot play" (Q60-51, the owner's "Yes, A" of 20 Nov 2026, from x52's A11: under a heavy load a file that
 * plays fine was taken off at 10 s as "damaged"). FIRST_FRAME_MS is now how long a video may make NO progress at all
 * (nothing more loaded, no frame decoded, no step in its readiness) before it is said to be unplayable; one that still
 * loads or decodes gets up to SLOW_START_MS from going up, and is then said not to have started in time (NO_START_IN_TIME:
 * the operator is told so, never "damaged"). The Wallpaper or cover stays meanwhile, never black (render/Scene.tsx).
 */

/** Still loading or decoding, with no first frame this long after it went up: it could not start in time. */
export const SLOW_START_MS = 30_000;

/** The code a page sends for a video still loading with no first frame within SLOW_START_MS. */
export const NO_START_IN_TIME = -3;

/** What a page sees of a video's start at a moment: how much it has loaded and decoded, and how ready it is. */
export interface StartSample {
  at: number;
  /** The end of what it has buffered (ms into the file). */
  loadedMs: number;
  readyState: number;
  /** Frames decoded so far (0 where the page cannot tell). */
  decoded: number;
  /** Times the element said it loaded more ('progress'). */
  progressEvents: number;
  /** Bytes of the file Main has sent the page so far (0 where the page cannot ask). */
  served: number;
}

/** A video's start as watched: from when it waits, when it last moved on, and its last look. */
export interface StartWatch {
  since: number;
  lastProgress: number;
  last: StartSample | null;
}

export const startWatch = (since: number): StartWatch => ({ since, lastProgress: since, last: null });

/** The watch after one more look: any more loaded, decoded or readier than before is progress. */
export function startWatched(watch: StartWatch, sample: StartSample): StartWatch {
  const was = watch.last;
  const moved =
    was !== null &&
    (sample.loadedMs > was.loadedMs ||
      sample.readyState > was.readyState ||
      sample.decoded > was.decoded ||
      sample.progressEvents > was.progressEvents ||
      sample.served > was.served);
  return { since: watch.since, lastProgress: moved ? sample.at : watch.lastProgress, last: sample };
}

/**
 * At `now`, for a video whose first frame has not come: wait on; 'stalled' (no progress for FIRST_FRAME_MS: it cannot
 * play, as before); or 'slow' (it still loads or decodes, but SLOW_START_MS has gone by since it went up).
 */
export function startVerdict(watch: StartWatch, now: number): 'wait' | 'stalled' | 'slow' {
  if (now - watch.lastProgress >= FIRST_FRAME_MS) return 'stalled';
  if (now - watch.since >= SLOW_START_MS) return 'slow';
  return 'wait';
}

/**
 * What the operator window says when a video on this computer's screens did not start in time (Q60-51): slow here, not
 * damaged. `where` and `took` as for cannotPlayNotice.
 */
export function cannotStartInTimeNotice(
  name: string,
  where: string,
  took: { background: boolean; slide: boolean; box: boolean } = {
    background: true,
    slide: false,
    box: false,
  },
): string {
  const what = took.background
    ? 'so it came off the screens with its sound'
    : took.slide
      ? 'so it stopped where it was on the slide, with its sound'
      : 'so the picture-in-picture box came off';
  return `“${name}” could not start in time on ${where}, ${what}: this computer was too busy to start it in ${String(SLOW_START_MS / 1000)} seconds. Put it up again when less is playing.`;
}

/**
 * The code a node sends Main for a video whose picture it cannot draw (x36's sound only, as on Main; ledger G-A14): on a
 * node it keeps what it showed, and Main is told, as for any other showing a node's screen could not play.
 */
export const NO_PICTURE = -2;

/**
 * What the operator window says when a paired computer's screen could not play a video (Q60-44, the owner's answer A
 * of 20 Nov 2026): that computer keeps what it showed, never black, and the video plays on everywhere else.
 */
export function cannotPlayOnNodeNotice(name: string, node: string): string {
  return `“${name}” could not play on the paired computer “${node}”: its screen keeps what it showed, and the video plays on everywhere else. If it happens again, that computer may not play this kind of video: tell whoever looks after Drashti.`;
}
