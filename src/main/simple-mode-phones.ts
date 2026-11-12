import type { EngineCommand, EngineCommandType } from '../shared/engine/commands';
import type { EngineState } from '../shared/engine/state';
import type { DeviceOp } from '../shared/network-api';
import { simpleModeRefuses } from '../shared/mode';
import { repeatPlaylistOf } from '../shared/repeat';
import { aPlaylistsMedia, aPlaylistsPresentation, type SimpleScope } from './simple-mode';

/*
 * The phone's Simple Mode allow-list. The network also applies the operator window's IPC bounds before running
 * a request, with the same arguments (network-service.ts WINDOW_ARGS). An operation or command missing here is
 * refused. Taking anything off remains available.
 */

/** What Simple Mode lets a phone do with a request or an engine command. */
export type InSimpleMode =
  /** Reads only: nothing changes (Simple Mode's window reads as much). */
  | 'reads'
  /** What Simple Mode's window does. */
  | 'simple'
  /** Takes something off the screens: never refused, so nothing can stay stuck there. */
  | 'down'
  /** An operation that checks the playlist, its rows or what is playing. */
  | 'within'
  /**
   * Puts nothing on the screens and changes nothing Simple Mode shows: an announcement sent to wait for Pro Mode's
   * approval, and a phone's file (the owner's answer to question 15: uploads carry on in Simple Mode).
   */
  | 'apart'
  /** An engine command: COMMANDS_IN_SIMPLE_MODE says of each. */
  | 'command'
  /** Pro Mode's: refused. */
  | 'pro';

/** What an engine command can be in Simple Mode, from a phone. */
export type CommandInSimpleMode = Extract<InSimpleMode, 'simple' | 'down' | 'within' | 'pro'>;

/**
 * Every request a device can make, as Simple Mode lets a phone make it. Those Simple Mode's lock refuses the window
 * (their window request, network-service.ts OP_CHANNEL) are refused there first, in the window's words.
 */
