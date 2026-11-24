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
