import type { EngineCommandType } from './engine/commands';
import type { DeviceOp } from './network-api';

/*
 * What a phone may do (alpha.23, QA23-PHONE-1). The owner's words: "no video access in either of simple or pro mode in
 * phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple mode only show the flow, whats
 * running in live, and chat. pro contains more features than simple", then "Only PPT and PDF".
 *
 * Every Remote device's request is weighed here (a phone's page, Companion, a Stream Deck or a script with a Remote
 * token alike: Q1's default), twice: by the network's own process before it reads a request's body or answers it
 * itself (server.ts: the 'never' rows, as it cannot tell the modes apart), and by the main process before anything
 * runs (network-service.ts checked(): 'never' in both modes, 'pro' in Pro Mode only, then the deck checks of a command).
 * Stage and Announcements devices, OSC and the paired controller (runShowAction) are not phones: none of this applies.
 * The Simple Mode table (main/simple-mode-phones.ts) still applies after this, as before.
 */

/** In both modes, in Pro Mode only, or never from a phone. */
export type PhoneRule = 'both' | 'pro' | 'never';

/** What a phone is told when it may not (403, {ok: false, message}), by group. */
export const PHONE_REFUSAL = {
  /** Simple Mode: anything that controls the show. */
  simple:
    'Simple Mode is on at Drashti’s computer: this phone shows the Sabha flow, what is on the screens and the chat. Run the show on the computer.',
  /** Pro Mode: a presentation that is not a PowerPoint or a PDF, a kirtan's, a passage's or Repeat Slides'. */
  notDeck: 'From a phone, only a PowerPoint or a PDF goes up. Put this up on the computer.',
  /** Pro Mode: Next or Back with no PowerPoint or PDF up. */
  noDeck: 'No PowerPoint or PDF is on the screens: put one up from the playlist first.',
  /** Videos, pictures, sounds and music, and the wallpapers. */
  media: 'A phone cannot play, put up or change videos, pictures or sounds. Use Drashti’s computer.',
  /** Files from phones, and the playlists shared with them. */
  files: 'Phones cannot add or share files with Drashti.',
  /** Timers, messages, the stage, the announcements' queue, the screens and the library's set-up. */
  computer: 'A phone cannot change this. Use Drashti’s computer.',
} as const;

export type PhoneWords = keyof typeof PHONE_REFUSAL;

/**
 * Every request a device can make, as a phone may make it (the typecheck makes each new request decide). A request
 * a Remote never makes (a Stage or Announcements device's) is 'never' too: its kind is refused first anyway.
 */
