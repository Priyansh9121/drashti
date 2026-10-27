import type { DeviceOp } from '../../shared/network-api';

/*
 * The requests that make a phone a mirror of the operator window (Session 54, D5; docs/api.md): the keys the
 * window answers, the props, the media, the lower thirds and the audio playlists, read and put up by id; a prop or a
 * lower third taken off; a timer alone on the screens; the stage message; Back 15 s, Forward 15 s and Last 10 s; and
 * the idle rotation. Made by server.ts's own `route`, so each is checked as every other request is (a Remote's
 * token, its kind, Simple Mode in the main process). None shares a path with a request before it.
 */

type MakeRoute<R> = (
  method: 'GET' | 'POST',
  path: string,
  op: DeviceOp,
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown,
) => R;

export function mirrorRoutes<R>(route: MakeRoute<R>): R[] {
  const command = (type: string) => () => ({ type });
  return [
    route('GET', '/api/v1/keys', 'keys'),
    route('GET', '/api/v1/props', 'props'),
    route('POST', '/api/v1/props/:id/show', 'prop.show', (_b, p) => ({ propId: p['id'] })),
    route('POST', '/api/v1/props/:id/hide', 'command', (_b, p) => ({ type: 'hideProp', propId: p['id'] })),
    route('GET', '/api/v1/media', 'media', (q) => ({
      offset: q['offset'],
      limit: q['limit'],
      query: q['q'],
    })),
    route('POST', '/api/v1/media/:id/show', 'media.show', (_b, p) => ({ mediaId: p['id'] })),
    route('GET', '/api/v1/lower-thirds', 'lowerThirds'),
    route('POST', '/api/v1/lower-thirds/:id/show', 'lowerThird.show', (_b, p) => ({ lowerThirdId: p['id'] })),
    route('POST', '/api/v1/lower-thirds/hide', 'command', command('hideLowerThird')),
    route('GET', '/api/v1/music', 'music'),
    route('POST', '/api/v1/timers/:id/show', 'command', (_b, p) => ({ type: 'showTimer', timerId: p['id'] })),
    route('POST', '/api/v1/stage-message', 'command', (b) => ({ type: 'setStageMessage', text: b['text'] })),
    route('POST', '/api/v1/stage-message/clear', 'command', command('clearStageMessage')),
    route('POST', '/api/v1/skip', 'command', (b) => ({ type: 'skip', layer: b['layer'], jump: b['jump'] })),
    route('POST', '/api/v1/idle/start', 'command', command('startIdle')),
    route('POST', '/api/v1/idle/stop', 'command', command('stopIdle')),
  ];
}
