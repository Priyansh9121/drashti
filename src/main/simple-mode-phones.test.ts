import { describe, expect, it } from 'vitest';
import { type EngineCommand, engineCommandSchema } from '../shared/engine/commands';
import { LAYER_NAMES } from '../shared/engine/state';
import { DEVICE_OPS, type DeviceOp, REMOTE_COMMANDS } from '../shared/network-api';
import { SIMPLE_MODE_REFUSED_COMMANDS } from '../shared/mode';
import { repeatPresentationId } from '../shared/repeat';
import { OP_CHANNEL, WINDOW_ARGS } from './network/network-service';
import {
  COMMANDS_IN_SIMPLE_MODE,
  PHONE_OPS_IN_SIMPLE_MODE,
  phoneCommandInSimpleMode,
  phoneMayInSimpleMode,
  type SimplePhoneScope,
} from './simple-mode-phones';
import { SIMPLE_MODE_LOCKED, simpleModeRefusesWhole } from './simple-mode';

/*
 * A paired phone in Simple Mode (Session 55, the owner's answer of 30 Oct 2026): it may do only what Simple Mode's
 * window does, the rest refused in the main process. Every request a device can make and every engine command is
 * weighed here; network-service.test.ts and mirror-ops.test.ts check the refusals' words and that nothing runs.
 * Placeholder ids only.
 */

/** Simple Mode's one playlist: a talk, a Shastra passage and a picture; another playlist has a kirtan. */
const ROWS: Record<string, { playlist: string; presentation?: string; media?: string; removed?: boolean }> = {
  'one-talk': { playlist: 'one', presentation: 'talk' },
  'one-passage': { playlist: 'one', presentation: 'shastra:pg#14' },
  'one-picture': { playlist: 'one', media: 'picture' },
  'other-kirtan': { playlist: 'other', presentation: 'kirtan' },
  'template-row': { playlist: 'template', presentation: 'template-only' },
  'removed-row': { playlist: 'one', presentation: 'removed', removed: true },
};

function scope(playlistId: string | null = 'one'): SimplePhoneScope {
  const rows = Object.values(ROWS).filter((r) => r.playlist === playlistId);
  const activePlaylist = (id: string) => id === 'one' || id === 'other';
  return {
    playlistId,
    kindOf: (id: string) =>
      activePlaylist(id) ? ('playlist' as const) : id === 'template' ? ('template' as const) : null,
    activePlaylist,
    activeItem: (id: string, itemId: string) => ROWS[itemId]?.playlist === id && !ROWS[itemId].removed,
    listsMedia: (mediaId: string) =>
      Object.values(ROWS).some((r) => activePlaylist(r.playlist) && !r.removed && r.media === mediaId),
    listsPresentation: (id: string) =>
      Object.values(ROWS).some((r) => activePlaylist(r.playlist) && !r.removed && r.presentation === id),
    playlistOf: (itemId) => ROWS[itemId]?.playlist ?? null,
    holdsMedia: (mediaId) => rows.some((r) => r.media === mediaId),
    holdsPresentation: (id) => rows.some((r) => r.presentation === id && !id.startsWith('shastra:')),
    plays: (id: string, from?: { playlistId: string; itemId: string }) =>
      (from ? [ROWS[from.itemId]] : Object.values(ROWS)).some(
        (r) =>
          r !== undefined &&
          !r.removed &&
          activePlaylist(r.playlist) &&
          (from === undefined || r.playlist === from.playlistId) &&
          r.presentation === id,
      ),
    refusal: () => 'Simple Mode on Drashti’s computer: placeholder words.',
  };
}

/** Every engine command's type, as the engine's schema has them. */
const COMMAND_TYPES = engineCommandSchema.options.map((o) => o.shape.type.value);

const may = (command: Record<string, unknown>, within: SimplePhoneScope = scope()) =>
  phoneCommandInSimpleMode(command as EngineCommand, within);