export const REMOTE_PHONE_OPS = {
  // What is live, in both modes: who it is, where the show is, the hall's picture, previews and full-quality pictures.
  me: 'both',
  status: 'both',
  state: 'both',
  hall: 'both',
  preview: 'both',
  'media.picture': 'both',
  // The chat (s59-a22-chat) and the Sabha flow (s59-a22-flow), in both modes (the owner: "in simple mode only show the
  // flow, whats running in live, and chat"): reading and writing the chat, reading the flow and its pages.
  chat: 'both',
  'chat.name': 'both',
  'chat.send': 'both',
  flow: 'both',
  'flow.page': 'both',

  // Pro Mode: a playlist's PowerPoint and PDF rows, a presentation's slides (as JSON: never a click's picture, which
  // checked() refuses), and the deck commands (REMOTE_PHONE_COMMANDS).
  playlists: 'pro',
  items: 'pro',
  presentation: 'pro',
  command: 'pro',
  // The library sheet (Q2: not answered; the playlist only for now).
  presentations: 'never',
  search: 'never',
  // Never: another kind's.
  stage: 'never',
  announce: 'never',
  announcement: 'never',
  // Never: videos, pictures, sounds and music.
  'music.play': 'never',
  'music.audio': 'never',
  'music.new': 'never',
  'music.rename': 'never',
  'music.remove': 'never',
  'music.restore': 'never',
  'music.options': 'never',
  'music.addTracks': 'never',
  'music.moveTrack': 'never',
  'music.removeTrack': 'never',
  'music.restoreTrack': 'never',
  'music.stepsAside': 'never',
  music: 'never',
  media: 'never',
  'media.show': 'never',
  'media.original': 'never',
  'media.look': 'never',
  'media.setLook': 'never',
  'media.rename': 'never',
  wallpapers: 'never',
  'wallpaper.choose': 'never',
  'wallpaper.rename': 'never',
  'wallpaper.remove': 'never',
  'wallpaper.restore': 'never',
  // Never: slides that are not a PowerPoint or a PDF.
  'shastra.texts': 'never',
  shastra: 'never',
  'repeat.start': 'never',
  // Never: files from phones and the playlists shared with them.
  shared: 'never',
  'shared.items': 'never',
  uploads: 'never',
  upload: 'never',
  'upload.status': 'never',
  'upload.piece': 'never',
  'upload.cancel': 'never',
  // Never: timers, messages, lower thirds, the stage, the announcements' queue.
  messages: 'never',
  timers: 'never',
  'message.show': 'never',
  'message.hide': 'never',
  keys: 'never',
  lowerThirds: 'never',
  'lowerThird.show': 'never',
  queue: 'never',
  'queue.approve': 'never',
  'queue.reject': 'never',
  'queue.takeOff': 'never',
  'stage.layouts': 'never',
  'stage.layout': 'never',
  // Never: the screens, inputs, windows and MIDI.
  screens: 'never',
  'screens.addGroup': 'never',
  'screens.renameGroup': 'never',
  'screens.groupRole': 'never',
  'screens.deleteGroup': 'never',
  'screens.useDisplay': 'never',
  'screens.change': 'never',
  'screens.displayJob': 'never',
  'screens.remove': 'never',
  'screens.keep': 'never',
  'screens.goBack': 'never',
  'screens.identify': 'never',
  switch: 'never',
  inputs: 'never',
  'input.add': 'never',
  'input.change': 'never',
  'input.remove': 'never',
  windows: 'never',
  'window.show': 'never',
  midi: 'never',
  'midi.device': 'never',
  'midi.forget': 'never',
  'midi.learn': 'never',
  // Never: the library's and playlists' changes, and the quick bar.
  'library.new': 'never',
  'library.remove': 'never',
  'library.restore': 'never',
  'playlist.new': 'never',
  'playlist.rename': 'never',
  'playlist.remove': 'never',
  'playlist.restore': 'never',
  'playlist.add': 'never',
  'playlist.move': 'never',
  'playlist.removeItems': 'never',
  'playlist.restoreItems': 'never',
  'playlist.whenEnds': 'never',
  'presentation.rename': 'never',
  quickBar: 'never',
  'quickBar.set': 'never',
} as const satisfies Record<DeviceOp, PhoneRule>;

type NeverOp = {
  [K in DeviceOp]: (typeof REMOTE_PHONE_OPS)[K] extends 'never' ? K : never;
}[DeviceOp];

