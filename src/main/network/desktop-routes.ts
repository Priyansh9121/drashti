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
    // The picture-in-picture box's setup, as Picture in Picture… does: what it holds (by id), Swap and its place;
    // Take off is the box's own clear (POST /api/v1/clear/pip). Engine commands, checked as every Remote's is.
    route('POST', '/api/v1/pip/show', 'command', (b) => ({
      type: 'showPip',
      source: b['source'],
      ...(b['place'] === undefined ? {} : { place: b['place'] }),
    })),
    route('POST', '/api/v1/pip/swap', 'command', () => ({ type: 'swapPip' })),
    route('POST', '/api/v1/pip/place', 'command', (b) => ({ type: 'placePip', place: b['place'] })),
    // The library's changes, as the window makes them; each answers with the ids it changed (a delete's Undo).
    route('POST', '/api/v1/presentations/new', 'library.new', (b) => b),
    route('POST', '/api/v1/presentations/delete', 'library.remove', (b) => b),
    route('POST', '/api/v1/presentations/restore', 'library.restore', (b) => b),
    route('POST', '/api/v1/playlists/new', 'playlist.new', (b) => b),
    route('POST', '/api/v1/playlists/delete', 'playlist.remove', (b) => b),
    route('POST', '/api/v1/playlists/restore', 'playlist.restore', (b) => b),
    route('POST', '/api/v1/playlists/:id/rename', 'playlist.rename', (b, p) => ({
      ...b,
      playlistId: p['id'],
    })),
    route('POST', '/api/v1/playlists/:id/add', 'playlist.add', (b, p) => ({ ...b, playlistId: p['id'] })),
    route('POST', '/api/v1/playlists/:id/move', 'playlist.move', (b, p) => ({ ...b, playlistId: p['id'] })),
    route('POST', '/api/v1/playlist-items/delete', 'playlist.removeItems', (b) => b),
    route('POST', '/api/v1/playlist-items/restore', 'playlist.restoreItems', (b) => b),
    // MIDI, as MIDI… sets it up on the computer.
    route('GET', '/api/v1/midi', 'midi'),
    route('POST', '/api/v1/midi/device', 'midi.device', (b) => b),
    route('POST', '/api/v1/midi/forget', 'midi.forget', (b) => b),
    route('POST', '/api/v1/midi/learn', 'midi.learn', (b) => b),
    // The announcements' queue, as Announcements decides on the computer.
    route('GET', '/api/v1/announcement-queue', 'queue'),
    route('POST', '/api/v1/announcement-queue/:id/approve', 'queue.approve', (b, p) => ({
      ...b,
      id: p['id'],
    })),
    route('POST', '/api/v1/announcement-queue/:id/reject', 'queue.reject', (_b, p) => ({ id: p['id'] })),
    route('POST', '/api/v1/announcement-queue/:id/take-off', 'queue.takeOff', (_b, p) => ({ id: p['id'] })),
  ];
}
