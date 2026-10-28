import type { DeviceKind } from './network';

/*
 * What a paired device may ask for, by kind. The network server checks the
 * kind first; the main process checks it again (and the device itself, and
 * Simple Mode) before anything runs. A device never changes the library,
 * the sound, the stream, conversions, imports, backups, the network's
 * settings or Simple Mode: none of those are here. (Session 54: a Remote adds
 * a file of its own while "Phones and tablets may add files" is on, imported
 * as a dropped file is, and never live by itself; and, the phone as a full
 * Drashti, sets up the computer's screens as Screens does, below.)
 */
export const DEVICE_OPS = {
  /** Who this device is. */
  me: ['remote', 'stage', 'announcements'],
  /** A short summary of what is on the screens. */
  status: ['remote', 'stage'],
  /** The whole engine state, with its revision. */
  state: ['remote', 'stage'],
  /**
   * The stage display's screen group (the first stage group) and its languages in the live Look, and the hall's
   * picture for a layout's audience picture box (Session 51).
   */
  stage: ['stage'],
  /**
   * The hall's screen group (the first audience group), whose live Look the remote's picture follows, and how
   * Drashti's computer writes the time (Sessions 31–36, SLD-6).
   */
  hall: ['remote'],
  /** The Looks, in order, and which is live. */
  looks: ['remote'],
  /** Play the audio playlist: on from where it was paused, or the one played last (Session 14). */
  'music.play': ['remote'],
  /** The loaded Shastra texts: name, abbreviation, how many items (Session 12). */
  'shastra.texts': ['remote'],
  /** Put up a Shastra passage by its reference ("SD 14", "Vach G.Pr. 1", "SD 14-16"). */
  shastra: ['remote'],
  playlists: ['remote'],
  /** A playlist's items. */
  items: ['remote'],
  /** A presentation's slides, groups and arrangements (as the operator window reads them). */
  presentation: ['remote'],
  /** The library's presentations by name, a page at a time (Session 18: the presenter's remote). */
  presentations: ['remote'],
  /** The library searched as the operator window searches it: titles, a kirtan's details, slide words. */
  search: ['remote'],
  /** Message templates and their fields. */
  messages: ['remote'],
  timers: ['remote'],
  /** Whether a logo is marked (Logo shows it). */
  logo: ['remote'],
  /** An engine command that runs the show (only the kinds in REMOTE_COMMANDS). */
  command: ['remote'],
  /** Show or hide the marked logo. */
  'logo.set': ['remote'],
  /** Fill a message template's fields and show it, or take a message off. */
  'message.show': ['remote'],
  'message.hide': ['remote'],
  /**
   * A small picture of a media item for a thumbnail, and for the pictures a page draws: the remote's live picture,
   * and a stage display's audience picture box (Session 51).
   */
  preview: ['remote', 'stage'],
  /**
   * Full quality (Session 54, D1): a picture, or a video's frame, at the width the device draws it, up to the
   * original (`GET /api/v1/media/{id}/picture?width=…`): a Stage device's picture box, as its previews were.
   */
  'media.picture': ['remote', 'stage'],
  /**
   * A picture's or video's own file, in pieces as it plays (HTTP Range), and a link to it a <video> can play
   * (Session 54, D1); a sound's only while a playlist shared with phones has it (D3), never another sound's.
   */
  'media.original': ['remote'],
  /** Send an announcement for the operator to approve. */
  announce: ['announcements'],
  /** What became of an announcement this device sent. */
  announcement: ['announcements'],
  // The mirror of the operator window (Session 54, D5: shared/network-mirror.ts), read and put up, never changed.
  /** The keys the operator window answers now, so the phone's clears name them. */
  keys: ['remote'],
  /** The library's props by name, the logo marked. */
  props: ['remote'],
  /** Put a prop up by its id (the main process reads it from the library). */
  'prop.show': ['remote'],
  /** The library's masks, and one put up by its id as Masks does (Session 54, the phone as a full Drashti). */
  masks: ['remote'],
  'mask.show': ['remote'],
  /** The library's pictures, videos and sounds by name, a page at a time. */
  media: ['remote'],
  /** Put one up by its id: a picture or video as the background (the slide taken off), a sound played. */
  'media.show': ['remote'],
  /** The lower thirds. */
  lowerThirds: ['remote'],
  /** Put a lower third up by its id. */
  'lowerThird.show': ['remote'],
  /** The audio playlists by name (Play starts one: music.play). */
  music: ['remote'],
  /**
   * Repeat Slides going round (Session 26d), from its first step, a step given, or an item's first step, which the
   * main process finds as the window does (Session 54, D5 review).
   */
  'repeat.start': ['remote'],
  /**
   * Session 54 (shared/phone-files.ts): the playlists shared with phones, and a shared one's items, to view and
   * play on the device (read-only); and files a phone adds, while the switch is on: its own files and how each
   * stands, a new one, its pieces, and Cancel. Never a Stage or Announcements device.
   */
  shared: ['remote'],
  'shared.items': ['remote'],
  uploads: ['remote'],
  upload: ['remote'],
  'upload.status': ['remote'],
  'upload.piece': ['remote'],
  'upload.cancel': ['remote'],
  /**
   * The phone as a full Drashti (Session 54, the owner's item 3: shared/network-desktop.ts): the computer's own
   * screens set up as Screens does (its displays chosen by their ids), Keep these screens? answered, and Audience
   * and Stage turned. Each as the window's own request does it, Simple Mode's refusals too; an output a phone would
   * put over the controls is asked of the computer itself. Never a Stage or Announcements device.
   */
  screens: ['remote'],
  'screens.addGroup': ['remote'],
  'screens.renameGroup': ['remote'],
  'screens.groupRole': ['remote'],
  'screens.deleteGroup': ['remote'],
  'screens.useDisplay': ['remote'],
  'screens.change': ['remote'],
  'screens.remove': ['remote'],
  'screens.keep': ['remote'],
  'screens.goBack': ['remote'],
  'screens.identify': ['remote'],
  switch: ['remote'],
  /**
   * Media's video inputs (named, changed, removed; put up with the command showInput) and Show a Window… (the other
   * apps' windows by name, one put up by its id in that list), Pro Mode's as in the window (Session 54).
   */
  inputs: ['remote'],
  'input.add': ['remote'],
  'input.change': ['remote'],
  'input.remove': ['remote'],
  windows: ['remote'],
  'window.show': ['remote'],
  /**
   * The library's changes (Session 54), as the window makes them: a presentation from words, presentations and
   * playlists deleted and put back (the phone's Undo), a playlist made or renamed, items added from the library (by
   * id), moved, taken out and put back. Simple Mode refuses them, as in the window.
   */
  'library.new': ['remote'],
  'library.remove': ['remote'],
  'library.restore': ['remote'],
  'playlist.new': ['remote'],
  'playlist.rename': ['remote'],
  'playlist.remove': ['remote'],
  'playlist.restore': ['remote'],
  'playlist.add': ['remote'],
  'playlist.move': ['remote'],
  'playlist.removeItems': ['remote'],
  'playlist.restoreItems': ['remote'],
  /**
   * MIDI (Session 54): the controller's settings, its device chosen among those the computer's window lists, a
   * mapping forgotten, and the window asked to learn the next press at the computer. Simple Mode refuses the changes.
   */
  midi: ['remote'],
  'midi.device': ['remote'],
  'midi.forget': ['remote'],
  'midi.learn': ['remote'],
  /**
   * The announcements' queue (Session 54): what waits and what shows, each approved (in the ticker or as a message),
   * rejected or taken off, as the window's Announcements does. Never the poster's device: it only sends.
   */
  queue: ['remote'],
  'queue.approve': ['remote'],
  'queue.reject': ['remote'],
  'queue.takeOff': ['remote'],
} as const satisfies Record<string, readonly DeviceKind[]>;

