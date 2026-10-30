import type { DeviceOp } from '../../shared/network-api';

/*
 * The phone's own requests (Session 55, Part 9; docs/api.md): the wallpapers, the quick bar, a picture's look, Rename…
 * and a video row's When it ends, as the operator window's own requests do each. Made by server.ts's own `route`, so
 * each is checked as every other request is (a Remote's token, its kind, the lock's 503, the limits, Simple Mode in the
 * main process). Each names only what it changes, by id (from its path): a body's other fields reach the main process,
 * where they are refused (phone-answers.ts). None shares a path with a request before it.
 */

type MakeRoute<R> = (
  method: 'GET' | 'POST',
  path: string,
  op: DeviceOp,
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown,
  param?: RegExp,
) => R;

export function phoneRoutes<R>(route: MakeRoute<R>): R[] {
  return [
    route('GET', '/api/v1/wallpapers', 'wallpapers'),
    route('POST', '/api/v1/wallpapers/choose', 'wallpaper.choose', (b) => b),
    route('POST', '/api/v1/wallpapers/:id/rename', 'wallpaper.rename', (b, p) => ({
      ...b,
      wallpaperId: p['id'],
    })),
    route('POST', '/api/v1/wallpapers/:id/delete', 'wallpaper.remove', (b, p) => ({
      ...b,
      wallpaperId: p['id'],
    })),
    route('POST', '/api/v1/wallpapers/:id/restore', 'wallpaper.restore', (b, p) => ({
      ...b,
      wallpaperId: p['id'],
    })),
    route('GET', '/api/v1/quick-bar', 'quickBar'),
    route('POST', '/api/v1/quick-bar', 'quickBar.set', (b) => b),
    route('GET', '/api/v1/media/:id/look', 'media.look', (_b, p) => ({ mediaId: p['id'] })),
    route('POST', '/api/v1/media/:id/look', 'media.setLook', (b, p) => ({ ...b, mediaId: p['id'] })),
    route('POST', '/api/v1/media/:id/rename', 'media.rename', (b, p) => ({ ...b, mediaId: p['id'] })),
    route('POST', '/api/v1/presentations/:id/rename', 'presentation.rename', (b, p) => ({
      ...b,
      presentationId: p['id'],
    })),
    route('POST', '/api/v1/playlist-items/:id/when-ends', 'playlist.whenEnds', (b, p) => ({
      ...b,
      itemId: p['id'],
    })),
  ];
}