/** The words for each request a phone never makes (the typecheck makes each say which). */
export const NEVER_OP_WORDS: Readonly<Record<NeverOp, PhoneWords>> = {
  presentations: 'notDeck',
  search: 'notDeck',
  stage: 'computer',
  announce: 'computer',
  announcement: 'computer',
  'music.play': 'media',
  'music.audio': 'media',
  'music.new': 'media',
  'music.rename': 'media',
  'music.remove': 'media',
  'music.restore': 'media',
  'music.options': 'media',
  'music.addTracks': 'media',
  'music.moveTrack': 'media',
  'music.removeTrack': 'media',
  'music.restoreTrack': 'media',
  'music.stepsAside': 'media',
  music: 'media',
  media: 'media',
  'media.show': 'media',
  'media.original': 'media',
  'media.look': 'media',
  'media.setLook': 'media',
  'media.rename': 'media',
  wallpapers: 'media',
  'wallpaper.choose': 'media',
  'wallpaper.rename': 'media',
  'wallpaper.remove': 'media',
  'wallpaper.restore': 'media',
  'shastra.texts': 'notDeck',
  shastra: 'notDeck',
  'repeat.start': 'notDeck',
  shared: 'files',
  'shared.items': 'files',
  uploads: 'files',
  upload: 'files',
  'upload.status': 'files',
  'upload.piece': 'files',
  'upload.cancel': 'files',
  messages: 'computer',
  timers: 'computer',
  'message.show': 'computer',
  'message.hide': 'computer',
  keys: 'computer',
  lowerThirds: 'computer',
  'lowerThird.show': 'computer',
  queue: 'computer',
  'queue.approve': 'computer',
  'queue.reject': 'computer',
  'queue.takeOff': 'computer',
  'stage.layouts': 'computer',
  'stage.layout': 'computer',
  screens: 'computer',
  'screens.addGroup': 'computer',
  'screens.renameGroup': 'computer',
  'screens.groupRole': 'computer',
  'screens.deleteGroup': 'computer',
  'screens.useDisplay': 'computer',
  'screens.change': 'computer',
  'screens.displayJob': 'computer',
  'screens.remove': 'computer',
  'screens.keep': 'computer',
  'screens.goBack': 'computer',
  'screens.identify': 'computer',
  switch: 'computer',
  inputs: 'computer',
  'input.add': 'computer',
  'input.change': 'computer',
  'input.remove': 'computer',
  windows: 'computer',
  'window.show': 'computer',
  midi: 'computer',
  'midi.device': 'computer',
  'midi.forget': 'computer',
  'midi.learn': 'computer',
  'library.new': 'computer',
  'library.remove': 'computer',
  'library.restore': 'computer',
  'playlist.new': 'computer',
  'playlist.rename': 'computer',
  'playlist.remove': 'computer',
  'playlist.restore': 'computer',
  'playlist.add': 'computer',
  'playlist.move': 'computer',
  'playlist.removeItems': 'computer',
  'playlist.restoreItems': 'computer',
  'playlist.whenEnds': 'computer',
  'presentation.rename': 'computer',
  quickBar: 'computer',
  'quickBar.set': 'computer',
};

/**
 * Every engine command, as a phone may send it in Pro Mode: 'deck' only for a PowerPoint or a PDF (main/network
 * checks which: the row or presentation put up is a deck; Next, Back and Clear slide only while one is live, Next and
 * Back inside it, Clear the slide layer alone), else never.
 */
export const REMOTE_PHONE_COMMANDS = {
  goLive: 'deck',
  playItem: 'deck',
  next: 'deck',
  previous: 'deck',
  back: 'deck',
  // Clear slide (the owner's Q7): the slide layer only, while a PowerPoint or a PDF is live.
  clearLayer: 'deck',
  // Videos, pictures and sounds, and the picture's zoom (the owner's Q8: Look closer is the phone's own view).
  cueVideo: 'never',
  goVideoCue: 'never',
  cancelVideoCue: 'never',
  setBackground: 'never',
  playAudio: 'never',
  playMusic: 'never',
  pauseMusic: 'never',
  resumeMusic: 'never',
  musicNext: 'never',
  musicPrevious: 'never',
  setMusicLoop: 'never',
  jumpToMarker: 'never',
  skip: 'never',
  moveTo: 'never',
  pausePlaying: 'never',
  resumePlaying: 'never',
  repeatAb: 'never',
  stopAb: 'never',
  stepFrame: 'never',
  zoomLive: 'never',
  resetLiveZoom: 'never',
  setWallpaper: 'never',
  toggleWallpaper: 'never',
  // Slides that are not a deck's, and the playlist's other rows.
  nextItem: 'never',
  previousItem: 'never',
  startRepeat: 'never',
  stopRepeat: 'never',
  cueNext: 'never',
  clearCue: 'never',
  playCue: 'never',
  // The other clears, covers, timers, messages, the stage, inputs and PIP.
  clearAll: 'never',
  putBack: 'never',
  oops: 'never',
  setBlackout: 'never',
  toggleBlackout: 'never',
  setTranslationHidden: 'never',
  showInput: 'never',
  toggleInput: 'never',
  showMessage: 'never',
  hideMessage: 'never',
  showLowerThird: 'never',
  hideLowerThird: 'never',
  startTimer: 'never',
  pauseTimer: 'never',
  resetTimer: 'never',
  setStageMessage: 'never',
  clearStageMessage: 'never',
  setStageColours: 'never',
  showTimer: 'never',
  showAudienceTimer: 'never',
  hideAudienceTimer: 'never',
  showPip: 'never',
  hidePip: 'never',
  swapPip: 'never',
  placePip: 'never',
} as const satisfies Record<EngineCommandType, 'deck' | 'never'>;

