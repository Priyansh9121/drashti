/*
 * Simple Mode's one playlist (Session 55, Part 18, the owner's words of 29 Oct 2026): "It's the playlist open when
 * Drashti switched to Simple Mode, or a new one when there's none." Simple Mode shows that playlist alone, and the main
 * process lets Simple Mode change that one only (its rows added, moved, taken out and put back: simple-mode.ts's
 * bounds), so which playlist it is is decided here, never by the window while Simple Mode is on.
 *
 * - Pro Mode's window says which playlist it has open, or that it closed it (playlists:opened); at the switch to
 *   Simple Mode (the window's, the View menu's, or Simple access's at an answer) that one is adopted. With none open,
 *   a new one is made at the top of the playlists; an empty one made before is used again rather than a second empty
 *   one.
 * - Kept in the library's settings, so a start back in Simple Mode (after an unexpected stop, or with Simple access)
 *   has it again; a new one when it has gone.
 */

export interface SimplePlaylistDeps {
  /** The one kept from before (the library's setting), as read. */
  saved: unknown;
  /** Keep it for the next start. */
  save: (id: string) => void;
  /** A playlist (not a folder of playlists or a template) still in the library. */
  usable: (id: string) => boolean;
  /** It has no rows. */
  empty: (id: string) => boolean;
  /** A new playlist for Simple Mode; its id. */
  create: () => string;
  log: (line: string) => void;
}

export class SimplePlaylist {
  /** The playlist Pro Mode's window has open now, as it last said (null: none). */
  private open: string | null = null;
  /** Simple Mode's one playlist, once Simple Mode has needed one. */
  private id: string | null = null;
  /** The one kept from the run before. */
  private readonly kept: string | null;

  constructor(private readonly d: SimplePlaylistDeps) {
    this.kept = typeof d.saved === 'string' && d.saved !== '' ? d.saved : null;
  }

  /** Pro Mode's window opened a playlist, or closed it (null). Only Pro Mode's: Simple Mode's never changes it. */
  opened(id: string | null): void {
    this.open = id;
  }

  /** Simple Mode's one playlist, or null before Simple Mode has needed one. */
  current(): string | null {
    return this.id;
  }

  /** At the switch to Simple Mode: the playlist open in Pro Mode, else a new one (an empty one made before will do). */
  adopt(): string {
    if (this.open !== null && this.d.usable(this.open))
      return this.use(this.open, 'the playlist open in Pro Mode');
    const before = this.id ?? this.kept;
    if (before !== null && this.d.usable(before) && this.d.empty(before))
      return this.use(before, 'none was open, so the empty one made before');
    return this.use(this.d.create(), 'none was open, so a new one');
  }

  /** At a start in Simple Mode: the one kept from before, or a new one when it has gone. */
  keep(): string {
    const before = this.id ?? this.kept;
    if (before !== null && this.d.usable(before)) return this.use(before, 'the one kept from before');
    return this.use(this.d.create(), 'a new one (none kept)');
  }

  private use(id: string, why: string): string {
    this.id = id;
    this.d.save(id);
    this.d.log(`Simple Mode’s playlist: ${why}`);
    return id;
  }
}

/** A new one's name, the day it was made in words: "Sabha, 30 Oct 2026" (Pro Mode's list shows it so, at the top). */
export function simplePlaylistName(now: Date): string {
  const day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `Sabha, ${day}`;
}
