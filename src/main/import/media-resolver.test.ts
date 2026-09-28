import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileNameOf, pathFromReference, resolveMedia } from './media-resolver';

const files = (...paths: string[]) => {
  const set = new Set(paths);
  return (path: string) => set.has(path);
};

describe('media references', () => {
  it('decode file URLs and keep Windows paths', () => {
    const local = resolve('/Users/op/Movies/Loop One.mov');
    expect(pathFromReference(pathToFileURL(local).href)).toBe(local);
    expect(pathFromReference('C:\\Media\\Loop.mov')).toBe('C:\\Media\\Loop.mov');
    expect(fileNameOf('C:\\Media\\Loop.mov')).toBe('Loop.mov');
    expect(fileNameOf('file:///C:/Media/Loop%20Two.mov')).toBe('Loop Two.mov');
    expect(fileNameOf('/Volumes/USB/bg.jpg')).toBe('bg.jpg');
  });
});

describe('resolveMedia', () => {
  const byName = new Map([
    ['loop.mov', ['/drop/Other/Loop.mov', '/drop/Backgrounds/Loop.mov']],
    ['bg.jpg', ['/drop/Media/bg.jpg']],
  ]);

  it('uses the original path when the file is still there', () => {
    const isFile = files('/Users/op/Movies/Loop.mov', '/drop/Loop.mov');
    expect(resolveMedia('/Users/op/Movies/Loop.mov', { nearby: ['/drop'], byName, isFile })).toEqual({
      path: '/Users/op/Movies/Loop.mov',
      how: 'original',
      alternatives: 0,
    });
  });

  it('then a file of the same name in a nearby folder (next to the presentation, or in its bundle)', () => {
    const isFile = files(join('/bundle/media', 'Loop.mov'));
    expect(
      resolveMedia('C:\\Users\\op\\Videos\\Loop.mov', { nearby: ['/drop', '/bundle/media'], byName, isFile }),
    ).toEqual({ path: join('/bundle/media', 'Loop.mov'), how: 'nearby', alternatives: 0 });
  });

  it('then anywhere in the imported folders, preferring the same parent folder name', () => {
    const isFile = files();
    expect(resolveMedia('/Old Mac/Backgrounds/Loop.mov', { nearby: [], byName, isFile })).toEqual({
      path: '/drop/Backgrounds/Loop.mov',
      how: 'found',
      alternatives: 1,
    });
    expect(resolveMedia('file:///C:/Stuff/bg.jpg', { nearby: [], byName, isFile })).toEqual({
      path: '/drop/Media/bg.jpg',
      how: 'found',
      alternatives: 0,
    });
  });

  it('gives up when nothing matches', () => {
    expect(resolveMedia('/nowhere/gone.mp4', { nearby: ['/drop'], byName, isFile: files() })).toBeNull();
    expect(resolveMedia('', { nearby: [], byName, isFile: files() })).toBeNull();
  });
});
