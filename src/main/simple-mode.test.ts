import { describe, expect, it } from 'vitest';
import type { AudioOutputStatus } from '../shared/audio';
import { allChannels, IPC } from '../shared/ipc';
import { initialEngineState } from '../shared/engine/state';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS, simpleModeRefuses } from '../shared/mode';
import type { InvokeChannel } from '../shared/ipc';
import { SIMPLE_MODE_BOUNDED, SIMPLE_MODE_LOCKED, type SimpleScope, simpleModeRefusals } from './simple-mode';

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
    // Pro Mode's Media puts one up; Simple Mode may clear it, as any background), and the time bar's move and the
    // skips (Session 54: Simple Mode shows the bar only).
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
      'moveTo',
      'skip',
    ]);
  });

  it('shows the time bar but moves nothing: the move, the skips and Pause are refused, Play never is, and a track’s Pause is Music’s own (Session 54)', () => {
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
        expect(simpleModeRefuses({ type: 'moveTo', playing, toMs: 1000 }, state), playing.layer).toBe(true);
        // Paused, it can always be played on: Simple Mode's LIVE has no Play, so nothing stays stuck.
        expect(simpleModeRefuses({ type: 'resumePlaying', playing }, state), playing.layer).toBe(false);
      }
    // Pause is refused, but on an audio playlist's track, where it is Music's own (Simple Mode's Pause music). A
    // single sound's is refused too (Session 54's review): Simple Mode's window could never play it on.
    for (const playing of everything) {
      expect(simpleModeRefuses({ type: 'pausePlaying', playing }, music), playing.layer).toBe(
        playing.layer !== 'audio',
      );
      expect(simpleModeRefuses({ type: 'pausePlaying', playing }, sound), playing.layer).toBe(true);
      expect(simpleModeRefuses({ type: 'pausePlaying', playing }, none), playing.layer).toBe(true);
    }
    expect(simpleModeRefuses({ type: 'skip', layer: 'audio', jump: 'back' }, music)).toBe(true);
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

  /** The one playlist and what is in it, as index.ts tells the lock from the library. */
  const scope: SimpleScope = {
    playlistId: 'one',
    playlistOf: (itemId) => ({ 'i-one': 'one', 'i-gone': 'one', 'i-other': 'other' })[itemId] ?? null,
    holdsMedia: (mediaId) => mediaId === 'm-in',
    holdsPresentation: (presentationId) => presentationId === 'p-in',
  };
  const within = (channel: InvokeChannel, ...args: unknown[]): boolean => {
    const bound = SIMPLE_MODE_BOUNDED.get(channel);
    if (!bound) throw new Error(`${channel} has no bounds`);
    return bound(args, scope);
  };

  it('what Simple Mode offers since Session 55 (Part 18) runs within its bounds, never locked; the rest stays locked', () => {
    // Bringing things in, the one playlist's rows, Rename and Delete, and From a Link….
    for (const channel of [
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
    // A playlist of its own, other playlists, a header's name, Duplicate, a video's When it ends, a wallpaper's seconds
    // and fade, the highest quality and the folder for downloads, a file's points and looks, and deleting a file from
    // the library stay Pro Mode's.
    for (const channel of [
      IPC.playlists.create,
      IPC.playlists.rename,
      IPC.playlists.remove,
      IPC.playlists.restore,
      IPC.playlists.duplicate,
      IPC.playlists.renameHeader,
      IPC.playlists.fillPlaceholder,
      IPC.playlists.setWhenEnds,
      IPC.wallpapers.setTiming,
      IPC.links.setMaxHeight,
      IPC.links.pickFolder,
      IPC.media.remove,
      IPC.media.restore,
      IPC.media.setMarkers,
      IPC.media.setLook,
      IPC.library.removePresentations,
      IPC.library.relinkMedia,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
  });

  it('the one playlist’s rows only: added to, moved in, taken out of and put back in it, and nothing else of a playlist', () => {
    expect(within(IPC.playlists.addItems, 'one', null, [{ kind: 'media', mediaId: 'x' }])).toBe(true);
    // An import of a folder brings its parts' headers with its files.
    expect(
      within(IPC.playlists.addItems, 'one', 2, [
        { kind: 'header', label: 'Placeholder part' },
        { kind: 'presentation', presentationId: 'p' },
      ]),
    ).toBe(true);
    expect(within(IPC.playlists.addItems, 'other', null, [{ kind: 'media', mediaId: 'x' }])).toBe(false);
    // What Simple Mode never brings in: a Shastra passage, a video input, a slot.
    expect(within(IPC.playlists.addItems, 'one', null, [{ kind: 'shastra', passageId: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, 'one', null, [{ kind: 'input', name: 'x' }])).toBe(false);
    expect(within(IPC.playlists.addItems, 'one', null, 'not a list')).toBe(false);
    expect(within(IPC.playlists.moveItems, 'one', ['i-one'], 0)).toBe(true);
    expect(within(IPC.playlists.moveItems, 'other', ['i-other'], 0)).toBe(false);
    expect(within(IPC.playlists.removeItems, ['i-one'])).toBe(true);
    expect(within(IPC.playlists.removeItems, ['i-one', 'i-other'])).toBe(false);
    expect(within(IPC.playlists.removeItems, 'i-one')).toBe(false);
    expect(within(IPC.playlists.restoreItems, ['i-gone'])).toBe(true);
    expect(within(IPC.playlists.restoreItems, ['i-other'])).toBe(false);
    expect(within(IPC.links.setPlaylist, 'one')).toBe(true);
    expect(within(IPC.links.setPlaylist, 'other')).toBe(false);
    // Part 4b's drags of a slide's row: an item of the one playlist (and, for Undo, the item the drag made).
    expect(within(IPC.playlists.setItemOrder, 'i-one', { mode: 'all' })).toBe(true);
    expect(within(IPC.playlists.setItemOrder, 'i-other', { mode: 'all' })).toBe(false);
    expect(within(IPC.playlists.splitItem, 'i-one', { mode: 'all' }, { mode: 'all' }, 0)).toBe(true);
    expect(within(IPC.playlists.splitItem, 'i-other', { mode: 'all' }, { mode: 'all' }, 0)).toBe(false);
    expect(within(IPC.playlists.undoSplit, 'i-one', { mode: 'all' }, 'i-gone')).toBe(true);
    expect(within(IPC.playlists.undoSplit, 'i-one', { mode: 'all' }, 'i-other')).toBe(false);
    // With no one playlist yet, nothing of a playlist is within.
    const none = { ...scope, playlistId: null };
    const bound = SIMPLE_MODE_BOUNDED.get(IPC.playlists.addItems);
    expect(bound?.(['one', null, [{ kind: 'media', mediaId: 'x' }]], none)).toBe(false);
    expect(SIMPLE_MODE_BOUNDED.get(IPC.playlists.removeItems)?.([['i-one']], none)).toBe(false);
  });

  it('Rename: only a file the one playlist holds', () => {
    expect(within(IPC.library.renamePresentation, 'p-in', 'Placeholder new name')).toBe(true);
    expect(within(IPC.library.renamePresentation, 'p-out', 'Placeholder new name')).toBe(false);
    expect(within(IPC.media.rename, 'm-in', 'Placeholder new name')).toBe(true);
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
    for (const c of [IPC.opening.setOn, IPC.opening.setChoice, IPC.opening.loadPack, IPC.opening.saveCopy]) {
      expect(SIMPLE_MODE_LOCKED).toContain(c);
      expect(answers.get(c)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    }
    for (const c of [IPC.opening.atStart, IPC.opening.ended, IPC.opening.view]) {
      expect(SIMPLE_MODE_LOCKED).not.toContain(c);
      expect(SIMPLE_MODE_BOUNDED.has(c)).toBe(false);
    }
  });
});
