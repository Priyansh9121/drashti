import { expect, it } from 'vitest';
import { openDatabase } from './database';
import { PlaylistRepo } from './playlists';

it('keeps crossfade seconds across reads without changing Shuffle, Repeat all or the saved draw', () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new PlaylistRepo(db);
    const made = repo.create('Placeholder crossfade', null, false);
    expect(made).toBeTruthy();
    if (!made) throw new Error('No playlist');
    expect(repo.setPlayOptions(made, { shuffle: true, repeatAll: true, crossfadeMs: 2000 })).toBe(true);
    const before = repo.playOptions(made);
    expect(before.crossfadeMs).toBe(2000);
    expect(repo.tree().find((p) => p.id === made)?.playback?.crossfadeMs).toBe(2000);
    repo.setPlayOptions(made, { shuffle: false, repeatAll: true });
    expect(repo.playOptions(made)).toMatchObject({ crossfadeMs: 2000, shuffle: false, repeatAll: true });
    repo.setPlayOptions(made, { shuffle: false, repeatAll: true, crossfadeMs: 0 });
    expect(repo.playOptions(made).crossfadeMs ?? 0).toBe(0);
  } finally {
    db.close();
  }
});

it('lists the videos of the playlists that crossfade, for their page copies (QA23-FADE-9 candidate 1)', () => {
  const db = openDatabase(':memory:');
  try {
    for (const id of ['red', 'blue', 'green'])
      db.prepare(
        "INSERT INTO media (id, kind, name, path, playable, format) VALUES (?, 'video', ?, ?, 1, 'VP8 video (WebM)')",
      ).run(id, `Placeholder ${id}.webm`, `${id}.webm`);
    const repo = new PlaylistRepo(db);
    const fading = repo.create('Placeholder fading', null, false);
    const plain = repo.create('Placeholder plain', null, false);
    if (!fading || !plain) throw new Error('No playlists');
    expect(repo.crossfadeMediaIds(), 'none crossfades yet').toEqual([]);
    expect(
      repo.addItems(fading, null, [
        { kind: 'media', mediaId: 'red' },
        { kind: 'media', mediaId: 'blue' },
      ]).ok,
    ).toBe(true);
    expect(repo.addItems(plain, null, [{ kind: 'media', mediaId: 'green' }]).ok).toBe(true);
    repo.setPlayOptions(fading, { shuffle: false, repeatAll: false, crossfadeMs: 2000 });
    expect(repo.crossfadeMediaIds().sort()).toEqual(['blue', 'red']);
    repo.setPlayOptions(fading, { shuffle: false, repeatAll: false, crossfadeMs: 0 });
    expect(repo.crossfadeMediaIds(), 'its crossfade off: none').toEqual([]);
  } finally {
    db.close();
  }
});
