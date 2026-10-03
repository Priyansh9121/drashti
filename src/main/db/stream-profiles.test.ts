import { describe, expect, it } from 'vitest';
import { YOUTUBE_RTMPS_URL } from '../../shared/stream';
import { openDatabase } from './database';
import { StreamProfileRepo } from './stream-profiles';

describe('stream profiles', () => {
  it('keep where the stream goes and what it takes in, and never a key', () => {
    const db = openDatabase(':memory:');
    const repo = new StreamProfileRepo(db, (id) => id === 'never');
    const first = repo.ensureOne();
    expect(first).toMatchObject({ name: 'YouTube', url: YOUTUBE_RTMPS_URL, preset: 'good', hasKey: false });
    expect(repo.ensureOne().id).toBe(first.id);
    const id = repo.create({
      name: 'Weak',
      url: 'rtmp://127.0.0.1:1935/live2',
      preset: 'weak',
      camera: { id: 'cam-1', label: 'Placeholder camera' },
      sound: { id: 'mic-1', label: 'Placeholder line in' },
      soundDelayMs: 120,
      mixOwnSound: true,
    });
    expect(repo.get(id)).toMatchObject({
      camera: { id: 'cam-1', label: 'Placeholder camera' },
      sound: { label: 'Placeholder line in' },
      soundDelayMs: 120,
      mixOwnSound: true,
    });
    expect(repo.list().map((p) => p.name)).toEqual(['YouTube', 'Weak']);
    const columns = (db.prepare('PRAGMA table_info(stream_profiles)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns.some((c) => /key|secret|token/iu.test(c))).toBe(false);
    expect(repo.remove(id)).toBe(true);
    expect(repo.get(id)).toBeNull();
    db.close();
  });
});
