import { describe, expect, it } from 'vitest';
import { SimplePlaylist, type SimplePlaylistDeps, simplePlaylistName } from './simple-playlist';

/*
 * Simple Mode's one playlist (Session 55, Part 18, the owner's words of 29 Oct 2026): "It's the playlist open when
 * Drashti switched to Simple Mode, or a new one when there's none." Kept in the library's settings, so a start back in
 * Simple Mode (after a stop, or with Simple access) has it again. The library is stood in for by a map of playlists
 * and how many rows each has.
 */

function make(o: { saved?: unknown; playlists?: [string, number][] } = {}) {
  const playlists = new Map<string, number>(o.playlists ?? []);
  const saved: string[] = [];
  const made: string[] = [];
  const deps: SimplePlaylistDeps = {
    saved: o.saved,
    save: (id) => saved.push(id),
    usable: (id) => playlists.has(id),
    empty: (id) => (playlists.get(id) ?? 0) === 0,
    create: () => {
      const id = `new-${String(made.length + 1)}`;
      made.push(id);
      playlists.set(id, 0);
      return id;
    },
    log: () => undefined,
  };
  return { p: new SimplePlaylist(deps), saved, made, playlists };
}

describe('Simple Mode’s one playlist', () => {
  it('is the playlist open in Pro Mode’s window when Drashti switched to Simple Mode', () => {
    const { p, saved, made } = make({
      playlists: [
        ['A', 3],
        ['B', 2],
      ],
    });
    p.opened('A');
    p.opened('B');
    expect(p.adopt()).toBe('B');
    expect(p.current()).toBe('B');
    expect(saved).toEqual(['B']);
    expect(made).toEqual([]);
  });

  it('is a new one when none was open (closed, or never opened), kept for the next time', () => {
    const { p, saved, made } = make({ playlists: [['A', 3]] });
    expect(p.adopt()).toBe('new-1');
    p.opened('A');
    p.opened(null);
    // An empty one Drashti made for Simple Mode is still as good as new: never a second empty one.
    expect(p.adopt()).toBe('new-1');
    expect(made).toEqual(['new-1']);
    expect(saved).toEqual(['new-1', 'new-1']);
  });

  it('a new one again once the one made before has rows: those are an earlier sabha’s', () => {
    const { p, made, playlists } = make();
    expect(p.adopt()).toBe('new-1');
    playlists.set('new-1', 4);
    expect(p.adopt()).toBe('new-2');
    expect(made).toEqual(['new-1', 'new-2']);
  });

  it('never a playlist since deleted, a folder or a template (none is usable): a new one instead', () => {
    const { p, made } = make({ playlists: [['A', 1]] });
    p.opened('gone');
    expect(p.adopt()).toBe('new-1');
    expect(made).toEqual(['new-1']);
  });

  it('stays the same while in Simple Mode: what opens there changes nothing until the next switch', () => {
    const { p } = make({
      playlists: [
        ['A', 1],
        ['B', 1],
      ],
    });
    p.opened('A');
    expect(p.adopt()).toBe('A');
    p.opened('B');
    expect(p.current()).toBe('A');
  });

  it('at a start in Simple Mode: the one kept from before, or a new one when it is gone', () => {
    const kept = make({ saved: 'S', playlists: [['S', 5]] });
    expect(kept.p.keep()).toBe('S');
    expect(kept.made).toEqual([]);
    const gone = make({ saved: 'S' });
    expect(gone.p.keep()).toBe('new-1');
    expect(gone.saved).toEqual(['new-1']);
    // Nothing kept (an older library, or Simple Mode's first start): a new one.
    const older = make({ saved: undefined, playlists: [['A', 1]] });
    expect(older.p.keep()).toBe('new-1');
    expect(make({ saved: 42 }).p.keep()).toBe('new-1');
  });

  it('none until Simple Mode first needs one', () => {
    expect(make({ saved: 'S', playlists: [['S', 1]] }).p.current()).toBeNull();
  });

  it('a new one is named for its day, never with “Simple Mode” in it (a button of that name is in Pro Mode’s header)', () => {
    expect(simplePlaylistName(new Date(2026, 9, 30, 19, 30))).toBe('Sabha, 30 Oct 2026');
    expect(simplePlaylistName(new Date(2027, 0, 3))).toBe('Sabha, 3 Jan 2027');
  });
});
