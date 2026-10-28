import { describe, expect, it, vi } from 'vitest';
import type { VideoInput, VideoInputsView } from '../../../shared/video-inputs';
import { connectVideoInputs, useVideoInputs } from './video-inputs-store';
import { inputOfName } from './words';

/*
 * The operator window's list of this computer's video inputs (Session 51): not read until the main process has
 * said, so a playlist item's or a slide's input never reads as "not on this computer" for the moment the window
 * takes to open. The main process is stood in for by a fake; placeholder names only.
 */

describe('the operator window’s video inputs', () => {
  it('are not read until the main process has said; until then no input counts as missing', async () => {
    let answer: (view: VideoInputsView) => void = () => undefined;
    const listed = new Promise<VideoInputsView>((resolve) => {
      answer = resolve;
    });
    (globalThis as { window?: unknown }).window = {
      drashti: {
        videoInputs: {
          onChanged: () => undefined,
          onStatus: () => undefined,
          list: () => listed,
          status: () => new Promise(() => undefined),
        },
      },
    };
    expect(useVideoInputs.getState().inputs).toBeNull();
    connectVideoInputs();
    const named = (name: string) => inputOfName(useVideoInputs.getState().inputs, name);
    expect(named('Input 1')).toBe('unread');
    const one: VideoInput = { id: 'a', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' };
    answer({ inputs: [one] });
    await expect.poll(() => useVideoInputs.getState().inputs).toEqual([one]);
    expect(named('Input 1')).toEqual(one);
    expect(named('Input 2')).toBeNull();
  });

  it('says which cameras it sees, by name, once Drashti may use them, and again as one is plugged in (Session 54)', async () => {
    vi.resetModules();
    const said: string[][] = [];
    let plugged: () => void = () => undefined;
    let access: 'not-determined' | 'granted' = 'not-determined';
    let status: (s: { stopped: null; access: typeof access }) => void = () => undefined;
    const devices = [
      { kind: 'videoinput', label: 'Placeholder camera', deviceId: 'cam-1' },
      { kind: 'audioinput', label: 'Placeholder microphone', deviceId: 'mic-1' },
    ];
    (globalThis as { window?: unknown }).window = {
      drashti: {
        videoInputs: {
          onChanged: () => undefined,
          onStatus: (listener: typeof status) => {
            status = listener;
          },
          list: () => Promise.resolve({ inputs: [] }),
          status: () => Promise.resolve({ stopped: null, access }),
          cameras: (names: string[]) => {
            said.push(names);
            return Promise.resolve(null);
          },
        },
      },
    };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: () => Promise.resolve(devices),
        addEventListener: (_what: string, listener: () => void) => {
          plugged = listener;
        },
      },
    });
    const store = await import('./video-inputs-store');
    store.connectVideoInputs();
    // Not yet allowed: nothing looked for, nothing said.
    await new Promise((resolve) => setTimeout(resolve, 0));
    plugged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(said).toEqual([]);
    // Allowed: its cameras by name, microphones left out.
    access = 'granted';
    status({ stopped: null, access });
    await expect.poll(() => said).toEqual([['Placeholder camera']]);
    devices.push({ kind: 'videoinput', label: 'Placeholder capture card', deviceId: 'cap-1' });
    plugged();
    await expect.poll(() => said.at(-1)).toEqual(['Placeholder camera', 'Placeholder capture card']);
    vi.unstubAllGlobals();
  });
});
