/*
 * Tests only (Session 57, item 6: animations on the spot; the Performance check's animations scenario,
 * main/perf-animations.ts): the motion probe. It watches a page from outside the parts it watches, drawing nothing:
 * at every frame the page draws it keeps when that frame began (ms since the epoch, this computer's clock), and for
 * each part it watches (a track) whether that part looks different from the frame before. What a part looks like is
 * what the frame shows of it: every element of it that can be seen (its opacity with its ancestors', its box on the
 * page, its transform, clip and filter; a video's time), in the page's order; an element nobody can see (no opacity,
 * no box, or off the page) counts as not there, so a slide gone to nothing and then taken away changes nothing.
 * shared/motion-measure.ts works out each case's delay, length and evenness from it.
 *
 * It looks at the very frame drawn: a ResizeObserver's callback comes after the frame's animation callbacks (the
 * page's own transitions are painted in theirs) and its layout, before it is painted, so a change the main process
 * sends between frames is never counted a frame early. A hidden pixel off the page changes its width at each frame so
 * that the callback comes at every one.
 *
 * Only when the page was loaded with motionProbe=1, which the main process adds only under a test switch
 * (DRASHTI_TEST_MOTION_PROBE, windows/renderer.ts): never in an installed Drashti.
 */

/** A part the probe watches: the elements that draw it. */
export interface MotionTrack {
  name: string;
  /** Every element of it that can be seen counts. */
  parts: string;
  /** Instead of their look, these attributes of theirs (a state the page is in, seen or not). */
  attrs?: readonly string[];
}

/**
 * An audience screen's moving parts (render/Scene.tsx): the slide layer's two slides, the black of a fade through
 * black and the words drawn apart while a move runs (never a slow zoom's zooming after its fade); a deck's step's
 * pictures and videos; a lower third's band and units (never its moving background's pieces, which move while it is
 * up); Black-out; and the Wallpaper with its picture. A slow zoom's slide zooms on for 20 s after its fade (the zoom is
 * a child of the slide's box): only the fade is the transition's.
 */
export const AUDIENCE_TRACKS: readonly MotionTrack[] = [
  {
    name: 'slide',
    parts:
      '[data-layer="slide"] [data-slide-in], [data-layer="slide"] [data-slide-out], [data-slide-black], [data-words-in], [data-words-out], [data-words-apart] [data-reveal-line], [data-words-apart] [data-reveal-word]',
  },
  { name: 'deck', parts: '[data-deck-step] video, [data-deck-step] img' },
  { name: 'lowerThird', parts: '[data-testid="lower-third-layer"], [data-lt-band], [data-lt-unit]' },
  { name: 'blackout', parts: '[data-layer="blackout"]' },
  {
    name: 'wallpaper',
    parts: '[data-layer="wallpaper"], [data-wallpaper-role], [data-layer="wallpaper"] img',
  },
];

/**
 * The operator window's opening as Drashti starts (opening/OpeningPlayer.tsx): its photo (or lamp) as seen, with the
 * whole's fade; and when it came (black over the window), stopped waiting for the hall's screens, and went.
 */
export const OPERATOR_TRACKS: readonly MotionTrack[] = [
  { name: 'opening', parts: '[data-opening-photo], [data-opening-lamp]' },
  { name: 'opening-shown', parts: '[data-testid="opening"]', attrs: ['data-opening-held'] },
];

/** What the probe gives the main process (or a test) for a stretch of time. */
export interface ProbeRead {
  frames: number[];
  /** Per track: the frames (indexes into `frames`) at which it looked different from the frame before. */
  changes: Record<string, number[]>;
  /** Per attributes' track: what it said at each of those frames (the attributes, or '' when none was there). */
  states: Record<string, string[]>;
}

declare global {
  interface Window {
    /** Tests only: the motion probe's record (render/motion-probe.ts). */
    drashtiMotionProbe?: { read(from: number, until: number): ProbeRead };
  }
}

/** The most frames kept (well over an hour at 60 a second): a check never draws so many. */
const MOST_FRAMES = 300_000;