type NeverCommand = {
  [K in EngineCommandType]: (typeof REMOTE_PHONE_COMMANDS)[K] extends 'never' ? K : never;
}[EngineCommandType];

/** The words for each command a phone never sends (the typecheck makes each say which). */
export const NEVER_COMMAND_WORDS: Readonly<Record<NeverCommand, PhoneWords>> = {
  cueVideo: 'media',
  goVideoCue: 'media',
  cancelVideoCue: 'media',
  setBackground: 'media',
  playAudio: 'media',
  playMusic: 'media',
  pauseMusic: 'media',
  resumeMusic: 'media',
  musicNext: 'media',
  musicPrevious: 'media',
  setMusicLoop: 'media',
  jumpToMarker: 'media',
  skip: 'media',
  moveTo: 'media',
  pausePlaying: 'media',
  resumePlaying: 'media',
  repeatAb: 'media',
  stopAb: 'media',
  stepFrame: 'media',
  zoomLive: 'media',
  resetLiveZoom: 'media',
  setWallpaper: 'media',
  toggleWallpaper: 'media',
  nextItem: 'notDeck',
  previousItem: 'notDeck',
  startRepeat: 'notDeck',
  stopRepeat: 'notDeck',
  cueNext: 'notDeck',
  clearCue: 'notDeck',
  playCue: 'notDeck',
  clearAll: 'computer',
  putBack: 'computer',
  oops: 'computer',
  setBlackout: 'computer',
  toggleBlackout: 'computer',
  setTranslationHidden: 'computer',
  showInput: 'computer',
  toggleInput: 'computer',
  showMessage: 'computer',
  hideMessage: 'computer',
  showLowerThird: 'computer',
  hideLowerThird: 'computer',
  startTimer: 'computer',
  pauseTimer: 'computer',
  resetTimer: 'computer',
  setStageMessage: 'computer',
  clearStageMessage: 'computer',
  setStageColours: 'computer',
  showTimer: 'computer',
  showAudienceTimer: 'computer',
  hideAudienceTimer: 'computer',
  showPip: 'computer',
  hidePip: 'computer',
  swapPip: 'computer',
  placePip: 'computer',
};

const isNeverOp = (op: DeviceOp): op is NeverOp => REMOTE_PHONE_OPS[op] === 'never';
const isNeverCommand = (type: EngineCommandType): type is NeverCommand =>
  REMOTE_PHONE_COMMANDS[type] === 'never';

/**
 * Why a phone may not make this request, or null when it may: a 'never' request in either mode, in its group's
 * words; a Pro Mode one while Simple Mode is on (`simple`), in Simple Mode's. The network's own process asks with
 * `simple` false (it cannot tell the modes apart): the main process weighs Simple Mode after it.
 */
export function phoneOpRefusal(op: DeviceOp, simple: boolean): string | null {
  if (isNeverOp(op)) return PHONE_REFUSAL[NEVER_OP_WORDS[op]];
  return simple && REMOTE_PHONE_OPS[op] === 'pro' ? PHONE_REFUSAL.simple : null;
}

/** Why a phone may not send this engine command, or null for a deck's (whose checks the main process makes). */
export function phoneCommandRefusal(type: EngineCommandType): string | null {
  return isNeverCommand(type) ? PHONE_REFUSAL[NEVER_COMMAND_WORDS[type]] : null;
}
