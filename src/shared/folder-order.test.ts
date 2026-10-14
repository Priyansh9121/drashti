import { describe, expect, it } from 'vitest';
import { folderOf, kindRank, naturalCompare, partsInFolderOrder, partTitle } from './folder-order';

const order = (paths: string[]) =>
  partsInFolderOrder(paths, (p) => p, kindRank).map((part) => [part.title, part.entries]);

describe('a folder’s files in a playlist’s order (Session 26c)', () => {
  it('goes folder by folder, depth first: each folder’s videos, then its decks, A→Z', () => {
    expect(
      order([
        'Week 2/Katha.pptx',
        'Opening.MP4',
        'Week 1/Videos/b clip.mp4',
        'Week 1/Decks/Deck 10.pptx',
        'Welcome.pptx',
        'Week 1/Decks/Deck 2.pptx',
        'Week 1/Videos/A clip.mp4',
        'Week 1/intro.mp4',
        'Arti.mov',
      ]),
    ).toEqual([
      ['', ['Arti.mov', 'Opening.MP4', 'Welcome.pptx']],
      ['Week 1', ['Week 1/intro.mp4']],
      ['Week 1 › Decks', ['Week 1/Decks/Deck 2.pptx', 'Week 1/Decks/Deck 10.pptx']],
      ['Week 1 › Videos', ['Week 1/Videos/A clip.mp4', 'Week 1/Videos/b clip.mp4']],
      ['Week 2', ['Week 2/Katha.pptx']],
    ]);
  });

  it('has no part, and no header, for a folder with nothing of its own; numbers in order', () => {
    expect(order(['Sabha 10/x.mp4', 'Sabha 2/Deep/y.mp4', 'Sabha 9/z.pptx'])).toEqual([
      ['Sabha 2 › Deep', ['Sabha 2/Deep/y.mp4']],
      ['Sabha 9', ['Sabha 9/z.pptx']],
      ['Sabha 10', ['Sabha 10/x.mp4']],
    ]);
  });

  it('keeps Gujarati and Hindi names, and puts other kinds after decks: presentations, pictures, sounds', () => {
    expect(order(['પ્રવચન.mp4', 'dhun.mp3', 'darshan.jpg', 'lyrics.txt', 'सभा.pdf'])).toEqual([
      ['', ['પ્રવચન.mp4', 'सभा.pdf', 'lyrics.txt', 'darshan.jpg', 'dhun.mp3']],
    ]);
  });

  it('names parts by their path, and compares as people read', () => {
    expect(partTitle('Week 1/Videos/Deep')).toBe('Week 1 › Videos › Deep');
    expect(folderOf('Week 1/Videos/a.mp4')).toBe('Week 1/Videos');
    expect(folderOf('a.mp4')).toBe('');
    expect(['file10', 'File2', 'file1'].sort(naturalCompare)).toEqual(['file1', 'File2', 'file10']);
  });
});