/** A short fingerprint of a look (FNV-1a), so only numbers are kept. */
function fingerprint(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** How much of an element shows: its opacity times every ancestor's (kept for the frame: they share ancestors). */
function seenOpacity(el: Element, known: Map<Element, number>): number {
  const kept = known.get(el);
  if (kept !== undefined) return kept;
  const own = Number.parseFloat(getComputedStyle(el).opacity);
  const parent = el.parentElement;
  const seen = (Number.isFinite(own) ? own : 1) * (parent ? seenOpacity(parent, known) : 1);
  known.set(el, seen);
  return seen;
}

/** What an element shows of itself at this frame, or null when it shows nothing. */
function lookOf(el: Element, known: Map<Element, number>): string | null {
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  const opacity = seenOpacity(el, known);
  if (!(opacity > 0.0005)) return null;
  const box = el.getBoundingClientRect();
  if (
    box.width <= 0 ||
    box.height <= 0 ||
    box.right <= 0 ||
    box.bottom <= 0 ||
    box.left >= window.innerWidth ||
    box.top >= window.innerHeight
  )
    return null;
  // Which slide, picture or lower third it is: a cut changes only that.
  const which =
    el.getAttribute('data-media-id') ??
    el.getAttribute('data-lt-id') ??
    (el.hasAttribute('data-slide-in') || el.hasAttribute('data-slide-out')
      ? (el.querySelector('[data-slide]')?.getAttribute('data-slide') ?? '')
      : '');
  // A video's time; a picture's arrival (its box is there before it is).
  const time =
    el instanceof HTMLVideoElement
      ? `@${el.currentTime.toFixed(3)}`
      : el instanceof HTMLImageElement
        ? `@${el.complete && el.naturalWidth > 0 ? 'in' : 'loading'}`
        : '';
  const at = `${box.left.toFixed(1)},${box.top.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`;
  return `${el.tagName}#${which}|${String(opacity)}|${at}|${style.transform}|${style.clipPath}|${style.filter}${time}`;
}

/** A track's look at this frame: every element of it that shows, in the page's order. */
function trackLook(track: MotionTrack, known: Map<Element, number>): string {
  const parts: string[] = [];
  for (const el of document.querySelectorAll(track.parts)) {
    if (track.attrs) parts.push(track.attrs.map((a) => el.getAttribute(a) ?? '').join(','));
    else {
      const look = lookOf(el, known);
      if (look !== null) parts.push(look);
    }
  }
  return parts.join(';');
}

/**
 * Start watching these tracks, from the next frame: the record is window.drashtiMotionProbe's. Returns how to stop.
 */
export function startMotionProbe(tracks: readonly MotionTrack[]): () => void {
  const frames: number[] = [];
  const changes: Record<string, number[]> = Object.fromEntries(tracks.map((t) => [t.name, []]));
  const states: Record<string, string[]> = Object.fromEntries(
    tracks.filter((t) => t.attrs).map((t) => [t.name, []]),
  );
  const last = new Map<string, number>();
  const pixel = document.createElement('div');
  pixel.setAttribute('aria-hidden', 'true');
  pixel.setAttribute('data-motion-probe', '');
  Object.assign(pixel.style, {
    position: 'fixed',
    left: '-8px',
    top: '-8px',
    width: '1px',
    height: '1px',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  document.body.append(pixel);
  /** When the frame being drawn began (ms since the epoch), and the frame last looked at. */
  let frameAt = 0;
  let lookedAt = 0;
  let wide = false;
  let raf = 0;
  const look = () => {
    if (frameAt === 0 || frameAt === lookedAt || frames.length >= MOST_FRAMES) return;
    lookedAt = frameAt;
    const index = frames.length;
    frames.push(frameAt);
    const known = new Map<Element, number>();
    for (const track of tracks) {
      const look = trackLook(track, known);
      const now = fingerprint(look);
      const before = last.get(track.name);
      if (before !== undefined && before !== now) {
        changes[track.name]?.push(index);
        states[track.name]?.push(look);
      }
      last.set(track.name, now);
    }
  };
  const observer = new ResizeObserver(look);
  observer.observe(pixel);
  const frame = (t: number) => {
    // eslint-disable-next-line no-restricted-properties -- tests only: when this frame began, by this computer's clock (the probe's own record; it draws nothing)
    frameAt = Date.now() - (performance.now() - t);
    wide = !wide;
    pixel.style.width = wide ? '2px' : '1px';
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.drashtiMotionProbe = {
    read: (from, until) => {
      let a = 0;
      while (a < frames.length && (frames[a] ?? 0) < from) a++;
      let b = a;
      while (b < frames.length && (frames[b] ?? 0) < until) b++;
      const within = (at: number[]) => at.map((i, n) => ({ i, n })).filter(({ i }) => i >= a && i < b);
      return {
        frames: frames.slice(a, b),
        changes: Object.fromEntries(
          Object.entries(changes).map(([name, at]) => [name, within(at).map(({ i }) => i - a)]),
        ),
        states: Object.fromEntries(
          Object.entries(states).map(([name, said]) => [
            name,
            within(changes[name] ?? []).map(({ n }) => said[n] ?? ''),
          ]),
        ),
      };
    },
  };
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    pixel.remove();
  };
}

/** Start the probe on these tracks when the page was loaded for it (motionProbe=1: a test switch's only). */
export function startMotionProbeIfAsked(tracks: readonly MotionTrack[]): void {
  if (new URLSearchParams(location.search).get('motionProbe') === '1') startMotionProbe(tracks);
}
