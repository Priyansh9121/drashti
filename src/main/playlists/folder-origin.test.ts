import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { filesFitFolders, markedFromFolder } from './folder-origin';
import { makeFolderPlaylist } from './folder-playlist';

describe('which playlists came from a folder (Session 44)', () => {
  it('reads an earlier version’s folder playlist from its files: each part in the folder its header names, under one top folder', () => {
    const top = '/Users/placeholder/Movies/Drashti downloads/Placeholder Sabha';
    const files = [
      { part: '', file: `${top}/Opening.mp4` },
      { part: 'Week 1', file: `${top}/Week 1/Clip.mp4` },
      { part: 'Week 1 › Videos', file: `${top}/Week 1/Videos/Deep.mp4` },
      { part: 'Week 2 › Pictures', file: `${top}/Week 2/Pictures/Cover.png` },
    ];
    expect(filesFitFolders(files, posix)).toBe(true);
    // Its top folder's own files may be none.
    expect(filesFitFolders(files.slice(1), posix)).toBe(true);
    // On Windows, with its own separators.
    const winTop = 'C:\\Users\\placeholder\\Videos\\Drashti downloads\\Placeholder Sabha';
    expect(
      filesFitFolders(
        [
          { part: '', file: `${winTop}\\Opening.mp4` },
          { part: 'Week 1 › Videos', file: `${winTop}\\Week 1\\Videos\\Deep.mp4` },
        ],
        win32,
      ),
    ).toBe(true);
  });

  it('never takes the operator’s own headers for folders', () => {
    // Headers of the operator's own: the files are wherever they were imported from.
    expect(
      filesFitFolders(
        [
          { part: '', file: '/Users/placeholder/Desktop/Welcome.mp4' },
          { part: 'Kirtans', file: '/Users/placeholder/Music/Placeholder Dhun.mp3' },
        ],
        posix,
      ),
    ).toBe(false);
    // A part whose files lie in two top folders.
    expect(
      filesFitFolders(
        [
          { part: 'Week 1', file: '/a/Sabha/Week 1/One.mp4' },
          { part: 'Week 1', file: '/b/Sabha/Week 1/Two.mp4' },
        ],
        posix,
      ),
    ).toBe(false);
    // No subfolder at all: nothing to show a folder at a time.
    expect(filesFitFolders([{ part: '', file: '/a/Sabha/One.mp4' }], posix)).toBe(false);
  });

  it('reads only its own marker in a plain playlist’s settings', () => {
    expect(markedFromFolder('{"fromFolder":true}')).toBe(true);
    expect(markedFromFolder('{"fromFolder":"yes"}')).toBe(false);
    expect(markedFromFolder(null)).toBe(false);
    expect(markedFromFolder('not json')).toBe(false);
  });

  it('marks a Dropbox folder’s playlist as it is made, a smart one always, and an earlier one by its files', () => {
    const db = openDatabase(':memory:');
    const repo = new PlaylistRepo(db);
    const top = '/placeholder/Drashti downloads/Placeholder Sabha';
    const media = (id: string, file: string) =>
      db
        .prepare(
          "INSERT INTO media (id, kind, name, path, source_kind, source_path) VALUES (?, 'video', ?, ?, 'media', ?)",
        )
        .run(id, id, `x/${id}.mp4`, file);
    media('opening', `${top}/Opening.mp4`);
    media('clip', `${top}/Week 1/Clip.mp4`);
    media('mine', '/placeholder/Desktop/Mine.mp4');

    // A Dropbox folder link's playlist, made now: marked.
    const made = makeFolderPlaylist(
      repo,
      'Placeholder Sabha',
      [
        { sourcePath: `${top}/Opening.mp4`, outcome: 'imported', target: { kind: 'media', id: 'opening' } },
        { sourcePath: `${top}/Week 1/Clip.mp4`, outcome: 'imported', target: { kind: 'media', id: 'clip' } },
      ] as never,
      [
        { path: `${top}/Opening.mp4`, relative: 'Opening.mp4' },
        { path: `${top}/Week 1/Clip.mp4`, relative: 'Week 1/Clip.mp4' },
      ],
    );
    // One an earlier version made from a link: no marker, the same items.
    const earlier = repo.createAtTop('Placeholder Earlier');
    repo.addItems(earlier, null, [
      { kind: 'media', mediaId: 'opening' },
      { kind: 'header', label: 'Week 1' },
      { kind: 'media', mediaId: 'clip' },
    ]);
    // The operator's own, with a header of their own.
    const own = repo.create('Placeholder Own', null, false) ?? '';
    repo.addItems(own, null, [
      { kind: 'media', mediaId: 'mine' },
      { kind: 'header', label: 'Kirtans' },
      { kind: 'media', mediaId: 'opening' },
    ]);
    const smart = repo.createSmart('Placeholder Smart', '/placeholder/Smart');
    const shown = Object.fromEntries(repo.tree().map((n) => [n.name, n.fromFolder === true]));
    expect(made?.name).toBe('Placeholder Sabha');
    expect(shown).toEqual({
      'Placeholder Sabha': true,
      'Placeholder Earlier': true,
      'Placeholder Own': false,
      'Placeholder Smart': true,
    });
    expect(repo.tree().find((n) => n.id === smart)?.kind).toBe('smart');
    // Found once, the earlier one is marked: a file added later from elsewhere never undoes it.
    repo.addItems(earlier, 2, [{ kind: 'media', mediaId: 'mine' }]);
    expect(repo.tree().find((n) => n.id === earlier)?.fromFolder).toBe(true);
    // Templates never are.
    expect(repo.tree(true).some((n) => n.fromFolder)).toBe(false);
  });
});