export type DeviceOp = keyof typeof DEVICE_OPS;

export const isDeviceOp = (op: string): op is DeviceOp => Object.hasOwn(DEVICE_OPS, op);

export const deviceMay = (kind: DeviceKind, op: DeviceOp): boolean =>
  (DEVICE_OPS[op] as readonly DeviceKind[]).includes(kind);

/**
 * The engine commands a Remote may send: running the show, as the operator
 * window does, and switching the Look. Not setting backgrounds, sounds,
 * props or masks from what it sends (a prop, a picture or a sound goes up by
 * its id, read from the library: DEVICE_OPS), and never anything that
 * changes the library. Since Session 54 (D5) the stage message too.
 */
export const REMOTE_COMMANDS = [
  'goLive',
  'playItem',
  'next',
  'previous',
  'back',
  'nextItem',
  'previousItem',
  'clearLayer',
  'clearAll',
  'putBack',
  'setBlackout',
  'toggleBlackout',
  'startTimer',
  'pauseTimer',
  'resetTimer',
  // Switching the live Look (Simple Mode refuses it, as in the window).
  'setLook',
  // The audio playlist (Session 14): pause, play on, the next or previous track.
  'pauseMusic',
  'resumeMusic',
  'musicNext',
  'musicPrevious',
  // A jump to a marker of the background video or the sound playing (Session 14).
  'jumpToMarker',
  // Repeat Slides (Session 26d): start one going round, and stop it (its slide staying up).
  'startRepeat',
  'stopRepeat',
  // Picture in picture (Session 50): Take off only; setting one up, Swap and moving it are the operator's.
  'hidePip',
  // The mirror of the operator window (Session 54, D5): a prop and a lower third taken off, a timer alone on the
  // screens, the stage message, Back 15 s, Forward 15 s and Last 10 s, and the idle rotation started and stopped.
  'hideProp',
  'hideLowerThird',
  'showTimer',
  'setStageMessage',
  'clearStageMessage',
  'skip',
  'startIdle',
  'stopIdle',
  // The time bar (Session 54): what plays moved, paused or played on, as under LIVE (Simple Mode refuses the move).
  'moveTo',
  'pausePlaying',
  'resumePlaying',
  // The live zoom (Session 54, D2): the zoom of the picture a phone looks at, put on the screens, and Back to Whole
  // (Simple Mode refuses both, as in the window).
  'zoomLive',
  'resetLiveZoom',
  // A video input up as the background, by its id in this computer's list (Session 54, the phone as a full Drashti:
  // Media's click), Pro Mode's (the engine refuses it in Simple Mode).
  'showInput',
  // The picture-in-picture box's setup (Session 54, the phone as a full Drashti): what it holds (by its id: an input
  // in this computer's list, a Media file, a window in the list just offered, or the slides), Swap and its place, as
  // Picture in Picture… does; Pro Mode's (the engine refuses them in Simple Mode). Take off is hidePip, above.
  'showPip',
  'swapPip',
  'placePip',
] as const;

