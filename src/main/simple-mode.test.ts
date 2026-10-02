import { describe, expect, it } from 'vitest';
import type { AudioOutputStatus } from '../shared/audio';
import { allChannels, IPC } from '../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../shared/mode';
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
      /:(save|remove|restore|create|rename|apply|update|add|move|fill|set|delete|assign|import|pick|relink|new|from|make)/u.test(
        c,
      ),
    );
    // Switching the mode, the thumbnails' still-frame cache, and an event from the main process.
    const open = new Set<string>([IPC.app.setMode, IPC.media.saveStill, IPC.library.importProgress]);
    for (const c of changes) if (!open.has(c)) expect(SIMPLE_MODE_LOCKED, c).toContain(c);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.engine.command);
    expect(SIMPLE_MODE_LOCKED).not.toContain(IPC.screens.uncoverOperator);
  });

  it('answers each in the shape its caller expects', () => {
    expect(answers.get(IPC.props.save)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(answers.get(IPC.library.pickImportPaths)?.()).toEqual([]);
    expect(answers.get(IPC.audio.setOutput)?.()).toBe(status);
    expect(answers.size).toBe(SIMPLE_MODE_LOCKED.length);
  });
});
