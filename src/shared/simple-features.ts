/*
 * Simple Mode Features (alpha.22; the owner, 24 Nov 2026: "put a control of features for users who have access to pro
 * and simple mode. in edit, saying that the features can be brought to simple mode, only 1-2 and max 3. so that the
 * meaning of simple mode doesnt go away, the features can be toggled and can be brought to simple mode, like an on and
 * off button"): Edit › Simple Mode Features…, in Pro Mode only, an on/off switch for each of Pro Mode's tools under
 * LIVE that run the show and Simple Mode lacks, up to three, none to begin with. In Simple Mode each chosen tool is its
 * own folding section under Audio, folded to begin with, with only what runs the show: what sets it up stays Pro
 * Mode's (main/simple-mode.ts SIMPLE_FEATURE_CHANNELS, shared/mode.ts SIMPLE_FEATURE_COMMANDS, and the sections'
 * operate-only parts in the window). Kept with this computer's library, as the mode is (main/simple-features.ts).
 *
 * Which tools: those of Pro Mode's sections under LIVE that are used while the show runs. Not MIDI or OSC (they set a
 * controller or a console up), not QR code (it makes a new slide in the library, which Simple Mode does not show),
 * and not Audio (Simple Mode has it already).
 */

export type SimpleFeature =
  | 'stage'
  | 'messages'
  | 'chat'
  | 'timers'
  | 'lower-thirds'
  | 'show-a-window'
  | 'show-a-stream-link'
  | 'video-inputs'
  | 'picture-in-picture';

export interface SimpleFeatureWords {
  id: SimpleFeature;
  /** Its section's name under LIVE (Pro Mode's own). */
  name: string;
  /** What Simple Mode does with it, in one line. */
  line: string;
}

/** The tools, in the order of Pro Mode's sections under LIVE (Simple Mode shows them in the same order). */
export const SIMPLE_FEATURES: readonly SimpleFeatureWords[] = [
  {
    id: 'stage',
    name: 'Stage screen',
    line: 'The message for the stage screens shown and hidden, and the stage and audience timers started, paused and reset.',
  },
  {
    id: 'messages',
    name: 'Messages',
    line: 'The messages made in Pro Mode shown on the screens and taken off.',
  },
  {
    id: 'chat',
    name: 'Chat',
    line: 'The day’s chat with the paired phones read, and messages sent to it as the operator; Clear chat, removing a person and the Chat QR code stay in Pro Mode.',
  },
  {
    id: 'timers',
    name: 'Timers',
    line: 'The timers started, paused, reset, shown and hidden, and the countdown to the start.',
  },
  { id: 'lower-thirds', name: 'Lower Thirds', line: 'The lower thirds made in Pro Mode shown and hidden.' },
  { id: 'show-a-window', name: 'Show a Window', line: 'Another app’s window shown as the background.' },
  {
    id: 'show-a-stream-link',
    name: 'Show a Stream Link',
    line: 'A live stream’s link shown as the background.',
  },
  {
    id: 'video-inputs',
    name: 'Video inputs',
    line: 'The chosen video input on the audience in one press, and which input that is.',
  },
  {
    id: 'picture-in-picture',
    name: 'Picture in Picture',
    line: 'Something small in a corner of the screens: put in the box, swapped and taken off.',
  },
];

/** At most this many at once (the owner: "only 1-2 and max 3"). */
export const SIMPLE_FEATURES_MAX = 3;

/** What the window says above the switches. */
export const SIMPLE_FEATURES_LINE =
  'Bring up to 3 of Pro Mode’s tools into Simple Mode. Keeping it to one or two keeps Simple Mode simple.';

/** Why a fourth cannot come on. */
export const SIMPLE_FEATURES_FULL = 'Up to 3: turn one off first.';

const ORDER: readonly SimpleFeature[] = SIMPLE_FEATURES.map((f) => f.id);

export const isSimpleFeature = (value: unknown): value is SimpleFeature =>
  typeof value === 'string' && (ORDER as readonly string[]).includes(value);

/** The chosen ones in the column's order. */
const inOrder = (chosen: ReadonlySet<SimpleFeature>): SimpleFeature[] => ORDER.filter((f) => chosen.has(f));

/**
 * The tools as saved, read back: in the column's order, anything unknown or doubled left out, and never more than three
 * (the first three in that order). Nothing saved, or what cannot be read: none, the default.
 */
export function readSimpleFeatures(saved: unknown): SimpleFeature[] {
  if (!Array.isArray(saved)) return [];
  return inOrder(new Set(saved.filter(isSimpleFeature))).slice(0, SIMPLE_FEATURES_MAX);
}

export type SimpleFeatureResult = { ok: true; chosen: SimpleFeature[] } | { ok: false; message: string };

/** One tool on or off: a fourth is refused, saying why, until one is turned off. */
export function chooseSimpleFeature(
  chosen: readonly SimpleFeature[],
  feature: unknown,
  on: unknown,
): SimpleFeatureResult {
  if (!isSimpleFeature(feature) || typeof on !== 'boolean')
    return { ok: false, message: 'That is not one of the tools Simple Mode can have.' };
  const next = new Set(chosen);
  if (on) {
    if (!next.has(feature) && next.size >= SIMPLE_FEATURES_MAX)
      return { ok: false, message: SIMPLE_FEATURES_FULL };
    next.add(feature);
  } else next.delete(feature);
  return { ok: true, chosen: inOrder(next) };
}

/** A tool's section name. */
export const simpleFeatureName = (feature: SimpleFeature): string =>
  SIMPLE_FEATURES.find((f) => f.id === feature)?.name ?? feature;
