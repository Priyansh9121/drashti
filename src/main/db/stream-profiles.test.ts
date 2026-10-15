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

  it('keep up to two more places beside a profile’s own address, in order, by their ids, and lose them with it (Session 28)', () => {
    const db = openDatabase(':memory:');
    const keys = new Set<string>();
    const repo = new StreamProfileRepo(db, (id) => keys.has(id));
    const id = repo.create({
      name: 'Several',
      url: YOUTUBE_RTMPS_URL,
      preset: 'several',
      camera: null,
      sound: null,
      soundDelayMs: 0,
      mixOwnSound: false,
      more: [{ url: 'rtmps://live-api-s.facebook.com:443/rtmp' }, { url: 'rtmp://127.0.0.1:1935/live' }],
    });
    const made = repo.get(id);
    expect(made?.preset).toBe('several');
    expect(made?.more.map((d) => d.url)).toEqual([
      'rtmps://live-api-s.facebook.com:443/rtmp',
      'rtmp://127.0.0.1:1935/live',
    ]);
    const [facebook, other] = made?.more ?? [];
    keys.add(facebook?.id ?? '');
    expect(repo.get(id)?.more.map((d) => d.hasKey)).toEqual([true, false]);
    expect(repo.keyIds(id)).toEqual([id, facebook?.id, other?.id]);
    // Saved again in another order, one taken out: the one kept keeps its id (and so its key).
    const { id: _id, hasKey: _hasKey, more: _more, ...input } = made ?? repo.ensureOne();
    repo.update(id, { ...input, more: [{ id: facebook?.id ?? '', url: facebook?.url ?? '' }] });
    expect(repo.get(id)?.more).toEqual([{ id: facebook?.id, url: facebook?.url, hasKey: true }]);
    // Left out: as they were.
    repo.update(id, { ...input, name: 'Renamed' });
    expect(repo.get(id)?.more).toHaveLength(1);
    // Someone else's id is never taken over: a new place.
    const other2 = repo.create({ ...input, name: 'Another' });
    repo.update(other2, { ...input, more: [{ id: facebook?.id ?? '', url: 'rtmp://127.0.0.1:1935/x' }] });
    expect(repo.get(other2)?.more[0]?.id).not.toBe(facebook?.id);
    // Three places at most, whatever is asked.
    repo.update(id, {
      ...input,
      more: [{ url: 'rtmp://127.0.0.1/a' }, { url: 'rtmp://127.0.0.1/b' }, { url: 'rtmp://127.0.0.1/c' }],
    });
    expect(repo.get(id)?.more).toHaveLength(2);
    repo.remove(id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stream_destinations WHERE profile_id = ?').get(id)).toEqual({
      n: 0,
    });
    const columns = (db.prepare('PRAGMA table_info(stream_destinations)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns.some((c) => /key|secret|token/iu.test(c))).toBe(false);
    db.close();
  });
});
