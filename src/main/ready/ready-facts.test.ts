import { describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from '../../shared/playlists';
import { missingInPlaylist, readyReport, type ReadyDeps } from './ready-facts';

const media = (
  id: string,
  label: string,
  extra: Partial<Extract<PlaylistItemInfo, { kind: 'media' }>> = {},
) =>
  ({
    id,
    kind: 'media',
    label,
    mediaId: `m-${id}`,
    media: 'video',
    missing: false,
    unplayable: null,
    timers: [],
    ...extra,
  }) satisfies PlaylistItemInfo;

describe('Ready?’s facts (Session 55, Part 8)', () => {
  it('a row is missing when the library says so, or when its file is gone from the disk now', async () => {
    const rows: PlaylistItemInfo[] = [
      media('a', 'Placeholder a.mp4'),
      media('b', 'Placeholder b.mp4', { missing: true }),
      media('c', 'Placeholder c.mp4'),
      { id: 'h', kind: 'header', label: 'Placeholder header', color: null },
      {
        id: 'p',
        kind: 'presentation',
        label: 'Placeholder deck',
        presentationId: 'pp',
        presentationName: null,
        order: { mode: 'all' },
        arrangementName: null,
        timers: [],
      },
    ];
    const seen: string[] = [];
    const found = await missingInPlaylist(rows, {
      mediaFile: (id) => (id === 'm-c' ? '/placeholder/Media/c.mp4' : `/placeholder/Media/${id}.mp4`),
      exists: (path) => {
        seen.push(path);
        return Promise.resolve(path !== '/placeholder/Media/c.mp4');
      },
    });
    expect(found.problems).toEqual(['Placeholder b.mp4', 'Placeholder c.mp4', 'Placeholder deck']);
    expect(found.mediaIds).toEqual(['m-b', 'm-c']);
    // The library's own word is taken for b: its file is not looked for.
    expect(seen).not.toContain('/placeholder/Media/m-b.mp4');
  });

  it('with no playlist open, none is read, and the lines still come', async () => {
    const asked: string[] = [];
    const deps: ReadyDeps = {
      platform: 'linux',
      home: '/home/placeholder',
      now: () => 42,
      screens: () => ({ others: 0, mirrored: false, switches: { audience: true, stage: true }, outputs: [] }),
      sound: () => ({ state: 'default', checked: true, chosen: null, playerRunning: true }),
      videoInput: () => ({ chosen: null, access: 'granted', seen: null }),
      access: () => ({ phase: 'in', stopsInMs: null, endsInMs: null }),
      playlist: (id) => {
        asked.push(id);
        return null;
      },
      mediaFile: () => null,
      exists: () => Promise.resolve(true),
      onBattery: () => false,
      keptAwake: () => false,
      readFile: () => Promise.reject(new Error('never')),
      powershell: () => Promise.reject(new Error('never')),
    };
    const report = await readyReport(deps, null);
    expect(asked).toEqual([]);
    expect(report.at).toBe(42);
    expect(report.lines).toHaveLength(8);
    expect(report.lines.find((l) => l.id === 'files')?.ok).toBe(false);
    expect(report.lines.find((l) => l.id === 'notifications')?.unknown).toBe(true);
  });
});