/** A presentation as a Remote lists the library (Session 18): no files, nothing to change it with. */
export interface RemotePresentation {
  id: string;
  name: string;
  libraryName: string;
  slideCount: number;
  /** A kirtan's category, or null (not a kirtan, or none set). */
  category: string | null;
}

/** One page of the library for a Remote: the presentations from `offset`, and how many there are. */
export interface RemoteLibraryPage {
  presentations: RemotePresentation[];
  offset: number;
  total: number;
}

/** How many presentations a Remote gets at once, unless it asks for fewer (and the most it may). */
export const REMOTE_LIBRARY_PAGE = 100;
export const REMOTE_LIBRARY_MAX = 200;

/** A request from the network server to the main process, for a paired device. */
export interface DeviceRequest {
  deviceId: string;
  op: DeviceOp;
  args: unknown;
  /** The address it came from (for the limit on announcements waiting from one phone; never logged). */
  address: string;
}

/** The main process's answer: an HTTP status and a JSON body. */
export interface DeviceAnswer {
  status: number;
  body: unknown;
}

/** What pairing answers: the new device's token (shown to it once), or why not. */
export type PairAnswer =
  | {
      ok: true;
      token: string;
      device: { id: string; name: string; kind: DeviceKind; tokenHash: string };
    }
  | { ok: false; status: number; message: string };

/** A device as the network server knows it: enough to check its token. */
export interface DeviceAuth {
  id: string;
  name: string;
  kind: DeviceKind;
  tokenHash: string;
}
