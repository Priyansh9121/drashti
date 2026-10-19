import { describe, expect, it } from 'vitest';
import { startupReads } from './startup-reads';

/*
 * The start-up reads a window says it could not do (Session 39): each fails as it would, the log names a
 * failure once (again only after a read that worked), and a test's switch holds a read failing until the
 * test makes it readable.
 */

describe('startupReads', () => {
  it('fails as the read fails, and says so once until a read works again', () => {
    const said: string[] = [];
    const reads = startupReads(undefined, (line) => said.push(line));
    let stored: string[] | Error = ['Ravi Sabha'];
    const tree = () =>
      reads.read('playlists', () => {
        if (stored instanceof Error) throw stored;
        return stored;
      });
    expect(tree()).toEqual(['Ravi Sabha']);
    stored = new Error('a refused read of the library');
    expect(tree).toThrow('a refused read of the library');
    expect(tree).toThrow('a refused read of the library');
    expect(said).toEqual([
      'Start-up: Drashti could not read the playlists for a window, which says so (Error: a refused read of the library)',
    ]);
    // Read again, then failing again: said again.
    stored = ['Ravi Sabha'];
    expect(tree()).toEqual(['Ravi Sabha']);
    stored = new Error('refused again');
    expect(tree).toThrow('refused again');
    expect(said).toHaveLength(2);
    expect(said[1]).toContain('(Error: refused again)');
  });

  it('says each read on its own', () => {
    const said: string[] = [];
    const reads = startupReads('engine,presentation', (line) => said.push(line));
    expect(() => reads.read('engine', () => 1)).toThrow('A test made this read fail');
    expect(() => reads.read('presentation', () => 1)).toThrow('A test made this read fail');
    expect(() => reads.read('engine', () => 1)).toThrow();
    expect(said.map((line) => line.replace(/ for a window.*/u, ''))).toEqual([
      'Start-up: Drashti could not read the show’s state',
      'Start-up: Drashti could not read a presentation',
    ]);
  });

  it('holds a test’s reads failing until the test makes each readable, and ignores names it does not know', () => {
    const reads = startupReads(' playlists , playlist-items,stage ', () => undefined);
    expect(() => reads.read('playlists', () => 'tree')).toThrow('A test made this read fail');
    expect(() => reads.read('playlist-items', () => 'items')).toThrow('A test made this read fail');
    expect(reads.read('engine', () => 'state')).toBe('state');
    reads.readable('playlists');
    reads.readable('stage');
    expect(reads.read('playlists', () => 'tree')).toBe('tree');
    expect(() => reads.read('playlist-items', () => 'items')).toThrow();
  });
});