const mayOp = (op: string, args: Record<string, unknown> = {}) => phoneMayInSimpleMode(op, args, scope());

describe('a paired phone in Simple Mode (Session 55, the owner’s answer of 30 Oct 2026)', () => {
  it('has every request a device can make and every engine command in its list, so none is left unsaid', () => {
    expect(Object.keys(PHONE_OPS_IN_SIMPLE_MODE).sort()).toEqual(Object.keys(DEVICE_OPS).sort());
    expect(Object.keys(COMMANDS_IN_SIMPLE_MODE).sort()).toEqual([...COMMAND_TYPES].sort());
  });

  it('may do what Simple Mode’s window does: Next and Back, Clear all and each clear, Put it back, Black-out, the Wallpaper, the live zoom, playback, Audio and Repeat Slides’ Stop', () => {
    for (const command of [
      { type: 'next' },
      { type: 'next', rev: 4, session: 'placeholder-run' },
      { type: 'back' },
      { type: 'previous' },
      // Shift and an arrow, in Simple Mode's keys too.
      { type: 'nextItem' },
      { type: 'previousItem' },
      { type: 'clearAll' },
      { type: 'putBack' },
      { type: 'setBlackout', on: true },
      { type: 'toggleBlackout' },
      { type: 'setWallpaper', on: true },
      { type: 'toggleWallpaper' },
      { type: 'zoomLive', zoom: 2, x: 0, y: 0 },
      { type: 'resetLiveZoom' },
      { type: 'pausePlaying', playing: { layer: 'background' } },
      { type: 'moveTo', playing: { layer: 'background' }, toMs: 1_000 },
      { type: 'pauseMusic' },
      { type: 'musicNext' },
      { type: 'musicPrevious' },
      { type: 'resumePlaying', playing: { layer: 'background' } },
      { type: 'resumeMusic' },
      { type: 'stopRepeat' },
      // Oops: F9 in Simple Mode's window too (no phone sends it yet).
      { type: 'oops' },
    ])
      expect(may(command), JSON.stringify(command)).toBe(true);
  });

  it('never refuses taking something off the screens, so nothing can stay stuck there', () => {
    for (const layer of LAYER_NAMES) expect(may({ type: 'clearLayer', layer }), layer).toBe(true);
    for (const type of ['hideLowerThird', 'hideAudienceTimer', 'clearStageMessage', 'hidePip'])
      expect(may({ type }), type).toBe(true);
    expect(may({ type: 'hideMessage', messageId: 'message-1' })).toBe(true);
    expect(mayOp('message.hide', { templateId: 'template-1' })).toBe(true);
  });

  it('refuses the rest: lower thirds, messages, the stage message, timers, cues, Media, Shastra, marker jumps, and what the window is refused too', () => {
    const lowerThird = { id: 'lt-1', lines: ['Placeholder', '', ''] };
    for (const command of [
      { type: 'showLowerThird', lowerThird },
      { type: 'showMessage', message: { id: 'message-1', text: 'Placeholder' } },
      { type: 'setStageMessage', text: 'Placeholder: five minutes' },
      { type: 'startTimer', timerId: 'timer-1' },
      { type: 'pauseTimer', timerId: 'timer-1' },
      { type: 'resetTimer', timerId: 'timer-1' },
      { type: 'showTimer', timerId: 'timer-1' },
      { type: 'showAudienceTimer', timerId: 'timer-1' },
      { type: 'cueNext', presentationId: 'talk', label: 'Placeholder' },
      { type: 'clearCue' },
      { type: 'playCue' },
      { type: 'setBackground', background: { kind: 'color', color: '#000000' } },
      {
        type: 'playAudio',
        audio: { id: 'a', title: 'Placeholder', mediaId: 'picture', volume: 1, loop: false },
      },
      { type: 'playMusic', music: { playlistId: 'music-1' }, index: 0 },
      { type: 'setMusicLoop', loop: true },
      { type: 'jumpToMarker', layer: 'background', markerId: 'marker-1' },
    ])
      expect(may(command), JSON.stringify(command)).toBe(false);
    // What the engine refuses the window in Simple Mode too.
    for (const type of SIMPLE_MODE_REFUSED_COMMANDS) expect(may({ type }), type).toBe(false);
    for (const op of ['lowerThird.show', 'message.show', 'media.show', 'shastra'])
      expect(mayOp(op, { lowerThirdId: 'lt-1', templateId: 'template-1', mediaId: 'picture' }), op).toBe(
        false,
      );
  });

  it('plays rows of any playlist, with a matching cursor and active row, and never plays a template', () => {
    expect(may({ type: 'playItem', playlistId: 'one', itemId: 'one-picture' })).toBe(true);
    expect(may({ type: 'playItem', playlistId: 'other', itemId: 'other-kirtan' })).toBe(true);
    expect(may({ type: 'playItem', playlistId: 'one', itemId: 'other-kirtan' })).toBe(false);
    expect(may({ type: 'playItem', playlistId: 'one', itemId: 'removed-row' })).toBe(false);
    expect(may({ type: 'playItem', playlistId: 'template', itemId: 'template-row' })).toBe(false);
    const slide = (presentationId: string, playlist?: { playlistId: string; itemId: string }) => ({
      type: 'goLive',
      presentationId,
      slideIndex: 2,
      ...(playlist === undefined ? {} : { playlist }),
    });
    expect(may(slide('talk', { playlistId: 'one', itemId: 'one-talk' }))).toBe(true);
    expect(may(slide('talk'))).toBe(true);
    expect(may(slide('shastra:pg#14', { playlistId: 'one', itemId: 'one-passage' }))).toBe(true);
    expect(may(slide('kirtan', { playlistId: 'other', itemId: 'other-kirtan' }))).toBe(true);
    expect(may(slide('kirtan'), scope(null))).toBe(true);
    expect(may(slide('library-only'))).toBe(false);
    expect(may(slide('template-only'))).toBe(false);
    expect(may(slide('talk', { playlistId: 'other', itemId: 'other-kirtan' }))).toBe(false);
    expect(may(slide('talk', { playlistId: 'one', itemId: 'one-picture' }))).toBe(false);
    expect(may(slide('removed', { playlistId: 'one', itemId: 'removed-row' }))).toBe(false);
    expect(may({ type: 'startRepeat', playlistId: 'other', slideIndex: 1 })).toBe(true);
    expect(may({ type: 'startRepeat', playlistId: 'template' })).toBe(false);
    expect(may(slide(repeatPresentationId('other')))).toBe(true);
    expect(may(slide(repeatPresentationId('template')))).toBe(false);
    expect(mayOp('repeat.start', { playlistId: 'other' })).toBe(true);
    expect(mayOp('repeat.start', { playlistId: 'template' })).toBe(false);
    expect(mayOp('repeat.start', {})).toBe(false);
    expect(mayOp('items', { playlistId: 'other' })).toBe(true);
    expect(mayOp('items', { playlistId: 'template' })).toBe(false);
  });

  it('starts the chosen or last audio playlist', () => {
    expect(mayOp('music.play', { playlistId: 'music-1' })).toBe(true);
    expect(mayOp('music.play', {})).toBe(true);
  });

  it('reads as the window reads, answers Keep these screens?, Identify and turns the screens on as the window does, and takes a phone’s file and an announcement to wait for Pro Mode (question 15)', () => {
    for (const op of [
      'me',
      'status',
      'state',
      'playlists',
      'presentation',
      'presentations',
      'search',
      'messages',
      'timers',
      'lowerThirds',
      'media',
      'music',
      'keys',
      'preview',
      'media.picture',
      'media.original',
      'shared',
      'shared.items',
      'screens',
      'screens.keep',
      'screens.goBack',
      'screens.identify',
      // On only: the switches refuse Off in Simple Mode (ONLY_ON_IN_SIMPLE_MODE), as in the window.
      'switch',
      'upload',
      'upload.piece',
      'announce',
      'announcement',
      // The phone's own reads (Part 9): the wallpapers, the quick bar's pins, a picture's look.
      'wallpapers',
      'quickBar',
      'media.look',
    ])
      expect(mayOp(op), op).toBe(true);
  });

  it('refuses everything Simple Mode’s lock refuses the window; what it bounds only within the window’s own bounds, with the phone’s own arguments', () => {
    for (const op of Object.keys(DEVICE_OPS) as DeviceOp[]) {
      const channel = OP_CHANNEL[op];
      if (channel === null) continue;
      if (SIMPLE_MODE_LOCKED.includes(channel)) expect(PHONE_OPS_IN_SIMPLE_MODE[op], op).toBe('pro');
      // A bounded one: weighed with the arguments the window's request would have (network-service.ts WINDOW_ARGS),
      // or refused whole when the phone has none of them.
      else if (simpleModeRefusesWhole(channel)) {
        if (WINDOW_ARGS[op] === undefined) expect(PHONE_OPS_IN_SIMPLE_MODE[op], op).toBe('pro');
        else expect(['within', 'simple'], op).toContain(PHONE_OPS_IN_SIMPLE_MODE[op]);
      }
    }
    for (const op of [
      'playlist.new',
      'playlist.rename',
      'playlist.remove',
      'playlist.restore',
      'playlist.add',
      'playlist.move',
      'playlist.removeItems',
      'playlist.restoreItems',
      'playlist.whenEnds',
    ] as const)
      expect(WINDOW_ARGS[op], op).toBeDefined();
  });

  it('weighs the phone’s own requests (Part 9) as Simple Mode’s window does them: wallpapers and the playlist’s rows; quick pins and the Picture editor are Pro Mode’s', () => {
    for (const op of ['wallpapers', 'quickBar', 'media.look'])
      expect(PHONE_OPS_IN_SIMPLE_MODE[op as DeviceOp], op).toBe('reads');
    for (const op of ['wallpaper.choose', 'wallpaper.rename', 'wallpaper.remove', 'wallpaper.restore'])
      expect(mayOp(op, { wallpaperId: 'wallpaper-1', name: 'Placeholder' }), op).toBe(true);
    for (const op of ['quickBar.set', 'media.setLook'])
      expect(PHONE_OPS_IN_SIMPLE_MODE[op as DeviceOp], op).toBe('pro');
    expect(mayOp('media.rename', { mediaId: 'picture', name: 'Placeholder' })).toBe(true);
    expect(mayOp('media.rename', { mediaId: 'video-elsewhere', name: 'Placeholder' })).toBe(false);
    expect(mayOp('presentation.rename', { presentationId: 'talk', name: 'Placeholder' })).toBe(true);
    expect(mayOp('presentation.rename', { presentationId: 'kirtan', name: 'Placeholder' })).toBe(true);
    expect(mayOp('presentation.rename', {})).toBe(false);
  });

  it('refuses adding existing Media and library presentations in Simple Mode', () => {
    expect(mayOp('playlist.add', {
      playlistId: 'other',
      items: [
        { kind: 'media', mediaId: 'picture' },
        { kind: 'presentation', presentationId: 'library-only' },
      ],
    })).toBe(false);
  });

  it('refuses what it does not know, and every command a phone can send is weighed (fail closed)', () => {
    expect(mayOp('lowerThird.studio')).toBe(false);
    expect(mayOp('toString')).toBe(false);
    expect(may({ type: 'showProp', propId: 'prop-1' })).toBe(false);
    expect(may({ type: 'constructor' })).toBe(false);
    for (const type of REMOTE_COMMANDS) expect(COMMANDS_IN_SIMPLE_MODE[type], type).toBeDefined();
  });
});
