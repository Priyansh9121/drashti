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
  /** Its own volume (0 to 1), which a fade works towards. */
  volume: number;
  fadeOutMs: number;
  /** A fade under way. */
  fade: ReturnType<typeof setInterval> | null;
}

/** Ramp an element's volume to `to` over `ms` (an audio playlist's short fades); then `done`. */
function fadeTo(player: Player, to: number, ms: number, done?: () => void): void {
  if (player.fade) clearInterval(player.fade);
  player.fade = null;
  const from = player.el.volume;
  if (ms <= 0 || from === to) {
    player.el.volume = to;
    done?.();
    return;
  }
  const start = performance.now();
  player.fade = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / ms);
    player.el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t >= 1) {
      if (player.fade) clearInterval(player.fade);
      player.fade = null;
      done?.();
    }
  }, 25);
}

/** Players fading out after they stopped (still sounding for a moment). */
const fadingOut = new Set<Player>();

const players = new Map<string, Player>();
let sinkId = '';
let chosen: AudioDevice | null = null;

function play(state: EngineState | null): void {
  const wanted = new Map((state ? soundsOf(state) : []).map((s) => [s.key, s]));
  for (const [key, player] of players) {
    if (wanted.has(key)) continue;
    players.delete(key);
    const end = () => {
      fadingOut.delete(player);
      player.stop();
      player.el.remove();
    };
    // An audio playlist's track fades out (it was paused, moved on, or cleared); other sounds stop at once.
    if (player.fadeOutMs > 0) {
      fadingOut.add(player);
      fadeTo(player, 0, player.fadeOutMs, end);
    } else end();
  }
  for (const sound of wanted.values()) {
    const current = players.get(sound.key);
    if (current) {
      current.el.loop = sound.loop;
      if (current.volume !== sound.volume) {
        current.volume = sound.volume;
        if (!current.fade) current.el.volume = sound.volume;
      }
      continue;
    }
    const el = document.createElement('audio');
    el.loop = sound.loop;
    el.volume = sound.fadeInMs ? 0 : sound.volume;
    el.preload = 'auto';
    el.dataset['key'] = sound.key;
    el.dataset['mediaId'] = sound.mediaId;
    document.body.append(el);
    void el.setSinkId(sinkId).catch(() => undefined);
    // Sound jumps later, and changes speed less, than pictures do: a skip or a pitch change is heard.
    const player: Player = {
      el,
      volume: sound.volume,
      fadeOutMs: sound.fadeOutMs ?? 0,
      fade: null,
      stop: () => undefined,
    };
    player.stop = startPlayback(el, {
      mediaId: sound.mediaId,
      startedAt: sound.startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      // An audio playlist's track fades in once it has its first sound.
      ...(sound.fadeInMs
        ? {
            onFrame: () => {
              fadeTo(player, player.volume, sound.fadeInMs ?? 0);
            },
          }
        : {}),
    });
    players.set(sound.key, player);
  }
  document.body.dataset['fading'] = String(fadingOut.size);
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
    await Promise.all(
      [...players.values(), ...fadingOut].map((p) => p.el.setSinkId(sinkId).catch(() => undefined)),
    );
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
// The setup wizard's test tone: a short, soft beep on the output being tried (nothing is chosen yet).
window.drashti.audio.onTestTone((deviceId) => {
  void playTestTone(deviceId);
});

async function playTestTone(deviceId: string): Promise<void> {
  const ctx = new AudioContext();
  // Through an audio element, which can play on any output (as every sound here does).
  const out = ctx.createMediaStreamDestination();
  const el = new Audio();
  try {
    await ctx.resume();
    el.srcObject = out.stream;
    await el.setSinkId(deviceId);
    const tone = ctx.createOscillator();
    const level = ctx.createGain();
    tone.frequency.value = 440;
    level.gain.setValueAtTime(0, ctx.currentTime);
    level.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    level.gain.setValueAtTime(0.2, ctx.currentTime + 0.7);
    level.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    tone.connect(level).connect(out);
    await el.play();
    tone.start();
    tone.stop(ctx.currentTime + 0.8);
    // For tests and diagnostics: where the last test tone played.
    document.body.dataset['testTone'] = deviceId === '' ? 'default' : deviceId;
    await new Promise((resolve) => setTimeout(resolve, 900));
  } catch {
    document.body.dataset['testTone'] = 'failed';
  } finally {
    el.pause();
    el.srcObject = null;
    await ctx.close();
  }
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  void findOutputs();
});
void window.drashti.audio.getOutput().then((status) => {
  chosen = status.chosen;
  return findOutputs();
});
