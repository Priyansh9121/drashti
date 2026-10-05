import { describe, expect, it } from 'vitest';
import { type NodeHealth, type NodeInfo, nodeWarnings, shortFingerprint, versionMismatch } from './nodes';

/* When a node needs the operator's eye (made-up names). */

const health = (over: Partial<NodeHealth> = {}): NodeHealth => ({
  version: '1.0.0',
  host: 'Placeholder PC',
  displays: [],
  outputs: [],
  media: { wanted: 3, ready: 3, bytesWanted: 3, bytesReady: 3, copying: null, missingNow: 0, problem: null },
  clock: { offsetMs: 2.5, rttMs: 1.2, at: 0 },
  rev: 10,
  ...over,
});

const node = (over: Partial<NodeInfo> = {}): NodeInfo => ({
  id: 'n1',
  name: 'Placeholder Lobby PC',
  pairedAt: '2026-10-05T09:00:00.000Z',
  online: true,
  since: '2026-10-05T09:00:00.000Z',
  lastSeenAt: null,
  address: '192.168.1.30',
  health: health(),
  latencyMs: 1.2,
  versionRefused: null,
  everything: false,
  behindSince: null,
  ...over,
});

const now = Date.parse('2026-10-05T10:00:00.000Z');

describe('node warnings', () => {
  it('none for a node that is online, in step and has its media', () => {
    expect(nodeWarnings([node()], now)).toEqual([]);
  });

  it('offline (since when), refused for its version, behind on media, out of step', () => {
    expect(nodeWarnings([node({ online: false })], now).map((w) => w.kind)).toEqual(['offline']);
    expect(nodeWarnings([node({ online: false })], now)[0]?.text).toMatch(
      /^“Placeholder Lobby PC” offline since /u,
    );
    expect(nodeWarnings([node({ versionRefused: '0.9.0', online: false })], now).map((w) => w.kind)).toEqual([
      'version',
    ]);
    const copying = node({ health: health({ media: { ...health().media, missingNow: 2 } }) });
    expect(nodeWarnings([copying], now)[0]?.text).toBe(
      '“Placeholder Lobby PC” is still copying 2 files on its screens',
    );
    const full = node({ health: health({ media: { ...health().media, problem: 'Not enough room.' } }) });
    expect(nodeWarnings([full], now)[0]?.text).toBe('“Placeholder Lobby PC”: Not enough room.');
    // Out of step: no clock yet, a loose one, or behind the show for more than 6 s (not 3 s).
    expect(nodeWarnings([node({ health: health({ clock: null }) })], now).map((w) => w.kind)).toEqual([
      'step',
    ]);
    expect(
      nodeWarnings([node({ health: health({ clock: { offsetMs: 0, rttMs: 80, at: 0 } }) })], now).map(
        (w) => w.kind,
      ),
    ).toEqual(['step']);
    expect(nodeWarnings([node({ behindSince: new Date(now - 3000).toISOString() })], now)).toEqual([]);
    expect(
      nodeWarnings([node({ behindSince: new Date(now - 7000).toISOString() })], now).map((w) => w.kind),
    ).toEqual(['step']);
    // Online without a report yet: nothing to say until it reports.
    expect(nodeWarnings([node({ health: null })], now)).toEqual([]);
  });

  it('says plainly what to do about versions, and shows fingerprints in groups', () => {
    expect(versionMismatch('1.0.1', '1.0.0')).toBe(
      'Main runs Drashti 1.0.1 and this node runs 1.0.0. Install the same version on both.',
    );
    expect(shortFingerprint('a1b2c3d4e5f6a7b8c9d0')).toBe('A1B2 C3D4 E5F6 A7B8');
  });
});
