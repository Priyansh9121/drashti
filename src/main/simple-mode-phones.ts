import type { EngineCommand, EngineCommandType } from '../shared/engine/commands';
import type { EngineState } from '../shared/engine/state';
import type { DeviceOp } from '../shared/network-api';
import { repeatPresentationId } from '../shared/repeat';
import type { SimpleScope } from './simple-mode';

/*
 * A paired phone in Simple Mode (Session 55, the owner's answer of 30 Oct 2026): it may do only what Simple Mode's
 * window does (simple/SimpleApp.tsx: its one playlist's rows, Next and Back, Clear all and the clears' keys, Put it
 * back, Black-out, the Wallpaper, the live zoom, the time bar's Play while something is paused, Repeat Slides started
 * and stopped on its playlist, Keep these screens? and the screens turned on), and the main process refuses the rest
 * (network/network-service.ts asks here before anything runs), in words the phone shows (shared/mode.ts
 * simplePhoneRefusalText). Until then a phone could show a lower third, a message, the stage message or a timer, put
 * up anything from Media or the library and start the music on a computer in Simple Mode.
 *
 * An allow-list: every request a device can make (DEVICE_OPS) and every engine command is in one of the two tables
 * below, which their types make whole (a new one cannot be added without saying what Simple Mode lets a phone do with
 * it), and one not in them is refused. Taking something off the screens is never refused, so nothing can stay stuck
 * there. With Simple access (Part 19) the same: the mode keeper holds the mode in Simple, so this list too.
 */

/** What Simple Mode lets a phone do with a request or an engine command. */
export type InSimpleMode =
  /** Reads only: nothing changes (Simple Mode's window reads as much). */
  | 'reads'
  /** What Simple Mode's window does. */
  | 'simple'
  /** Takes something off the screens: never refused, so nothing can stay stuck there. */
  | 'down'
  /** What Simple Mode's window does within its bounds: its one playlist (and, for the music, Play while paused). */
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
  // Its window plays no audio playlist (Part 18 took the music strip out): only on from a pause, as the time bar's
  // Play does (the owner's answer to question 14).
  'music.play': 'within',
  'shastra.texts': 'reads',
  // Simple Mode's window has no Shastra.
  shastra: 'pro',
  playlists: 'reads',
  items: 'reads',
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
  // Its one playlist going round (a Repeat Slides playlist), as its window's Next and Start do.
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
  'playlist.new': 'pro',
  'playlist.rename': 'pro',
  'playlist.remove': 'pro',
  'playlist.restore': 'pro',
  // Its one playlist's rows change from its window only (Part 18: a phone changes no playlist in Simple Mode).
  'playlist.add': 'pro',
  'playlist.move': 'pro',
  'playlist.removeItems': 'pro',
  'playlist.restoreItems': 'pro',
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
};

/**
 * Every engine command, as Simple Mode lets a phone send it (only REMOTE_COMMANDS come from a phone's 'command'; the
 * rest from its other requests, or never). Those the engine refuses the window too (shared/mode.ts simpleModeRefuses)
 * are Pro Mode's here, and keep the window's words.
 */
export const COMMANDS_IN_SIMPLE_MODE: Readonly<Record<EngineCommandType, CommandInSimpleMode>> = {
  // A row of its one playlist: a slide of a presentation (or a Shastra passage) it has, an item of it, it going round.
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
  // Audio's (Part 18 took the music strip out of Simple Mode's window); on from a pause is the time bar's Play.
  playMusic: 'pro',
  pauseMusic: 'pro',
  resumeMusic: 'simple',
  musicNext: 'pro',
  musicPrevious: 'pro',
  setMusicLoop: 'pro',
  // No markers' jumps in Simple Mode's window (Part 18): its time bar shows them, and moves nothing.
  jumpToMarker: 'pro',
  skip: 'pro',
  moveTo: 'pro',
  // The time bar's Pause: Simple Mode's shows Play only (question 14).
  pausePlaying: 'pro',
  resumePlaying: 'simple',
  showTimer: 'pro',
  showAudienceTimer: 'pro',
  hideAudienceTimer: 'down',
  showPip: 'pro',
  hidePip: 'down',
  swapPip: 'pro',
  placePip: 'pro',
};

/** Simple Mode as a phone's request is weighed (index.ts): its one playlist and what it holds, and the phone's words. */
export interface SimplePhoneScope extends SimpleScope {
  /** Whether the one playlist plays this presentation: a presentation's row (a PDF's or a deck's too), a passage's. */
  plays(presentationId: string): boolean;
  /** What a phone is told when it asks for what Simple Mode's window does not do (shared/mode.ts). */
  refusal(): string;
}

const ruleOf = <K extends string, R>(table: Readonly<Record<K, R>>, key: string): R | null =>
  Object.hasOwn(table, key) ? table[key as K] : null;

const theOne = (scope: SimpleScope, playlistId: unknown): boolean =>
  scope.playlistId !== null && playlistId === scope.playlistId;

/** An item of the one playlist. */
const itsItem = (scope: SimpleScope, itemId: unknown): boolean =>
  scope.playlistId !== null && typeof itemId === 'string' && scope.playlistOf(itemId) === scope.playlistId;

/**
 * Whether a request on its own (not an engine command's: phoneCommandInSimpleMode weighs those, as each is sent) is
 * one Simple Mode lets a phone make, with its arguments as sent and the show as it is. Anything not listed: no.
 */
export function phoneMayInSimpleMode(
  op: string,
  args: Record<string, unknown>,
  scope: SimplePhoneScope,
  state: Pick<EngineState, 'layers'> | null,
): boolean {
  switch (ruleOf(PHONE_OPS_IN_SIMPLE_MODE, op)) {
    case 'reads':
    case 'simple':
    case 'down':
    case 'apart':
    case 'command':
      return true;
    case 'within':
      if (op === 'repeat.start') return theOne(scope, args['playlistId']);
      if (op === 'music.play') {
        // On from where the audio playlist was paused, as the time bar's Play: never one chosen (that starts it).
        const audio = state?.layers.audio;
        return (
          (args['playlistId'] === undefined || args['playlistId'] === null) &&
          audio?.music !== undefined &&
          audio.pausedAtMs !== undefined
        );
      }
      return false;
    case 'pro':
    case null:
      return false;
  }
}

/** Whether Simple Mode lets a phone send this engine command (from any of its requests). Anything not listed: no. */
export function phoneCommandInSimpleMode(command: EngineCommand, scope: SimplePhoneScope): boolean {
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

/** A row of the one playlist, as its window puts one up. */
function commandWithin(command: EngineCommand, scope: SimplePhoneScope): boolean {
  if (scope.playlistId === null) return false;
  switch (command.type) {
    case 'playItem':
      return theOne(scope, command.playlistId) && itsItem(scope, command.itemId);
    case 'startRepeat':
      return theOne(scope, command.playlistId);
    case 'goLive': {
      // One of its steps, when it is a Repeat Slides playlist: it goes round from there (the engine's startRepeat).
      if (command.presentationId === repeatPresentationId(scope.playlistId)) return true;
      // A slide of a presentation it plays, from its row (that row of it) or with none.
      const from = command.playlist ?? null;
      return (
        scope.plays(command.presentationId) &&
        (from === null || (theOne(scope, from.playlistId) && itsItem(scope, from.itemId)))
      );
    }
    default:
      return false;
  }
}
