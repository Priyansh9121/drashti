import type { AudioDevice } from '../../../shared/audio';
import { resolveOutput } from '../../../shared/audio';
import type { EngineState } from '../../../shared/engine/state';
import { SOUND_LIMITS } from '../../../shared/media';
import { connectEngine, useEngine } from '../engine/engine-store';
import { startPlayback } from '../render/playback';
import { soundsOf } from './sounds';

/*
 * The audio player: the one place Drashti makes sound. A hidden window of
 * its own (so an operator-window crash never cuts the sound), it follows the
 * show engine like an output and plays every sound on the output the
 * operator chose, in step with the pictures.
 */

interface Player {
  el: HTMLAudioElement;
  stop: () => void;
}

const players = new Map<string, Player>();
let sinkId = '';
let chosen: AudioDevice | null = null;

function play(state: EngineState | null): void {
  const wanted = new Map((state ? soundsOf(state) : []).map((s) => [s.key, s]));
  for (const [key, player] of players) {
    if (wanted.has(key)) continue;
    player.stop();
    player.el.remove();
    players.delete(key);
  }
  for (const sound of wanted.values()) {
    const current = players.get(sound.key);
    if (current) {
      current.el.loop = sound.loop;
      current.el.volume = sound.volume;
      continue;
    }
    const el = document.createElement('audio');
    el.loop = sound.loop;
    el.volume = sound.volume;
    el.preload = 'auto';
    el.dataset['key'] = sound.key;
    el.dataset['mediaId'] = sound.mediaId;
    document.body.append(el);
    void el.setSinkId(sinkId).catch(() => undefined);
    // Sound jumps later, and changes speed less, than pictures do: a skip or a pitch change is heard.
    const stop = startPlayback(el, {
      mediaId: sound.mediaId,
      startedAt: sound.startedAt,
      audible: true,
      limits: SOUND_LIMITS,
    });
    players.set(sound.key, { el, stop });
  }
}

/** Look at the sound outputs, play on the chosen one (or the default), and tell the operator. */
async function findOutputs(): Promise<void> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const devices = all
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== '')
    .map((d) => ({ id: d.deviceId, label: d.label || 'Sound output' }));
  let { sinkId: next, state } = resolveOutput(chosen, devices);
  if (next !== '') {
    // Make sure the output can really be used before moving every sound to it.
    const probe = new Audio();
    await probe.setSinkId(next).catch(() => {
      next = '';
      state = 'missing';
    });
  }
  if (next !== sinkId) {
    sinkId = next;
    await Promise.all([...players.values()].map((p) => p.el.setSinkId(sinkId).catch(() => undefined)));
  }
  document.body.dataset['sinkId'] = sinkId;
  document.body.dataset['output'] = state;
  await window.drashti.audio.reportDevices(devices, state);
}

connectEngine();
useEngine.subscribe((view) => {
  play(view.state);
  // For the watchdog self-test: the revision this window follows.
  document.body.dataset['rev'] = String(view.rev);
});
window.drashti.audio.onChosen((device) => {
  chosen = device;
  void findOutputs();
});
navigator.mediaDevices.addEventListener('devicechange', () => {
  void findOutputs();
});
void window.drashti.audio.getOutput().then((status) => {
  chosen = status.chosen;
  return findOutputs();
});
