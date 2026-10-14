import { describe, expect, it } from 'vitest';
import { NO_COUNTS, type ImportItemReport } from '../../shared/import';
import { openDatabase } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import { addToFolderParts, makeFolderPlaylist } from './folder-playlist';

/* A Dropbox folder as one playlist (Session 26c): made-up decks and videos, three folders deep. */

function setup() {
  const db = openDatabase(':memory:');
  const repo = new PlaylistRepo(db);
  const presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Default');
  const deck = (name: string) =>
    presentations.insert({ libraryId: lib, name, groups: [{ name: 'Pages', slides: [{ elements: [] }] }] });
  const media = (id: string, kind: string, name: string) =>
    db.prepare('INSERT INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)').run(id, kind, name, `${id}.x`);
  return { db, repo, deck, media };
}

const report = (
  sourcePath: string,
  target: ImportItemReport['target'],
  outcome: ImportItemReport['outcome'] = 'imported',
): ImportItemReport => ({
  id: sourcePath,
  sourcePath,
  format: 'media',
  outcome,
  name: null,
  target,
  counts: NO_COUNTS,
  message: null,
  issues: [],
});

const shown = (repo: PlaylistRepo, id: string) =>
  repo.itemsOf(id).map((i) => (i.kind === 'header' ? `# ${i.label}` : i.label));

describe('a Dropbox folder as one playlist', () => {
  it('goes folder by folder: each folder’s videos then decks, A→Z, a header before each subfolder', () => {
    const { repo, deck, media } = setup();
    const welcome = deck('Welcome');
    const katha = deck('Katha 10');
    const katha2 = deck('Katha 2');
    media('v1', 'video', 'Opening.mp4');
    media('v2', 'video', 'Clip b.mp4');
    media('v3', 'video', 'Clip A.mp4');
    const root = '/saved/Folder';
    const files = [
      { path: `${root}/Welcome.pptx`, relative: 'Welcome.pptx' },
      { path: `${root}/Opening.mp4`, relative: 'Opening.mp4' },
      { path: `${root}/Week 1/Decks/Katha 10.pptx`, relative: 'Week 1/Decks/Katha 10.pptx' },
      { path: `${root}/Week 1/Decks/Katha 2.pptx`, relative: 'Week 1/Decks/Katha 2.pptx' },
      // A video Drashti imported as a 1080p copy: the copy's path, the original's place.
      { path: '/work/0/Clip b.mp4', relative: 'Week 1/Videos/Clip b.mp4' },
      { path: `${root}/Week 1/Videos/Clip A.mp4`, relative: 'Week 1/Videos/Clip A.mp4' },
      { path: `${root}/Week 2/Broken.pptx`, relative: 'Week 2/Broken.pptx' },
    ];
    const items = [
      report(`${root}/Welcome.pptx`, { kind: 'presentation', id: welcome }),
      report(`${root}/Opening.mp4`, { kind: 'media', id: 'v1' }),
      report(`${root}/Week 1/Decks/Katha 10.pptx`, { kind: 'presentation', id: katha }),
      report(`${root}/Week 1/Decks/Katha 2.pptx`, { kind: 'presentation', id: katha2 }),
      report('/work/0/Clip b.mp4', { kind: 'media', id: 'v2' }),
      report(`${root}/Week 1/Videos/Clip A.mp4`, { kind: 'media', id: 'v3' }),
      // One file that failed does not stop the rest: no part for its folder.
      report(`${root}/Week 2/Broken.pptx`, null, 'failed'),
    ];
    repo.create('Folder', null, false);
    const made = makeFolderPlaylist(repo, 'Folder', items, files);
    expect(made?.name).toBe('Folder (2)');
    expect(repo.tree()[0]?.id).toBe(made?.id);
    expect(shown(repo, made?.id ?? '')).toEqual([
      'Opening.mp4',
      'Welcome',
      '# Week 1 › Decks',
      'Katha 2',
      'Katha 10',
      '# Week 1 › Videos',
      'Clip A.mp4',
      'Clip b.mp4',
    ]);
  });

  it('makes no playlist when nothing came in', () => {
    const { repo } = setup();
    expect(makeFolderPlaylist(repo, 'Empty', [], [])).toBeNull();
    expect(repo.tree()).toEqual([]);
  });

  it('puts the PDFs and pictures, added later, at the end of their folder’s part, items moved by hand staying put', () => {
    const { repo, deck, media } = setup();
    const katha = deck('Katha');
    media('v1', 'video', 'Opening.mp4');
    media('v2', 'video', 'Clip.mp4');
    const root = '/saved/F';
    const made = makeFolderPlaylist(
      repo,
      'F',
      [
        report(`${root}/Opening.mp4`, { kind: 'media', id: 'v1' }),
        report(`${root}/Week 1/Katha.pptx`, { kind: 'presentation', id: katha }),
        report(`${root}/Week 1/Clip.mp4`, { kind: 'media', id: 'v2' }),
      ],
      [
        { path: `${root}/Opening.mp4`, relative: 'Opening.mp4' },
        { path: `${root}/Week 1/Katha.pptx`, relative: 'Week 1/Katha.pptx' },
        { path: `${root}/Week 1/Clip.mp4`, relative: 'Week 1/Clip.mp4' },
      ],
    );
    const id = made?.id ?? '';
    expect(shown(repo, id)).toEqual(['Opening.mp4', '# Week 1', 'Clip.mp4', 'Katha']);
    const pdf = deck('Notes');
    media('p1', 'image', 'Darshan.jpg');
    media('p2', 'image', 'Cover.png');
    media('p3', 'image', 'Later.png');
    const added = addToFolderParts(
      repo,
      id,
      [
        report(`${root}/Week 1/Notes.pdf`, { kind: 'presentation', id: pdf }),
        report(`${root}/Darshan.jpg`, { kind: 'media', id: 'p1' }),
        report(`${root}/Week 1/Cover.png`, { kind: 'media', id: 'p2' }),
        report(`${root}/Week 3/Later.png`, { kind: 'media', id: 'p3' }),
      ],
      [
        { path: `${root}/Week 1/Notes.pdf`, relative: 'Week 1/Notes.pdf' },
        { path: `${root}/Darshan.jpg`, relative: 'Darshan.jpg' },
        { path: `${root}/Week 1/Cover.png`, relative: 'Week 1/Cover.png' },
        { path: `${root}/Week 3/Later.png`, relative: 'Week 3/Later.png' },
      ],
    );
    expect(added).toBe(4);
    expect(shown(repo, id)).toEqual([
      'Opening.mp4',
      'Darshan.jpg',
      '# Week 1',
      'Clip.mp4',
      'Katha',
      'Notes',
      'Cover.png',
      '# Week 3',
      'Later.png',
    ]);
  });
});
