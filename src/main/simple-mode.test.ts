import { describe, expect, it } from 'vitest';
import type { AudioOutputStatus } from '../shared/audio';
import { allChannels, IPC } from '../shared/ipc';
import { initialEngineState } from '../shared/engine/state';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS, simpleModeRefuses } from '../shared/mode';
import type { InvokeChannel } from '../shared/ipc';
import { OP_CHANNEL } from './network/network-service';
import {
  SIMPLE_MODE_BOUNDED,
  SIMPLE_MODE_LOCKED,
  simpleModeRefusals,
  simpleModeRefusesWhole,
} from './simple-mode';

describe('Simple Mode locks', () => {
  const status = {
    chosen: null,
    devices: [],
    state: 'default',
    checked: true,
  } as unknown as AudioOutputStatus;
  const answers = simpleModeRefusals(() => status);

  it('every request that changes the library, screens or sound', () => {
    for (const channel of SIMPLE_MODE_LOCKED) expect(allChannels()).toContain(channel);
    // Every channel that changes something is locked; reading and running the show are not.
    const changes = allChannels().filter((c) =>
      /:(save|remove|restore|create|rename|apply|update|add|move|fill|set|delete|assign|import|pick|relink|new|from|make|finish|use|go-live|end$|start|stop|convert|cancel-conversion|undo-conversion|run$)/u.test(
        c,
      ),
    );
    // Switching the mode, the thumbnails' still-frame cache, an event from the main process, and
    // reading the notice from the start.
    const open = new Set<string>([
      IPC.app.setMode,
      IPC.media.saveStill,
      IPC.library.importProgress,
      IPC.app.startNotice,
      // The saves of a video's part, read for the status bar, and its event (Session 26e).
      IPC.media.saves,
      IPC.media.savesChanged,
      // Local recordings in both modes use the same destination and controls.
      IPC.stream.startRecording,
      IPC.stream.startSoundRecording,
      IPC.stream.stopRecording,
    ]);
    // Locked, or (Session 55, Part 18) what Simple Mode offers now, each only within its bounds.
    for (const c of changes)
      if (!open.has(c))
        expect(
          SIMPLE_MODE_LOCKED.includes(c as InvokeChannel) || SIMPLE_MODE_BOUNDED.has(c as InvokeChannel),
          c,
        ).toBe(true);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.engine.command);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.screens.uncoverOperator);
    // Simple Mode's own first steps (Sessions 31–36) are kept seen through channels it allows; the welcome's
    // (Pro Mode's) stays locked.
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.app.simpleFirstRun);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.app.simpleFirstRunSeen);
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.setup.welcomeSeen);
  });

  it('every Session 11 request that changes something: stage layouts, MIDI (Looks and masks went in Session 55)', () => {
    for (const channel of [
      IPC.stageLayouts.save,
      IPC.stageLayouts.remove,
      // Session 55: Rename…, Undo of Delete, and the layout every stage screen shows.
      IPC.stageLayouts.rename,
      IPC.stageLayouts.restore,
      IPC.stageLayouts.choose,
      IPC.videoInputs.choose,
      IPC.midi.set,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    // Reading them is not locked, and neither is a window telling Drashti how long a file is.
    for (const channel of [IPC.midi.get, IPC.media.reportLength])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
    // The engine refuses (from anywhere) in Simple Mode zooming the live picture (Session 26e, Pro Mode's; switching
    // the Look was refused too, until Looks went in Session 55), setting up, swapping or moving a
    // picture-in-picture box (Session 50; taking one off is not refused), choosing a video input (Session 50:
    // Pro Mode's Media puts one up; Simple Mode may clear it, as any background), and the skips (Session 54; the time
    // bar's move too until Session 56, when the owner asked for the bar to be dragged in Simple Mode as well).
    // Session 55 (Part 5): the live zoom is Simple Mode's too, from the window and a phone.
    expect(SIMPLE_MODE_REFUSED_COMMANDS).not.toContain('zoomLive');
    expect(SIMPLE_MODE_REFUSED_COMMANDS).not.toContain('resetLiveZoom');
    expect(SIMPLE_MODE_REFUSED_COMMANDS).toEqual([
      'showPip',
      'swapPip',
      'placePip',
      'showInput',
      // LIVE's one press for the chosen video input (Session 55), as showInput.
      'toggleInput',
      'skip',
    ]);
  });

  it('lets the time bar move what plays, Pause it and Play it on, a video or a sound (Session 56, the owner’s words: drag LIVE’s time bar, Pause under LIVE); the skips under LIVE stay Pro Mode’s, Audio’s own on a track are Simple Mode’s', () => {
    // Until Session 56 Simple Mode showed the bar and moved nothing: the move and Pause were refused, but an audio
    // playlist's track's Pause (Music's own), and Play never was.
    // What plays on the audio layer: an audio playlist's track, or a single sound (put up from a phone's Media, say).
    const none = initialEngineState();
    const track = {
      id: 'music:placeholder-list',
      title: 'Placeholder track',
      mediaId: 'placeholder-tune',
      volume: 1,
      loop: false,
      startedAt: 1,
      music: {
        playlistId: 'placeholder-list',
        name: 'Placeholder',
        tracks: [],
        index: 0,
        loop: false,
        shuffle: false,
      },
    };
    const music = { ...none, layers: { ...none.layers, audio: track } };
    const { music: _list, ...single } = track;
    const sound = { ...none, layers: { ...none.layers, audio: { ...single, id: 'placeholder-sound' } } };
    const everything = [
      { layer: 'background' },
      { layer: 'slide', mediaId: 'placeholder-video' },
      { layer: 'pip' },
      { layer: 'audio' },
    ] as const;
    for (const state of [music, sound, none])
      for (const playing of everything) {
        expect(simpleModeRefuses({ type: 'moveTo', playing, toMs: 1000 }, state), playing.layer).toBe(false);
        expect(simpleModeRefuses({ type: 'pausePlaying', playing }, state), playing.layer).toBe(false);
        expect(simpleModeRefuses({ type: 'resumePlaying', playing }, state), playing.layer).toBe(false);
      }
    // Back 15 s, Forward 15 s and Last 10 s under LIVE stay Pro Mode's (Simple Mode's window has none there); Audio's
    // own, on an audio playlist's track, are Simple Mode's since Session 56 (the owner: Audio in Simple Mode, as in Pro
    // Mode); a single sound's and the background's stay refused.
    for (const jump of ['back', 'forward', 'last'] as const) {
      expect(simpleModeRefuses({ type: 'skip', layer: 'audio', jump }, music), jump).toBe(false);
      expect(simpleModeRefuses({ type: 'skip', layer: 'audio', jump }, sound), jump).toBe(true);
      expect(simpleModeRefuses({ type: 'skip', layer: 'audio', jump }, none), jump).toBe(true);
      expect(simpleModeRefuses({ type: 'skip', layer: 'background', jump }, music), jump).toBe(true);
      expect(simpleModeRefuses({ type: 'skip', layer: 'background', jump }, sound), jump).toBe(true);
    }
    // As before: a marker jump and Music's own buttons are not refused (switching the Look, refused here before, went
    // with Looks in Session 55).
    expect(simpleModeRefuses({ type: 'jumpToMarker', layer: 'background', markerId: 'm1' }, sound)).toBe(
      false,
    );
    expect(simpleModeRefuses({ type: 'pauseMusic' }, music)).toBe(false);
    expect(simpleModeRefuses({ type: 'resumeMusic' }, music)).toBe(false);
    expect(simpleModeRefuses({ type: 'next' }, none)).toBe(false);
  });

  it('every Session 12 request that changes something', () => {
    for (const channel of [
      IPC.shastra.remove,
      IPC.playlists.editSlot,
      IPC.playlists.setTimers,
      IPC.calendar.remove,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    // Finding passages and reading the schedules stay.
    for (const channel of [
      IPC.shastra.list,
      IPC.shastra.tree,
      IPC.shastra.resolve,
      IPC.shastra.search,
      IPC.shastra.passage,
      IPC.calendar.view,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
  });

  // Session 37 (WCAG 2.1.4): Simple Mode never turns the single-letter keys on or off; it still asks whether they act.
  it('the single-letter keys’ switch; whether they act is still answered', () => {
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.app.setSingleKeys);
    expect(answers.get(IPC.app.setSingleKeys)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.app.singleKeys);
  });

  it('answers each in the shape its caller expects, a bounded one outside its bounds too (the lock fails closed)', () => {
    expect(answers.get(IPC.messages.create)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(answers.get(IPC.library.pickImportPaths)?.()).toEqual([]);
    expect(answers.get(IPC.wallpapers.pickFiles)?.()).toEqual([]);
    expect(answers.get(IPC.playlists.addItems)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(answers.get(IPC.audio.setOutput)?.()).toBe(status);
    expect(answers.size).toBe(SIMPLE_MODE_LOCKED.length + SIMPLE_MODE_BOUNDED.size);
  });

  it('allows a local recording in Simple Mode while keeping its destination and the live stream locked', () => {
    for (const channel of [
      IPC.stream.startRecording,
      IPC.stream.startSoundRecording,
      IPC.stream.stopRecording,
    ])
      expect(answers.has(channel), channel).toBe(false);
    for (const channel of [IPC.stream.goLive, IPC.stream.end, IPC.stream.setInputs])
      expect(answers.has(channel), channel).toBe(true);
    expect(answers.get(IPC.stream.pickFolder)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  });

  it('the Access List’s edits, answered in their own shape; reading the list and saving its CSV are not (Session 54, E4)', () => {
    for (const channel of [
      IPC.accessList.add,
      IPC.accessList.approve,
      IPC.accessList.reject,
      IPC.accessList.revoke,
      IPC.accessList.regrant,
      IPC.accessList.changeLength,
      IPC.accessList.changeMode,
      IPC.accessList.note,
    ]) {
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
      expect(answers.get(channel)?.(), channel).toEqual({
        ok: false,
        message: SIMPLE_MODE_REFUSAL,
        view: { people: null, updatedAt: null, listTime: null, problem: null },
      });
    }
    for (const channel of [IPC.accessList.view, IPC.accessList.refresh, IPC.accessList.exportCsv])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
  });

  it('every Session 13 request that changes something: pairing, removing, assigning, reloading; the dashboard still opens', () => {
    for (const channel of [
      IPC.nodes.startPairing,
      IPC.nodes.cancelPairing,
      IPC.nodes.rename,
      IPC.nodes.remove,
      IPC.nodes.everything,
      IPC.nodes.reload,
      IPC.screens.assignNodeDisplay,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    // Reading the nodes, watching the dashboard's pictures, Identify and an output's report are not locked.
    for (const channel of [IPC.nodes.status, IPC.nodes.watch, IPC.nodes.identify, IPC.output.report])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
    expect(answers.get(IPC.nodes.remove)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  });

  /**
   * The playlists as index.ts tells the lock from the library (Session 56: every one of them, as Pro Mode's left column
   * offers them): "one" open in Simple Mode's window, "other" beside it, the folder "week", a deleted playlist and a
   * deleted folder (for their Undo), and a template, Pro Mode's.
   */
  const KINDS: Record<string, 'playlist' | 'folder' | 'template'> = {
    one: 'playlist',
    other: 'playlist',
    gone: 'playlist',
    week: 'folder',
    'old-folder': 'folder',
    tpl: 'template',
  };
  const ITEMS: Record<string, string> = {
    'i-one': 'one',
    'i-gone': 'one',
    'i-other': 'other',
    'i-in-gone': 'gone',
    'i-tpl': 'tpl',
  };
  const scope = {
    playlistId: 'one',
    playlistOf: (itemId: string) => ITEMS[itemId] ?? null,
    holdsMedia: (mediaId: string) => mediaId === 'm-in',
    holdsPresentation: (presentationId: string) => presentationId === 'p-in',
    kindOf: (id: string) => KINDS[id] ?? null,
    listsMedia: (mediaId: string) => mediaId === 'm-in' || mediaId === 'm-other',
    listsPresentation: (presentationId: string) => presentationId === 'p-in' || presentationId === 'p-other',
    // Session 56: an audio playlist's sound, and the presentations an edit kept for Undo covers.
    inMusic: (mediaId: string) => mediaId === 'm-music',
    revisionCovers: (revisionId: string) =>
      ({ 'r-in': ['p-in'], 'r-other': ['p-other'], 'r-out': ['p-out'], 'r-mixed': ['p-in', 'p-out'] })[
        revisionId
      ] ?? null,
  };
  const within = (channel: InvokeChannel, ...args: unknown[]): boolean => {
    const bound = SIMPLE_MODE_BOUNDED.get(channel);
    if (!bound) throw new Error(`${channel} has no bounds`);
    return bound(args, scope);
  };

  it('what Simple Mode offers since Session 55 (Part 18) runs within its bounds, never locked; the rest stays locked', () => {
    // Bringing things in, the playlists' rows, Rename and Delete, and From a Link…; since Session 56 the playlists and
    // folders themselves, as Pro Mode's left column offers them, and a smart playlist from a folder.
    for (const channel of [
      IPC.playlists.create,
      IPC.playlists.rename,
      IPC.playlists.remove,
      IPC.playlists.restore,
      IPC.playlists.createSmart,
      IPC.library.importPaths,
      IPC.library.pickImportPaths,
      IPC.playlists.addItems,
      IPC.playlists.moveItems,
      IPC.playlists.removeItems,
      IPC.playlists.restoreItems,
      IPC.library.renamePresentation,
      IPC.media.rename,
      IPC.links.look,
      IPC.links.download,
      IPC.links.stop,
      IPC.links.reset,
      IPC.links.addWaiting,
      IPC.links.setPlaylist,
      // From a Link…, whole (Session 56): the highest video quality, the folder to save in, Show in Finder/Explorer.
      IPC.links.setMaxHeight,
      IPC.links.pickFolder,
      IPC.links.showSaved,
      // A slide's row dragged within its deck or out of it (Part 4b), and its Undo.
      IPC.playlists.setItemOrder,
      IPC.playlists.splitItem,
      IPC.playlists.undoSplit,
      // The wallpapers (Part 6).
      IPC.wallpapers.add,
      IPC.wallpapers.pickFiles,
      IPC.wallpapers.rename,
      IPC.wallpapers.setPictures,
      IPC.wallpapers.remove,
      IPC.wallpapers.restore,
      IPC.wallpapers.choose,
    ]) {
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
      expect(SIMPLE_MODE_BOUNDED.has(channel), channel).toBe(true);
    }
    // Nothing is both.
    for (const channel of SIMPLE_MODE_BOUNDED.keys())
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
    // A header's name, Duplicate, a wallpaper's seconds and fade, a file's looks, and deleting a file from the library
    // stay Pro Mode's (a video's When it ends and a file's points are Simple Mode's since Session 56, within their
    // bounds: below).
    for (const channel of [
      IPC.playlists.duplicate,
      IPC.playlists.renameHeader,
      IPC.playlists.fillPlaceholder,
      IPC.wallpapers.setTiming,
      IPC.media.remove,
      IPC.media.restore,
      IPC.media.setLook,
      IPC.library.removePresentations,
      IPC.library.relinkMedia,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
  });

  it('a playlist’s rows, whichever is open (Session 56): added to, moved in, taken out of and put back in it; never a template’s or a folder’s', () => {
    expect(within(IPC.playlists.addItems, 'one', null, [{ kind: 'media', mediaId: 'x' }])).toBe(true);
    // An import of a folder brings its parts' headers with its files.
    expect(
      within(IPC.playlists.addItems, 'one', 2, [
        { kind: 'header', label: 'Placeholder part' },
        { kind: 'presentation', presentationId: 'p' },
      ]),
    ).toBe(true);
    // Another playlist too (files dropped on its row in the list, an import that ends after another was opened, an
    // Undo there), as in Pro Mode; never a template (Pro Mode's), a folder of playlists, or what is none.
    expect(within(IPC.playlists.addItems, 'other', null, [{ kind: 'media', mediaId: 'x' }])).toBe(true);
    expect(within(IPC.playlists.addItems, 'tpl', null, [{ kind: 'media', mediaId: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, 'week', null, [{ kind: 'media', mediaId: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, 'nowhere', null, [{ kind: 'media', mediaId: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, null, null, [{ kind: 'media', mediaId: 'x' }])).toBe(false);
    // What Simple Mode never brings in: a Shastra passage, a video input, a slot.
    expect(within(IPC.playlists.addItems, 'one', null, [{ kind: 'shastra', passageId: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, 'one', null, [{ kind: 'input', name: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, 'one', null, 'not a list')).toBe(false);
    expect(within(IPC.playlists.moveItems, 'one', ['i-one'], 0)).toBe(true);
    expect(within(IPC.playlists.moveItems, 'other', ['i-other'], 0)).toBe(true);
    expect(within(IPC.playlists.moveItems, 'tpl', ['i-tpl'], 0)).toBe(false);
    expect(within(IPC.playlists.removeItems, ['i-one'])).toBe(true);
    expect(within(IPC.playlists.removeItems, ['i-one', 'i-other'])).toBe(true);
    expect(within(IPC.playlists.removeItems, ['i-one', 'i-tpl'])).toBe(false);
    expect(within(IPC.playlists.removeItems, ['i-one', 'i-none'])).toBe(false);
    expect(within(IPC.playlists.removeItems, [])).toBe(false);
    expect(within(IPC.playlists.removeItems, 'i-one')).toBe(false);
    expect(within(IPC.playlists.restoreItems, ['i-gone'])).toBe(true);
    // An Undo of rows taken out of a playlist since deleted: they go back into it, and come back with it.
    expect(within(IPC.playlists.restoreItems, ['i-in-gone'])).toBe(true);
    expect(within(IPC.playlists.restoreItems, ['i-tpl'])).toBe(false);
    expect(within(IPC.links.setPlaylist, 'one')).toBe(true);
    expect(within(IPC.links.setPlaylist, 'other')).toBe(true);
    expect(within(IPC.links.setPlaylist, 'tpl')).toBe(false);
    expect(within(IPC.links.setPlaylist, 'week')).toBe(false);
    expect(within(IPC.links.setPlaylist, null)).toBe(false);
    // Part 4b's drags of a slide's row: a playlist's item (and, for Undo, the item the drag made).
    expect(within(IPC.playlists.setItemOrder, 'i-one', { mode: 'all' })).toBe(true);
    expect(within(IPC.playlists.setItemOrder, 'i-other', { mode: 'all' })).toBe(true);
    expect(within(IPC.playlists.setItemOrder, 'i-tpl', { mode: 'all' })).toBe(false);
    expect(within(IPC.playlists.splitItem, 'i-one', { mode: 'all' }, { mode: 'all' }, 0)).toBe(true);
    expect(within(IPC.playlists.splitItem, 'i-tpl', { mode: 'all' }, { mode: 'all' }, 0)).toBe(false);
    expect(within(IPC.playlists.undoSplit, 'i-one', { mode: 'all' }, 'i-gone')).toBe(true);
    expect(within(IPC.playlists.undoSplit, 'i-one', { mode: 'all' }, 'i-tpl')).toBe(false);
    // With none open (its open one deleted, say), the window still changes the playlists it shows.
    const none = { ...scope, playlistId: null };
    expect(
      SIMPLE_MODE_BOUNDED.get(IPC.playlists.addItems)?.(
        ['one', null, [{ kind: 'media', mediaId: 'x' }]],
        none,
      ),
    ).toBe(true);
    expect(SIMPLE_MODE_BOUNDED.get(IPC.playlists.removeItems)?.([['i-other']], none)).toBe(true);
  });

  it('the playlists and folders, as Pro Mode’s left column offers them (Session 56): New playlist and New folder, at the top or in a folder; Rename…, Delete… and its Undo; Smart Playlist from a Folder…', () => {
    expect(within(IPC.playlists.create, 'Placeholder playlist', null, false)).toBe(true);
    expect(within(IPC.playlists.create, 'Placeholder folder', null, true)).toBe(true);
    // In a folder: New playlist here, New folder here.
    expect(within(IPC.playlists.create, 'Placeholder playlist', 'week', false)).toBe(true);
    expect(within(IPC.playlists.create, 'Placeholder folder', 'week', true)).toBe(true);
    // Never in a playlist, a template or what is none; never with what it is left out (fails closed).
    expect(within(IPC.playlists.create, 'Placeholder playlist', 'one', false)).toBe(false);
    expect(within(IPC.playlists.create, 'Placeholder playlist', 'tpl', false)).toBe(false);
    expect(within(IPC.playlists.create, 'Placeholder playlist', 'nowhere', false)).toBe(false);
    expect(within(IPC.playlists.create, 'Placeholder playlist', null)).toBe(false);
    expect(within(IPC.playlists.create)).toBe(false);
    // Rename…: a playlist or a folder, never a template.
    expect(within(IPC.playlists.rename, 'other', 'Placeholder name')).toBe(true);
    expect(within(IPC.playlists.rename, 'week', 'Placeholder name')).toBe(true);
    expect(within(IPC.playlists.rename, 'tpl', 'Placeholder name')).toBe(false);
    expect(within(IPC.playlists.rename, 'nowhere', 'Placeholder name')).toBe(false);
    expect(within(IPC.playlists.rename, 42, 'Placeholder name')).toBe(false);
    // Delete… (several chosen together too), and its Undo: playlists and folders, a deleted one too.
    expect(within(IPC.playlists.remove, ['one', 'week'])).toBe(true);
    expect(within(IPC.playlists.remove, ['one', 'tpl'])).toBe(false);
    expect(within(IPC.playlists.remove, ['nowhere'])).toBe(false);
    expect(within(IPC.playlists.remove, [])).toBe(false);
    expect(within(IPC.playlists.remove, 'one')).toBe(false);
    expect(within(IPC.playlists.restore, ['gone', 'old-folder'])).toBe(true);
    expect(within(IPC.playlists.restore, ['tpl'])).toBe(false);
    expect(within(IPC.playlists.restore)).toBe(false);
    // Smart Playlist from a Folder…: the folder chosen in the system's dialog.
    expect(within(IPC.playlists.createSmart)).toBe(true);
    // A folder dropped (the owner's item 5): a smart playlist at once; the main process looks at what was dropped.
    expect(within(IPC.playlists.createSmartFrom, ['/placeholder/Week 1'])).toBe(true);
    expect(answers.get(IPC.playlists.createSmartFrom)?.()).toEqual({
      made: [],
      files: [],
      problems: [SIMPLE_MODE_REFUSAL],
    });
  });

  it('fails closed (Session 56): a phone or Companion, asking with none of the arguments, is refused each of them whole', () => {
    for (const channel of [
      IPC.playlists.create,
      IPC.playlists.rename,
      IPC.playlists.remove,
      IPC.playlists.restore,
      IPC.playlists.createSmart,
      IPC.playlists.addItems,
      IPC.playlists.removeItems,
    ]) {
      expect(simpleModeRefusesWhole(channel), channel).toBe(true);
      expect(answers.get(channel)?.(), channel).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    }
    expect(simpleModeRefusesWhole(IPC.playlists.createSmartFrom)).toBe(true);
  });

  it('what is Pro Mode’s stays as strict as before (Session 56): templates and slots, sharing with phones, Repeat Slides and its settings, Duplicate, a row’s timers and a header’s name, the missing taken out of a smart playlist', () => {
    for (const channel of [
      IPC.playlists.saveAsTemplate,
      IPC.playlists.newFromTemplate,
      IPC.playlists.addSlot,
      IPC.playlists.editSlot,
      IPC.playlists.fillPlaceholder,
      IPC.playlists.share,
      IPC.playlists.createRepeat,
      IPC.playlists.setRepeat,
      IPC.playlists.duplicate,
      IPC.playlists.setTimers,
      IPC.playlists.renameHeader,
      IPC.playlists.removeMissing,
    ]) {
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
      expect(SIMPLE_MODE_BOUNDED.has(channel), channel).toBe(false);
    }
  });

  it('Rename: a file a playlist holds (Session 56: any playlist, never only a template)', () => {
    expect(within(IPC.library.renamePresentation, 'p-in', 'Placeholder new name')).toBe(true);
    expect(within(IPC.library.renamePresentation, 'p-other', 'Placeholder new name')).toBe(true);
    expect(within(IPC.library.renamePresentation, 'p-out', 'Placeholder new name')).toBe(false);
    expect(within(IPC.media.rename, 'm-in', 'Placeholder new name')).toBe(true);
    expect(within(IPC.media.rename, 'm-other', 'Placeholder new name')).toBe(true);
    expect(within(IPC.media.rename, 'm-out', 'Placeholder new name')).toBe(false);
    expect(within(IPC.media.rename, 42, 'Placeholder new name')).toBe(false);
  });

  it('bringing things in: the main process sets the import’s own limits (what it takes, nothing replaced), so any is within', () => {
    for (const channel of [
      IPC.library.importPaths,
      IPC.library.pickImportPaths,
      IPC.links.look,
      IPC.links.download,
      IPC.links.stop,
      IPC.links.reset,
      IPC.links.addWaiting,
    ])
      expect(within(channel, ['/placeholder/x.txt']), channel).toBe(true);
  });

  /*
   * Session 56 (alpha.16), the owner: Simple Mode's right column and bottom bar from Pro Mode's own parts. Audio as Pro
   * Mode has it (the audio playlists, their Play, and Music steps aside); a row's Trim (start, end and markers, Trim
   * black and silence, Even loudness) and When it ends; Edit slides (Pro's slide editor, and its
   * save's Undo). Each within its bounds, so a phone or Companion (no arguments) is still refused; what makes a copy
   * (Save as MP4, a conversion, a PDF copy), a library-wide setting (the default transition) and the rest stay Pro Mode's.
   */
  it('Audio’s own actions (Session 56): the audio playlists made, renamed, deleted and put back, their sounds and order, and Music steps aside', () => {
    for (const [channel, args] of [
      [IPC.music.create, ['Placeholder before sabha']],
      [IPC.music.rename, ['list-1', 'Placeholder dhun']],
      [IPC.music.remove, ['list-1']],
      [IPC.music.restore, ['list-1']],
      [IPC.music.setOptions, ['list-1', { loop: true, shuffle: false }]],
      [IPC.music.addTracks, ['list-1', ['m-anything'], null]],
      [IPC.music.moveTrack, ['track-1', 2]],
      [IPC.music.removeTrack, ['track-1']],
      [IPC.music.restoreTrack, ['track-1', 0]],
      [IPC.sound.setStepsAside, [false]],
    ] as const) {
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
      expect(SIMPLE_MODE_BOUNDED.has(channel), channel).toBe(true);
      // The window's request: within (they belong to no playlist: nothing bounds them but what they are).
      expect(within(channel, ...args), channel).toBe(true);
      // With none of its arguments (a phone's or Companion's, as the network asks): outside, so refused.
      expect(within(channel), channel).toBe(false);
    }
    // What is not one of them: outside.
    expect(within(IPC.music.create, 42)).toBe(false);
    expect(within(IPC.music.rename, 42, 'Placeholder')).toBe(false);
    expect(within(IPC.music.addTracks, 'list-1', 'not a list', null)).toBe(false);
    expect(within(IPC.sound.setStepsAside, 'yes')).toBe(false);
  });

  it('a row’s Trim, Trim black and silence and Even loudness (Session 56): a file a playlist (never only a template) or an audio playlist holds', () => {
    const markers = { startMs: 1000, endMs: null, markers: [] };
    for (const [channel, rest] of [
      [IPC.media.setMarkers, [markers]],
      [IPC.sound.trimEdges, []],
      [IPC.sound.setEven, [false]],
      [IPC.media.rename, ['Placeholder new name']],
    ] as const) {
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
      expect(within(channel, 'm-in', ...rest), channel).toBe(true);
      // Another playlist's (the playlists, as Pro Mode's left column has them).
      expect(within(channel, 'm-other', ...rest), channel).toBe(true);
      // A track's, from Audio's own right-click menu.
      expect(within(channel, 'm-music', ...rest), channel).toBe(true);
      // A file no playlist holds (only a template, or none): the library's, Pro Mode's.
      expect(within(channel, 'm-out', ...rest), channel).toBe(false);
      expect(within(channel, 42, ...rest), channel).toBe(false);
      expect(within(channel), channel).toBe(false);
    }
    // With no audio playlist told of (a scope that leaves it out): a playlist's files only.
    const { inMusic: _music, ...noMusic } = scope;
    expect(SIMPLE_MODE_BOUNDED.get(IPC.media.setMarkers)?.(['m-music', markers], noMusic)).toBe(false);
    expect(SIMPLE_MODE_BOUNDED.get(IPC.media.setMarkers)?.(['m-in', markers], noMusic)).toBe(true);
  });

  it('reads, saves and resets a Trim only on playlist video rows in Simple Mode', () => {
    for (const [channel, args] of [
      [IPC.media.rowTrim, []],
      [IPC.media.applyRowTrim, [{ mediaId: 'm-in', points: { startMs: 500, endMs: 1000, markers: [] } }]],
      [IPC.media.resetRowTrim, ['m-in']],
    ] as const) {
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
      expect(simpleModeRefusesWhole(channel), channel).toBe(true);
      for (const row of ['i-one', 'i-other']) expect(within(channel, row, ...args), channel).toBe(true);
      for (const row of ['i-tpl', 'i-unknown', 42])
        expect(within(channel, row, ...args), channel).toBe(false);
      expect(within(channel), channel).toBe(false);
    }
    expect(answers.get(IPC.media.rowTrim)?.()).toBeNull();
  });

  it('a video row’s When it ends (Session 56): a playlist’s row, never a template’s', () => {
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.playlists.setWhenEnds);
    expect(within(IPC.playlists.setWhenEnds, 'i-one', 'wallpaper')).toBe(true);
    expect(within(IPC.playlists.setWhenEnds, 'i-one', 'next')).toBe(true);
    expect(within(IPC.playlists.setWhenEnds, 'i-other', 'loop')).toBe(true);
    expect(within(IPC.playlists.setWhenEnds, 'i-tpl', 'wallpaper')).toBe(false);
    expect(within(IPC.playlists.setWhenEnds, 'i-unknown', 'wallpaper')).toBe(false);
    expect(within(IPC.playlists.setWhenEnds, ['i-one'], 'wallpaper')).toBe(false);
    expect(within(IPC.playlists.setWhenEnds)).toBe(false);
  });

  it('Edit slides (Session 56): Pro’s slide editor on a presentation a playlist holds, its save, what it copies, and its save’s Undo', () => {
    for (const channel of [
      IPC.slideEditor.open,
      IPC.slideEditor.copy,
      IPC.library.saveSlides,
      IPC.library.restoreRevision,
    ]) {
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
      expect(SIMPLE_MODE_BOUNDED.has(channel), channel).toBe(true);
      expect(within(channel), channel).toBe(false);
    }
    expect(within(IPC.slideEditor.open, 'p-in', null)).toBe(true);
    expect(within(IPC.slideEditor.open, 'p-in', 'slide-2')).toBe(true);
    // Another playlist's (the playlists, as Pro Mode's left column has them); never one only a template holds, or none.
    expect(within(IPC.slideEditor.open, 'p-other', null)).toBe(true);
    expect(within(IPC.slideEditor.open, 'p-out', null)).toBe(false);
    expect(within(IPC.library.saveSlides, 'p-in', { presentationId: 'p-in' }, 'stamp', false)).toBe(true);
    expect(within(IPC.library.saveSlides, 'p-out', { presentationId: 'p-out' }, 'stamp', false)).toBe(false);
    expect(within(IPC.library.saveSlides, 42, {}, 'stamp', false)).toBe(false);
    // Undo of a save: every presentation the edit kept is one a playlist holds.
    expect(within(IPC.library.restoreRevision, 'r-in')).toBe(true);
    expect(within(IPC.library.restoreRevision, 'r-other')).toBe(true);
    expect(within(IPC.library.restoreRevision, 'r-out')).toBe(false);
    expect(within(IPC.library.restoreRevision, 'r-mixed')).toBe(false);
    expect(within(IPC.library.restoreRevision, 'r-forgotten')).toBe(false);
    // What the editor copied, kept for its next window (the main process takes it from the editor's page only).
    expect(within(IPC.slideEditor.copy, { elements: [] })).toBe(true);
    expect(within(IPC.slideEditor.copy, null)).toBe(false);
    // With no kept edits told of (a scope that leaves them out): no Undo is within.
    const { revisionCovers: _covers, ...noCovers } = scope;
    expect(SIMPLE_MODE_BOUNDED.get(IPC.library.restoreRevision)?.(['r-in'], noCovers)).toBe(false);
  });

  it('what makes a copy, a library-wide setting, and the rest of the editor’s and Audio’s neighbours stay Pro Mode’s (Session 56)', () => {
    for (const channel of [
      // Standalone Save as MP4… and its stop.
      IPC.media.saveTrim,
      IPC.media.stopSave,
      // Conversions make copies.
      IPC.media.convert,
      IPC.media.cancelConversion,
      IPC.media.undoConversion,
      // The slide editor's Save a PDF copy…, and the default transition (every presentation's).
      IPC.library.exportPdf,
      IPC.library.setDefaultTransition,
      // A timer slide's timer (Timers are Pro Mode's), words, and New › QR code….
      IPC.timers.update,
      IPC.library.saveWords,
      IPC.library.newQrSlide,
      // A picture's look and a live zoom kept, Save picture…, the sound output.
      IPC.media.setLook,
      IPC.media.keepLiveZoom,
      IPC.media.savePicture,
      IPC.audio.setOutput,
      // A file or a presentation deleted from the library.
      IPC.media.remove,
      IPC.library.removePresentations,
    ]) {
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
      expect(SIMPLE_MODE_BOUNDED.has(channel), channel).toBe(false);
    }
    expect(answers.get(IPC.media.saveTrim)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(answers.get(IPC.library.exportPdf)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  });

  it('From a Link…, whole (Session 56, the owner’s item 11): the highest video quality, the folder to save in and Show in Finder/Explorer from the window; never from a phone or Companion', () => {
    // The window's own requests, as Pro Mode's dialog sends them (the link service says no to a quality it does not
    // offer, or to any change while a download goes, in its own words).
    expect(within(IPC.links.setMaxHeight, 2160)).toBe(true);
    expect(within(IPC.links.pickFolder)).toBe(true);
    expect(within(IPC.links.showSaved, null)).toBe(true);
    expect(within(IPC.links.showSaved, 'placeholder-run')).toBe(true);
    const link = [
      IPC.links.look,
      IPC.links.download,
      IPC.links.stop,
      IPC.links.reset,
      IPC.links.addWaiting,
      IPC.links.setPlaylist,
      IPC.links.setMaxHeight,
      IPC.links.pickFolder,
      IPC.links.showSaved,
    ];
    for (const channel of link) {
      // Asked with none of the window's arguments (as the network asks for a phone or Companion): refused whole.
      expect(simpleModeRefusesWhole(channel), channel).toBe(true);
      expect(answers.get(channel)?.(), channel).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
      // And no request a phone or Companion makes is one of them, in either mode.
      expect(Object.values(OP_CHANNEL), channel).not.toContain(channel);
    }
  });

  it('the quick bar (Session 55, Part 8) is Pro Mode’s: its pins are read in either mode, never changed in Simple Mode', () => {
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.quickBar.set);
    expect(SIMPLE_MODE_BOUNDED.has(IPC.quickBar.set)).toBe(false);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.quickBar.view);
    expect(answers.get(IPC.quickBar.set)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  });

  it('New › QR code… (Session 55, Part 8) is Pro Mode’s: Simple Mode makes no slide', () => {
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.library.newQrSlide);
    expect(SIMPLE_MODE_BOUNDED.has(IPC.library.newQrSlide)).toBe(false);
    expect(answers.get(IPC.library.newQrSlide)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  });

  it('the opening (Session 55) plays in both modes; File › Opening…’s changes are Pro Mode’s', () => {
    for (const c of [
      IPC.opening.setOn,
      IPC.opening.setChoice,
      IPC.opening.loadPack,
      IPC.opening.saveCopy,
      // Taking its sound out (alpha.16).
      IPC.opening.removeSound,
    ]) {
      expect(SIMPLE_MODE_LOCKED).toContain(c);
      expect(answers.get(c)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    }
    for (const c of [IPC.opening.atStart, IPC.opening.ended, IPC.opening.view]) {
      expect(SIMPLE_MODE_LOCKED).not.toContain(c);
      expect(SIMPLE_MODE_BOUNDED.has(c)).toBe(false);
    }
  });
});
