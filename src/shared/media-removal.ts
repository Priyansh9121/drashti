/*
 * Deleting media from the library (Session 26a): media could not be removed
 * at all before. Before it goes, Drashti says where it is used; deleting it
 * takes it out of playlists and music, and leaves slides and the looks
 * presentations are drawn in (their themes) showing nothing in its place, as
 * a missing file does. Session 55 (Part 12): props and the idle rotation are
 * gone from the window, so where they use it is no longer said.
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
  /** The looks presentations are drawn in (their themes, gone from the window since Session 55): their background. */
  themes: UsedIn;
  /** It is on the screens now (it stays up until it is changed). */
  live: boolean;
  /** The wallpapers it is in (Session 55, Part 6): left out of them. Left out when it is in none. */
  wallpapers?: UsedIn;
}

/** At most this many names are said for each. */
export const USED_IN_NAMES = 5;

export const NOT_USED: MediaUsage = {
  presentations: { names: [], count: 0 },
  playlists: { names: [], count: 0 },
  music: { names: [], count: 0 },
  themes: { names: [], count: 0 },
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
  line(
    usage.themes,
    'The background of the look',
    'The backgrounds of the looks',
    () => `nothing will show there.`,
  );
  if (usage.wallpapers)
    line(usage.wallpapers, 'The wallpaper', 'The wallpapers', (p) => `left out of ${p ? 'them' : 'it'}.`);
  return out;
}

export type MediaRemovalResult = { ok: true; ids: string[] } | { ok: false; message: string };

/**
 * Where presentations are used, asked before deleting them (Session 55, Part 14: the one right-click menu's Delete
 * asks first only when what it deletes is on the screens or in a playlist, and says which).
 */
export interface PresentationUsage {
  playlists: UsedIn;
  /** One of them is on the screens now (it stays up until it is changed). */
  live: boolean;
}

/** Show in Finder / Show in Explorer (Session 55, Part 14): shown, or why not. */
export type RevealResult = { ok: true } | { ok: false; message: string };

/** The longest name a presentation or a media file is given by Rename. */
export const NAME_MAX = 200;
