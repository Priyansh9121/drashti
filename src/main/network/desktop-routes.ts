import type { DeviceOp } from '../../shared/network-api';
import { SWITCH_PARAM } from '../../shared/network-desktop';

/*
 * The requests that make a phone a full Drashti (Session 54, the owner's item 3; docs/api.md): the computer's
 * screens set up as Screens does, Keep these screens? answered, and Audience and Stage. Made by server.ts's own
 * `route`, so each is checked as every other request is (a Remote's token, its kind, the lock's 503, the limits,
 * Simple Mode in the main process). Each names only what it changes, by id: a body's other fields reach the main
 * process, where they are refused (desktop-answers.ts). None shares a path with a request before it.
 */

type MakeRoute<R> = (
  method: 'GET' | 'POST',
  path: string,
  op: DeviceOp,
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown,
  param?: RegExp,
) => R;

export function desktopRoutes<R>(route: MakeRoute<R>): R[] {
  return [
    route('GET', '/api/v1/screens', 'screens'),
    route('POST', '/api/v1/screens/keep', 'screens.keep', (b) => b),
    route('POST', '/api/v1/screens/go-back', 'screens.goBack', (b) => b),
    route('POST', '/api/v1/screens/identify', 'screens.identify'),
    route('POST', '/api/v1/screens/:id/change', 'screens.change', (b, p) => ({
      screenId: p['id'],
      patch: b,
    })),
    route('POST', '/api/v1/screens/:id/remove', 'screens.remove', (_b, p) => ({ screenId: p['id'] })),
    route('POST', '/api/v1/screen-groups', 'screens.addGroup', (b) => b),
    route('POST', '/api/v1/screen-groups/:id/name', 'screens.renameGroup', (b, p) => ({
      ...b,
      groupId: p['id'],
    })),
    route('POST', '/api/v1/screen-groups/:id/role', 'screens.groupRole', (b, p) => ({
      ...b,
      groupId: p['id'],
    })),
    route('POST', '/api/v1/screen-groups/:id/display', 'screens.useDisplay', (b, p) => ({
      ...b,
      groupId: p['id'],
    })),
    route('POST', '/api/v1/screen-groups/:id/delete', 'screens.deleteGroup', (_b, p) => ({
      groupId: p['id'],
    })),
    route('POST', '/api/v1/switches/:id', 'switch', (b, p) => ({ ...b, which: p['id'] }), SWITCH_PARAM),
    // Media's video inputs and Show a Window….
    route('GET', '/api/v1/video-inputs', 'inputs'),
    route('POST', '/api/v1/video-inputs', 'input.add', (b) => b),
    route('POST', '/api/v1/video-inputs/:id/change', 'input.change', (b, p) => ({ ...b, inputId: p['id'] })),
    route('POST', '/api/v1/video-inputs/:id/remove', 'input.remove', (_b, p) => ({ inputId: p['id'] })),
    route('POST', '/api/v1/video-inputs/:id/show', 'command', (_b, p) => ({
      type: 'showInput',
      inputId: p['id'],
    })),
    route('GET', '/api/v1/windows', 'windows'),
    route('POST', '/api/v1/windows/show', 'window.show', (b) => b),
  ];
}