export const PHONE_OPS_IN_SIMPLE_MODE: Readonly<Record<DeviceOp, InSimpleMode>> = {
  me: 'reads',
  status: 'reads',
  state: 'reads',
  stage: 'reads',
  hall: 'reads',
  'music.play': 'simple',
  'music.audio': 'reads',
  'music.new': 'simple',
  'music.rename': 'simple',
  'music.remove': 'simple',
  'music.restore': 'simple',
  'music.options': 'simple',
  'music.addTracks': 'simple',
  'music.moveTrack': 'simple',
  'music.removeTrack': 'simple',
  'music.restoreTrack': 'simple',
  'music.stepsAside': 'simple',
  'shastra.texts': 'reads',
  // Simple Mode's window has no Shastra.
  shastra: 'pro',
  playlists: 'reads',
  items: 'within',
  presentation: 'reads',
  presentations: 'reads',
  search: 'reads',
  messages: 'reads',
  timers: 'reads',
  command: 'command',
  // No messages in Simple Mode's window; taking one off stays.
  'message.show': 'pro',
  'message.hide': 'down',
  preview: 'reads',
  'media.picture': 'reads',
  'media.original': 'reads',
  announce: 'apart',
  announcement: 'reads',
  keys: 'reads',
  media: 'reads',
  // Its window puts up its playlist's rows, never Media's (not even a file its playlist has: its row does that).
  'media.show': 'pro',
  lowerThirds: 'reads',
  // No lower thirds in Simple Mode (Part 18); taking one off is a command (hideLowerThird).
  'lowerThird.show': 'pro',
  music: 'reads',
  // Any active Repeat Slides playlist can go round.
  'repeat.start': 'within',
  shared: 'reads',
  'shared.items': 'reads',
  uploads: 'reads',
  // The owner's answer to question 15: a phone's files carry on in Simple Mode (the worker takes them, never live).
  upload: 'apart',
  'upload.status': 'reads',
  'upload.piece': 'apart',
  'upload.cancel': 'apart',
  screens: 'reads',
  // The screens' setup: Pro Mode's (the lock refuses it the window too).
  'screens.addGroup': 'pro',
  'screens.renameGroup': 'pro',
  'screens.groupRole': 'pro',
  'screens.deleteGroup': 'pro',
  'screens.useDisplay': 'pro',
  'screens.change': 'pro',
  'screens.displayJob': 'pro',
  'screens.remove': 'pro',
  // Keep these screens? shows in either mode's window (Session 50), and Identify is on Simple Mode's dashboard.
  'screens.keep': 'simple',
  'screens.goBack': 'simple',
  'screens.identify': 'simple',
  // Audience and Stage: on only, as Simple Mode's window turns them (the switches refuse Off in Simple Mode).
  switch: 'simple',
  inputs: 'reads',
  'input.add': 'pro',
  'input.change': 'pro',
  'input.remove': 'pro',
  // Show a Window… is Pro Mode's, its list too (the lock refuses both).
  windows: 'pro',
  'window.show': 'pro',
  'library.new': 'pro',
  'library.remove': 'pro',
  'library.restore': 'pro',
  // The window's playlist and row bounds apply to every change, including Undo.
  'playlist.new': 'simple',
  'playlist.rename': 'simple',
  'playlist.remove': 'simple',
  'playlist.restore': 'simple',
  // Simple Mode brings files into a playlist through imports and phone uploads.
  'playlist.add': 'pro',
  'playlist.move': 'simple',
  'playlist.removeItems': 'simple',
  'playlist.restoreItems': 'simple',
  midi: 'reads',
  'midi.device': 'pro',
  'midi.forget': 'pro',
  'midi.learn': 'pro',
  queue: 'reads',
  'queue.approve': 'pro',
  'queue.reject': 'pro',
  'queue.takeOff': 'pro',
  'stage.layouts': 'reads',
  'stage.layout': 'pro',
  // The quick bar and the Picture editor stay Pro Mode's. Wallpaper and playlist row changes are available.
  wallpapers: 'reads',
  'wallpaper.choose': 'simple',
  'wallpaper.rename': 'simple',
  'wallpaper.remove': 'simple',
  'wallpaper.restore': 'simple',
  quickBar: 'reads',
  'quickBar.set': 'pro',
  'media.look': 'reads',
  'media.setLook': 'pro',
  'media.rename': 'within',
  'presentation.rename': 'within',
  'playlist.whenEnds': 'simple',
};

/**
 * Every engine command, as Simple Mode lets a phone send it (only REMOTE_COMMANDS come from a phone's 'command'; the
 * rest from its other requests, or never). Those the engine refuses the window too (shared/mode.ts simpleModeRefuses)
 * are Pro Mode's here, and keep the window's words.
 */
export const COMMANDS_IN_SIMPLE_MODE: Readonly<Record<EngineCommandType, CommandInSimpleMode>> = {
  // A slide, a row or Repeat Slides from an active playlist.
  goLive: 'within',
  playItem: 'within',
  startRepeat: 'within',
  stopRepeat: 'simple',
  // The live zoom (Session 55, Part 5).
  zoomLive: 'simple',
  resetLiveZoom: 'simple',
  next: 'simple',
  previous: 'simple',
  back: 'simple',
  // Shift and an arrow, in Simple Mode's keys.
  nextItem: 'simple',
  previousItem: 'simple',
  clearLayer: 'down',
  clearAll: 'simple',
  putBack: 'simple',
  // Its F9 only (no phone sends it).
  oops: 'simple',
  setBlackout: 'simple',
  toggleBlackout: 'simple',
  setWallpaper: 'simple',
  toggleWallpaper: 'simple',
  // Media's: a background or a sound chosen there (a phone's 'media.show').
  setBackground: 'pro',
  showInput: 'pro',
  toggleInput: 'pro',
  playAudio: 'pro',
  showMessage: 'pro',
  hideMessage: 'down',
  showLowerThird: 'pro',
  hideLowerThird: 'down',
  startTimer: 'pro',
  pauseTimer: 'pro',
  resetTimer: 'pro',
  setStageMessage: 'pro',
  clearStageMessage: 'down',
  cueNext: 'pro',
  clearCue: 'pro',
  playCue: 'pro',
  // Starting a playlist by id goes through music.play. Track controls use the engine's current audio.
  playMusic: 'pro',
  pauseMusic: 'simple',
  resumeMusic: 'simple',
  musicNext: 'simple',
  musicPrevious: 'simple',
  setMusicLoop: 'pro',
  jumpToMarker: 'pro',
  // Simple Mode's shared engine guard limits this to an audio playlist's track.
  skip: 'simple',
  moveTo: 'simple',
  pausePlaying: 'simple',
  resumePlaying: 'simple',
  showTimer: 'pro',
  showAudienceTimer: 'pro',
  hideAudienceTimer: 'down',
  showPip: 'pro',
  hidePip: 'down',
  swapPip: 'pro',
  placePip: 'pro',
};

