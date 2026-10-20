/*
 * Deleting media from the library (Session 26a): media could not be removed
 * at all before. Before it goes, Drashti says where it is used; deleting it
 * takes it out of playlists and music, and leaves slides, props, themes and
 * the idle rotation showing nothing in its place, as a missing file does.
 * Undo puts everything back. Its file goes only once it can no longer be
 * undone (when Drashti next starts), and never while it is on the screens.
 */

/** Some of the names of what uses it, and how many there are. */
export interface UsedIn {
  names: string[];
  count: number;
}

export interface MediaUsage {
  /** Presentations whose slides show it (a picture, a video, a background, a sound cue). */
  presentations: UsedIn;
  playlists: UsedIn;
  /** Audio playlists. */
  music: UsedIn;
  props: UsedIn;
  themes: UsedIn;
  /** It is one of the idle rotation's pictures. */
  idle: boolean;
  /** It is on the screens now (it stays up until it is changed). */
  live: boolean;
}

/** At most this many names are said for each. */
export const USED_IN_NAMES = 5;

export const NOT_USED: MediaUsage = {
  presentations: { names: [], count: 0 },
  playlists: { names: [], count: 0 },
  music: { names: [], count: 0 },
  props: { names: [], count: 0 },
  themes: { names: [], count: 0 },
  idle: false,
  live: false,
};

/** “A”, “B” and 3 more. */
const named = (used: UsedIn): string => {
  const names = used.names.map((n) => `“${n}”`);
  const more = used.count - used.names.length;
  if (more > 0) return `${names.join(', ')} and ${String(more)} more`;
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
};

/**
 * Where it is used, as plain lines for the question, for one media item or several (`count`):
 * "The playlists “Sunday” and “Youth”: taken out of them."
 */
export function usageLines(usage: MediaUsage, count = 1): string[] {
  const its = count === 1 ? 'its' : 'their';
  const out: string[] = [];
  const line = (used: UsedIn, one: string, many: string, then: (plural: boolean) => string) => {
    if (used.count > 0) out.push(`${used.count === 1 ? one : many} ${named(used)}: ${then(used.count > 1)}`);
  };
  line(usage.presentations, 'The slides of', 'The slides of', () => `nothing will show in ${its} place.`);
  line(usage.playlists, 'The playlist', 'The playlists', (p) => `taken out of ${p ? 'them' : 'it'}.`);
  line(usage.music, 'The music', 'The music lists', (p) => `taken out of ${p ? 'them' : 'it'}.`);
  line(usage.props, 'The prop', 'The props', () => `nothing will show in ${its} place.`);
  line(usage.themes, 'The theme', 'The themes', () => `nothing will show in ${its} place.`);
  if (usage.idle) out.push('The idle rotation’s pictures: taken out of them.');
  return out;
}

export type MediaRemovalResult = { ok: true; ids: string[] } | { ok: false; message: string };
