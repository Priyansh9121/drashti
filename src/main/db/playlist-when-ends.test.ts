import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { PlaylistRepo } from './playlists';

/*
 * When a video ends (Session 55, Part 6, A), kept per playlist row (migration 50, playlist_items.when_ends): Wallpaper
 * (the default, kept as nothing), Next item, Loop or Freeze, on a video's row only; the show engine reads it with the
 * row; a duplicated playlist keeps it. Placeholder names.
 */

function library() {
  const db = openDatabase(':memory:');
  const add = db.prepare('INSERT INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)');
  add.run('clip', 'video', 'Placeholder clip.mp4', 'ab/clip');
  add.run('pic', 'image', 'Placeholder picture.png', 'ab/pic');
  const repo = new PlaylistRepo(db);
  const id = repo.create('Placeholder evening', null, false) ?? '';
  const [clip = '', pic = ''] = repo.addItems(id, null, [
    { kind: 'media', mediaId: 'clip' },
    { kind: 'media', mediaId: 'pic' },
  ]);
  return { db, repo, id, clip, pic };
}

const whenEndsOf = (repo: PlaylistRepo, playlistId: string, itemId: string) => {
  const item = repo.itemsOf(playlistId).find((i) => i.id === itemId);
  return item?.kind === 'media' ? (item.whenEnds ?? 'wallpaper') : null;
};

describe('a video row’s When it ends', () => {
  it('is Wallpaper to begin with, changed per row, and the show engine reads it with the row', () => {
    const { repo, id, clip } = library();
    expect(whenEndsOf(repo, id, clip)).toBe('wallpaper');
    expect(repo.setWhenEnds(clip, 'loop')).toBe(true);
    expect(whenEndsOf(repo, id, clip)).toBe('loop');
    expect(repo.playItems(id)?.[0]).toMatchObject({ kind: 'media', mediaId: 'clip', whenEnds: 'loop' });
    expect(repo.setWhenEnds(clip, 'next')).toBe(true);
    expect(repo.playItems(id)?.[0]).toMatchObject({ whenEnds: 'next' });
    // Back to the default: kept as nothing.
    expect(repo.setWhenEnds(clip, 'wallpaper')).toBe(true);
    expect(whenEndsOf(repo, id, clip)).toBe('wallpaper');
    expect(repo.playItems(id)?.[0]).not.toHaveProperty('whenEnds');
  });

  it('is a video’s alone: a picture’s row, a removed row or no row is refused', () => {
    const { repo, pic, clip } = library();
    expect(repo.setWhenEnds(pic, 'freeze')).toBe(false);
    expect(repo.setWhenEnds('no-such-row', 'freeze')).toBe(false);
    repo.removeItems([clip]);
    expect(repo.setWhenEnds(clip, 'freeze')).toBe(false);
  });

  it('a duplicated playlist keeps each row’s', () => {
    const { repo, id, clip } = library();
    repo.setWhenEnds(clip, 'freeze');
    const copy = repo.duplicate(id) ?? '';
    const [first] = repo.itemsOf(copy);
    expect(first?.kind === 'media' ? first.whenEnds : null).toBe('freeze');
  });
});
