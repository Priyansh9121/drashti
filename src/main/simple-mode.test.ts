import { describe, expect, it } from 'vitest';
import type { AudioOutputStatus } from '../shared/audio';
import { allChannels, IPC } from '../shared/ipc';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../shared/mode';
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
    ]);
    for (const c of changes) if (!open.has(c)) expect(SIMPLE_MODE_LOCKED, c).toContain(c);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.engine.command);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.screens.uncoverOperator);
  });

  it('every Session 11 request that changes something: Looks, stage layouts, masks, macros (running them too), MIDI', () => {
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
      IPC.macros.save,
      IPC.macros.remove,
      IPC.macros.run,
      IPC.midi.set,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).toContain(channel);
    // Reading them is not locked, and neither is a window telling Drashti how long a file is.
    for (const channel of [
      IPC.looks.list,
      IPC.masks.list,
      IPC.macros.list,
      IPC.midi.get,
      IPC.media.reportLength,
    ])
      expect(SIMPLE_MODE_LOCKED, channel).not.toContain(channel);
    // Switching the Look is an engine command: the engine refuses it (from anywhere) in Simple Mode.
    expect(SIMPLE_MODE_REFUSED_COMMANDS).toEqual(['setLook']);
  });

  it('answers each in the shape its caller expects', () => {
    expect(answers.get(IPC.props.save)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(answers.get(IPC.library.pickImportPaths)?.()).toEqual([]);
    expect(answers.get(IPC.audio.setOutput)?.()).toBe(status);
    expect(answers.size).toBe(SIMPLE_MODE_LOCKED.length);
  });
});
