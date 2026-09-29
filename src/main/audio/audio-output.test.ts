import { describe, expect, it } from 'vitest';
import type { AudioDevice, AudioOutputStatus } from '../../shared/audio';
import { resolveOutput } from '../../shared/audio';
import { openDatabase } from '../db/database';
import { SettingsRepo } from '../db/settings';
import { AudioOutput } from './audio-output';

const mixer: AudioDevice = { id: 'mixer-id', label: 'Placeholder Mixer (USB)' };
const speakers: AudioDevice = { id: 'speakers-id', label: 'Built-in speakers' };

function setup(saved?: unknown) {
  const events = {
    saved: [] as (AudioDevice | null)[],
    chosen: [] as (AudioDevice | null)[],
    status: [] as AudioOutputStatus[],
    log: [] as string[],
  };
  const output = new AudioOutput({
    load: () => saved,
    save: (d) => events.saved.push(d),
    chosen: (d) => events.chosen.push(d),
    status: (s) => events.status.push(s),
    log: (m) => events.log.push(m),
  });
  return { output, events };
}

describe('choosing the sound output', () => {
  it('plays on the chosen output when it is connected, found by id or by name', () => {
    expect(resolveOutput(mixer, [speakers, mixer])).toEqual({ sinkId: 'mixer-id', state: 'chosen' });
    // The system gave the same device a new id: it is found by its name.
    expect(resolveOutput(mixer, [speakers, { id: 'new-id', label: mixer.label }])).toEqual({
      sinkId: 'new-id',
      state: 'chosen',
    });
    expect(resolveOutput(null, [speakers])).toEqual({ sinkId: '', state: 'default' });
    // Missing: the system default plays, and the state says so.
    expect(resolveOutput(mixer, [speakers])).toEqual({ sinkId: '', state: 'missing' });
  });

  it('remembers the choice, tells the audio player, and tells the operator', () => {
    const { output, events } = setup();
    expect(output.status).toEqual({ chosen: null, devices: [], state: 'default', checked: false });
    output.report([speakers, mixer], 'default');
    const status = output.choose(mixer);
    expect(status).toMatchObject({ chosen: mixer, state: 'chosen', checked: true });
    expect(events.saved).toEqual([mixer]);
    expect(events.chosen).toEqual([mixer]);
    expect(events.status.at(-1)).toEqual(status);
    output.choose(null);
    expect(events.saved.at(-1)).toBeNull();
    expect(output.status.state).toBe('default');
  });

  it('starts from the remembered choice, and says when that output is missing', () => {
    const { output, events } = setup(mixer);
    expect(output.chosen).toEqual(mixer);
    output.report([speakers], 'missing');
    expect(output.status).toMatchObject({
      chosen: mixer,
      devices: [speakers],
      state: 'missing',
      checked: true,
    });
    expect(events.log.join('\n')).toMatch(/not connected; playing on the system default/);
  });

  it('ignores anything that is not a device or a known state', () => {
    const { output, events } = setup({ id: 42 });
    expect(output.chosen).toBeNull();
    output.choose({ id: '', label: 'x' });
    output.choose('mixer');
    output.report([{ id: 'x', label: 'y', extra: true }], 'chosen');
    output.report([speakers], 'loud');
    expect(events.saved).toEqual([]);
    expect(events.status).toEqual([]);
  });

  it('keeps the choice in the library settings', () => {
    const db = openDatabase(':memory:');
    const settings = new SettingsRepo(db);
    expect(settings.get('audioOutput')).toBeUndefined();
    settings.set('audioOutput', mixer);
    settings.set('audioOutput', speakers);
    expect(new SettingsRepo(db).get('audioOutput')).toEqual(speakers);
    settings.set('audioOutput', null);
    expect(settings.get('audioOutput')).toBeNull();
    db.prepare("UPDATE app_meta SET value = 'not json' WHERE key = 'setting.audioOutput'").run();
    expect(settings.get('audioOutput')).toBeUndefined();
  });
});
