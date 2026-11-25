import { describe, expect, it } from 'vitest';
import { engineCommandSchema } from './engine/commands';
import { DEVICE_OPS, type DeviceOp } from './network-api';
import {
  NEVER_COMMAND_WORDS,
  NEVER_OP_WORDS,
  PHONE_REFUSAL,
  phoneCommandRefusal,
  phoneOpRefusal,
  REMOTE_PHONE_COMMANDS,
  REMOTE_PHONE_OPS,
} from './phone-rule';

/*
 * What a phone (a Remote device) may ask for in alpha.23 (QA23-PHONE-1, the owner's words: "no video access in either
 * of simple or pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple mode
 * only show the flow, whats running in live, and chat. pro contains more features than simple", then "Only PPT and
 * PDF"): every request and every engine command has a decision, and each refusal its plain words.
 */

const OPS = Object.keys(DEVICE_OPS) as DeviceOp[];
const COMMAND_TYPES = engineCommandSchema.options.map((o) => o.shape.type.value);

const withRule = (rule: string) =>
  OPS.filter((op) => REMOTE_PHONE_OPS[op] === rule).sort((a, b) => a.localeCompare(b));

describe('the phone rule (QA23-PHONE-1)', () => {
  it('decides every request a device can make, and nothing else', () => {
    expect(Object.keys(REMOTE_PHONE_OPS).sort()).toEqual([...OPS].sort());
  });

  it('lets both modes read only what is live: who it is, the status, the state, the hall, previews and pictures', () => {
    expect(withRule('both')).toEqual(
      ['hall', 'me', 'media.picture', 'preview', 'state', 'status'].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('gives Pro Mode the playlists, a playlist’s rows, a presentation and the deck commands; no library sheet', () => {
    expect(withRule('pro')).toEqual(['command', 'items', 'playlists', 'presentation']);
    // The owner's Q2 not answered yet: the library sheet stays off (the playlist only).
    expect(REMOTE_PHONE_OPS.presentations).toBe('never');
    expect(REMOTE_PHONE_OPS.search).toBe('never');
  });

  it('never lets a phone near videos, pictures, sounds, files, timers, messages, screens or the library', () => {
    for (const op of [
      'media',
      'media.show',
      'media.original',
      'media.look',
      'media.setLook',
      'media.rename',
      'music',
      'music.play',
      'music.audio',
      'music.addTracks',
      'wallpapers',
      'wallpaper.choose',
      'shared',
      'shared.items',
      'uploads',
      'upload',
      'upload.piece',
      'upload.status',
      'upload.cancel',
      'timers',
      'messages',
      'message.show',
      'message.hide',
      'lowerThirds',
      'lowerThird.show',
      'stage.layouts',
      'stage.layout',
      'queue',
      'queue.approve',
      'screens',
      'screens.change',
      'switch',
      'inputs',
      'input.add',
      'windows',
      'window.show',
      'midi',
      'midi.learn',
      'library.new',
      'library.remove',
      'playlist.new',
      'playlist.add',
      'playlist.whenEnds',
      'presentation.rename',
      'quickBar',
      'quickBar.set',
      'keys',
      'repeat.start',
      'shastra',
      'shastra.texts',
    ] as const satisfies readonly DeviceOp[])
      expect(REMOTE_PHONE_OPS[op], op).toBe('never');
  });

  it('decides every engine command: only goLive, playItem, Next, Previous, Back and Clear slide, each for a deck', () => {
    expect(Object.keys(REMOTE_PHONE_COMMANDS).sort()).toEqual([...COMMAND_TYPES].sort());
    // The owner's Q7: a Pro phone clears the slide only (clearLayer of the slide layer, while a deck is live).
    expect(
      COMMAND_TYPES.filter((t) => REMOTE_PHONE_COMMANDS[t] === 'deck').sort((a, b) => a.localeCompare(b)),
    ).toEqual(['back', 'clearLayer', 'goLive', 'next', 'playItem', 'previous']);
  });

  it('says each refusal in plain words: one set for each group', () => {
    expect(PHONE_REFUSAL).toEqual({
      simple:
        'Simple Mode is on at Drashti’s computer: this phone shows the Sabha flow, what is on the screens and the chat. Run the show on the computer.',
      notDeck: 'From a phone, only a PowerPoint or a PDF goes up. Put this up on the computer.',
      noDeck: 'No PowerPoint or PDF is on the screens: put one up from the playlist first.',
      media: 'A phone cannot play, put up or change videos, pictures or sounds. Use Drashti’s computer.',
      files: 'Phones cannot add or share files with Drashti.',
      computer: 'A phone cannot change this. Use Drashti’s computer.',
    });
    // Every request and command refused has its group's words.
    for (const op of OPS)
      if (REMOTE_PHONE_OPS[op] === 'never') expect(Object.hasOwn(NEVER_OP_WORDS, op), op).toBe(true);
    for (const type of COMMAND_TYPES)
      if (REMOTE_PHONE_COMMANDS[type] === 'never')
        expect(Object.hasOwn(NEVER_COMMAND_WORDS, type), type).toBe(true);
  });

  it('refuses a request by its group, the same words in both modes; Pro Mode’s own in Simple Mode', () => {
    const cases: [DeviceOp, keyof typeof PHONE_REFUSAL][] = [
      ['media.original', 'media'],
      ['media.show', 'media'],
      ['music.play', 'media'],
      ['wallpaper.choose', 'media'],
      ['upload', 'files'],
      ['upload.piece', 'files'],
      ['shared', 'files'],
      ['timers', 'computer'],
      ['message.show', 'computer'],
      ['lowerThird.show', 'computer'],
      ['queue.approve', 'computer'],
      ['screens.change', 'computer'],
      ['midi.learn', 'computer'],
      ['library.new', 'computer'],
      ['playlist.add', 'computer'],
      ['shastra', 'notDeck'],
      ['repeat.start', 'notDeck'],
      ['presentations', 'notDeck'],
    ];
    for (const [op, words] of cases)
      for (const simple of [false, true]) expect(phoneOpRefusal(op, simple), op).toBe(PHONE_REFUSAL[words]);
    for (const op of ['me', 'status', 'state', 'hall', 'preview', 'media.picture'] as const) {
      expect(phoneOpRefusal(op, false), op).toBeNull();
      expect(phoneOpRefusal(op, true), op).toBeNull();
    }
    for (const op of ['playlists', 'items', 'presentation', 'command'] as const) {
      expect(phoneOpRefusal(op, false), op).toBeNull();
      expect(phoneOpRefusal(op, true), op).toBe(PHONE_REFUSAL.simple);
    }
  });

  it('refuses every command but the deck ones, by its group', () => {
    expect(phoneCommandRefusal('next')).toBeNull();
    expect(phoneCommandRefusal('goLive')).toBeNull();
    expect(phoneCommandRefusal('pauseMusic')).toBe(PHONE_REFUSAL.media);
    expect(phoneCommandRefusal('moveTo')).toBe(PHONE_REFUSAL.media);
    expect(phoneCommandRefusal('jumpToMarker')).toBe(PHONE_REFUSAL.media);
    // The owner's Q8: Look closer is the phone's own view: never a zoom on the screens, nor back to whole.
    expect(phoneCommandRefusal('zoomLive')).toBe(PHONE_REFUSAL.media);
    expect(phoneCommandRefusal('resetLiveZoom')).toBe(PHONE_REFUSAL.media);
    expect(phoneCommandRefusal('clearLayer')).toBeNull();
    expect(phoneCommandRefusal('setWallpaper')).toBe(PHONE_REFUSAL.media);
    expect(phoneCommandRefusal('startTimer')).toBe(PHONE_REFUSAL.computer);
    expect(phoneCommandRefusal('setStageMessage')).toBe(PHONE_REFUSAL.computer);
    expect(phoneCommandRefusal('clearAll')).toBe(PHONE_REFUSAL.computer);
    expect(phoneCommandRefusal('toggleBlackout')).toBe(PHONE_REFUSAL.computer);
    expect(phoneCommandRefusal('showPip')).toBe(PHONE_REFUSAL.computer);
    expect(phoneCommandRefusal('nextItem')).toBe(PHONE_REFUSAL.notDeck);
    expect(phoneCommandRefusal('startRepeat')).toBe(PHONE_REFUSAL.notDeck);
  });
});
