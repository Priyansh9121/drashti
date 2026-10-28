import { describe, expect, it } from 'vitest';
import type { AudioOutputStatus } from '../shared/audio';
import { allChannels, IPC } from '../shared/ipc';
import { initialEngineState } from '../shared/engine/state';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS, simpleModeRefuses } from '../shared/mode';
import { SIMPLE_MODE_LOCKED, simpleModeRefusals } from './simple-mode';

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
    for (const c of changes) if (!open.has(c)) expect(SIMPLE_MODE_LOCKED, c).toContain(c);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.engine.command);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.screens.uncoverOperator);
    // Simple Mode's own first steps (Sessions 31–36) are kept seen through channels it allows; the welcome's
    // (Pro Mode's) stays locked.
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.app.simpleFirstRun);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.app.simpleFirstRunSeen);
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.setup.welcomeSeen);
  });

  it('every Session 11 request that changes something: Looks, stage layouts, masks, MIDI', () => {
    for (const channel of [
      IPC.looks.create,
      IPC.looks.rename,
      IPC.looks.remove,
      IPC.looks.move,
      IPC.looks.setGroup,
      IPC.stageLayouts.save,
      IPC.stageLayouts.remove,
      IPC.masks.save,
      IPC.masks.remove,
      IPC.midi.set,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    // Reading them is not locked, and neither is a window telling Drashti how long a file is.
    for (const channel of [IPC.looks.list, IPC.masks.list, IPC.midi.get, IPC.media.reportLength])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
    // Switching the Look is an engine command: the engine refuses it (from anywhere) in Simple Mode, as it
    // does zooming the live picture (Session 26e, Pro Mode's), setting up, swapping or moving a
    // picture-in-picture box (Session 50; taking one off is not refused), choosing a video input (Session 50:
    // Pro Mode's Media puts one up; Simple Mode may clear it, as any background), and the time bar's move and the
    // skips (Session 54: Simple Mode shows the bar only).
    expect(SIMPLE_MODE_REFUSED_COMMANDS).toEqual([
      'setLook',
      'zoomLive',
      'resetLiveZoom',
      'showPip',
      'swapPip',
      'placePip',
      'showInput',
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
      { layer: 'props', propId: 'placeholder-prop', mediaId: 'placeholder-video' },
      { layer: 'logo', mediaId: 'placeholder-video' },
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
    // As before: a marker jump and Music's own buttons are not refused; switching the Look is.
    expect(simpleModeRefuses({ type: 'jumpToMarker', layer: 'background', markerId: 'm1' }, sound)).toBe(
      false,
    );
    expect(simpleModeRefuses({ type: 'pauseMusic' }, music)).toBe(false);
    expect(simpleModeRefuses({ type: 'resumeMusic' }, music)).toBe(false);
    expect(simpleModeRefuses({ type: 'setLook', lookId: 'placeholder-look' }, none)).toBe(true);
    expect(simpleModeRefuses({ type: 'next' }, none)).toBe(false);
  });

  it('every Session 12 request that changes something', () => {
    for (const channel of [
      IPC.shastra.setTheme,
      IPC.shastra.remove,
      IPC.playlists.editSlot,
      IPC.playlists.setTimers,
      IPC.calendar.remove,
      IPC.idle.saveSettings,
      IPC.idle.saveQuote,
      IPC.idle.removeQuote,
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
      IPC.idle.view,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
  });

  // Session 37 (WCAG 2.1.4): Simple Mode never turns the single-letter keys on or off; it still asks whether they act.
  it('the single-letter keys’ switch; whether they act is still answered', () => {
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.app.setSingleKeys);
    expect(answers.get(IPC.app.setSingleKeys)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.app.singleKeys);
  });

  it('answers each in the shape its caller expects', () => {
    expect(answers.get(IPC.props.save)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(answers.get(IPC.library.pickImportPaths)?.()).toEqual([]);
    expect(answers.get(IPC.audio.setOutput)?.()).toBe(status);
    expect(answers.size).toBe(SIMPLE_MODE_LOCKED.length);
  });

  it('the Access List’s edits, answered in their own shape; reading the list and saving its CSV are not (Session 54, E4)', () => {
    for (const channel of [
      IPC.accessList.add,
      IPC.accessList.approve,
      IPC.accessList.reject,
      IPC.accessList.revoke,
      IPC.accessList.regrant,
      IPC.accessList.changeLength,
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
});
