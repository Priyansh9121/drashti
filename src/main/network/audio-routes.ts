import type { DeviceOp } from '../../shared/network-api';

type MakeRoute<R> = (
  method: 'GET' | 'POST',
  path: string,
  op: DeviceOp,
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown,
) => R;

/** Audio under LIVE, by playlist and track ids. Every mutation uses the window's own music service. */
export function audioRoutes<R>(route: MakeRoute<R>): R[] {
  return [
    route('GET', '/api/v1/music/audio', 'music.audio'),
    route('POST', '/api/v1/music/new', 'music.new', (b) => b),
    route('POST', '/api/v1/music/:id/rename', 'music.rename', (b, p) => ({ ...b, playlistId: p['id'] })),
    route('POST', '/api/v1/music/:id/delete', 'music.remove', (b, p) => ({ ...b, playlistId: p['id'] })),
    route('POST', '/api/v1/music/:id/restore', 'music.restore', (b, p) => ({ ...b, playlistId: p['id'] })),
    route('POST', '/api/v1/music/:id/options', 'music.options', (b, p) => ({ ...b, playlistId: p['id'] })),
    route('POST', '/api/v1/music/:id/tracks/add', 'music.addTracks', (b, p) => ({
      ...b,
      playlistId: p['id'],
    })),
    route('POST', '/api/v1/music/tracks/:id/move', 'music.moveTrack', (b, p) => ({ ...b, trackId: p['id'] })),
    route('POST', '/api/v1/music/tracks/:id/delete', 'music.removeTrack', (b, p) => ({
      ...b,
      trackId: p['id'],
    })),
    route('POST', '/api/v1/music/tracks/:id/restore', 'music.restoreTrack', (b, p) => ({
      ...b,
      trackId: p['id'],
    })),
    route('POST', '/api/v1/music/steps-aside', 'music.stepsAside', (b) => b),
  ];
}