/** The current desktop selection and the playable playlists a paired phone can use in Simple Mode. */
export interface SimplePhoneScope extends SimpleScope {
  activePlaylist(playlistId: string): boolean;
  activeItem(playlistId: string, itemId: string): boolean;
  /** Whether a presentation or passage is listed, in exactly the named row when a cursor is given. */
  plays(presentationId: string, from?: { playlistId: string; itemId: string }): boolean;
  refusal(): string;
}

const ruleOf = <K extends string, R>(table: Readonly<Record<K, R>>, key: string): R | null =>
  Object.hasOwn(table, key) ? table[key as K] : null;

function activePlaylist(scope: SimplePhoneScope, id: unknown): id is string {
  return typeof id === 'string' && scope.activePlaylist(id);
}

/** The phone's scope on top of the window's IPC bounds, which are checked before this. */
export function phoneMayInSimpleMode(
  op: string,
  args: Record<string, unknown>,
  scope: SimplePhoneScope,
): boolean {
  switch (ruleOf(PHONE_OPS_IN_SIMPLE_MODE, op)) {
    case 'reads':
    case 'simple':
    case 'down':
    case 'apart':
    case 'command':
      return true;
    case 'within':
      if (op === 'items' || op === 'repeat.start') return activePlaylist(scope, args['playlistId']);
      if (op === 'media.rename') {
        const id = args['mediaId'];
        return aPlaylistsMedia(scope, id) || (typeof id === 'string' && (scope.inMusic?.(id) ?? false));
      }
      return op === 'presentation.rename' && aPlaylistsPresentation(scope, args['presentationId']);
    case 'pro':
    case null:
      return false;
  }
}

/** The shared engine guard applies to phone commands before they are dispatched. */
export function phoneCommandInSimpleMode(
  command: EngineCommand,
  scope: SimplePhoneScope,
  state: Pick<EngineState, 'layers'> | null = null,
): boolean {
  if (simpleModeRefuses(command, state)) return false;
  switch (ruleOf(COMMANDS_IN_SIMPLE_MODE, command.type)) {
    case 'simple':
    case 'down':
      return true;
    case 'within':
      return commandWithin(command, scope);
    case 'pro':
    case null:
      return false;
  }
}

function commandWithin(command: EngineCommand, scope: SimplePhoneScope): boolean {
  switch (command.type) {
    case 'playItem':
      return scope.activePlaylist(command.playlistId) && scope.activeItem(command.playlistId, command.itemId);
    case 'startRepeat':
      return scope.activePlaylist(command.playlistId);
    case 'goLive': {
      const repeating = repeatPlaylistOf(command.presentationId);
      const from = command.playlist ?? undefined;
      if (repeating !== null) return from === undefined && scope.activePlaylist(repeating);
      return (
        (from === undefined || scope.activePlaylist(from.playlistId)) &&
        scope.plays(command.presentationId, from)
      );
    }
    default:
      return false;
  }
}
