import type { AudioDevice } from '../../../shared/audio';
import { resolveOutput } from '../../../shared/audio';
import type { EngineState } from '../../../shared/engine/state';
import { playbackSpanMs, SOUND_LIMITS } from '../../../shared/media';
import { musicAside, StepAside } from '../../../shared/sound';
import { connectEngine, useEngine } from '../engine/engine-store';
import { engineNow } from '../render/clock';
import { startPlayback } from '../render/playback';
import { type Sound, soundMoved, soundsOf } from './sounds';

/*
 * The audio player: the one place Drashti makes sound. A hidden window of
 * its own (so an operator-window crash never cuts the sound), it follows the
 * show engine like an output and plays every sound on the output the
 * operator chose, in step with the pictures.
 *
 * Session 55, Part 7 (shared/sound.ts): every sound goes through Web Audio, each through a gain of its own, so a file
 * plays at its even loudness (a quiet one made louder than an element's volume can) and the music steps aside under a
 * video with sound, fading over about a second. Its element's volume still carries its own volume and fades.
 */

interface Player {
  el: HTMLAudioElement;
  stop: () => void;
  /** Its own volume (0 to 1), which a fade works towards. */
  volume: number;
  fadeOutMs: number;
  /** A fade under way. */
  fade: ReturnType<typeof setInterval> | null;
  /** The sound as the show has it now (its start and end points, a jump). */
  sound: Sound;
  resync: () => void;
  /** Its gain (Part 7): even loudness, and the music stepping aside; null where Web Audio could not be had. */
  level: GainNode | null;
  /** What its gain was last given (-1: nothing yet). */
  levelSet: number;
}

/** How often the music's step aside and each file's gain are looked at (ms). */
const LEVEL_MS = 50;

/** An AudioContext that can play on a chosen output (Chromium's setSinkId, which TypeScript's DOM types lack). */
type SinkContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

/**
 * Every sound's way out (Part 7): one AudioContext on the chosen output, made with the first sound. Null where it
 * could not be made (each file then plays as it is, straight to the output, as before Part 7).
 */
let context: SinkContext | null = null;
let contextTried = false;
/** What every sound goes through on its way out, and a meter on it (for the self-tests and the tests: data-level). */
let master: GainNode | null = null;
let meter: AnalyserNode | null = null;

function audioContext(): AudioContext | null {
  if (contextTried) return context;
  contextTried = true;
  try {
    const made: SinkContext = new AudioContext();
    if (typeof made.setSinkId !== 'function') {
      void made.close();
      return null;
    }
    master = made.createGain();
    meter = made.createAnalyser();
    meter.fftSize = 2048;
    master.connect(made.destination);
    master.connect(meter);
    // Never left waiting: the page plays without a gesture, and an output that came back carries on.
    made.addEventListener('statechange', () => {
      if (made.state === 'suspended') void made.resume();
    });
    void made.resume();
    context = made;
    void playOn(sinkId);
  } catch {
    context = null;
  }
  return context;
}

/** The context's output: the chosen one, or the system default when it cannot be used. */
async function playOn(id: string): Promise<void> {
  const set = context?.setSinkId?.bind(context);
  if (!set) return;
  await set(id).catch(() => set('').catch(() => undefined));
}

/** The music's own level as it steps aside and comes back (Part 7, K). */
const aside = new StepAside();
let levels: ReturnType<typeof setInterval> | null = null;
const meterSamples = new Float32Array(2048);

/** Give a player's gain its level: its file's even gain, times the music's step aside for the music. */
function setLevel(player: Player, musicLevel: number): void {
  const value = Math.round((player.sound.gain ?? 1) * (player.sound.aside ? musicLevel : 1) * 1000) / 1000;
  if (player.levelSet === value) return;
  const first = player.levelSet < 0;
  player.levelSet = value;
  // For the tests and diagnostics: the gain this sound plays with now.
  player.el.dataset['gain'] = String(value);
  const c = context;
  // Its first level at once; after that, smoothly (a few milliseconds), so no change clicks.
  if (player.level && c) {
    if (first) player.level.gain.value = value;
    else player.level.gain.setTargetAtTime(value, c.currentTime, 0.015);
  }
}

/** The music's level now, and every player's gain to go with it (each LEVEL_MS while anything plays). */
function applyLevels(): void {
  const now = engineNow();
  const musicLevel = aside.levelAt(musicAside(useEngine.getState().state, now), now);
  for (const player of [...players.values(), ...fadingOut]) setLevel(player, musicLevel);
  document.body.dataset['aside'] = String(musicLevel < 1);
  if (meter) {
    meter.getFloatTimeDomainData(meterSamples);
    let sum = 0;
    for (const v of meterSamples) sum += v * v;
    const rms = Math.sqrt(sum / meterSamples.length);
    // For the tests: how loud the way out is now (dBFS, -100 for silence).
    document.body.dataset['level'] = String(
      rms > 0 ? Math.max(-100, Math.round(20 * Math.log10(rms))) : -100,
    );
  }
  if (players.size === 0 && fadingOut.size === 0 && levels) {
    clearInterval(levels);
    levels = null;
  }
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

/**
 * How loud a deck's video or sound is where it plays now (Session 54, C2): its own volume, faded in from its start
 * point and out before its end point as its deck says, by where the element is (which the engine's time keeps it at).
 */
function fadedVolume(player: Player): number {
  const f = player.sound.fades;
  const el = player.el;
  if (!f || !Number.isFinite(el.duration) || el.duration <= 0) return player.volume;
  const { start, end } = playbackSpanMs(player.sound.clip, el.duration * 1000);
  const at = el.currentTime * 1000;
  const k = Math.min(1, f.inMs > 0 ? (at - start) / f.inMs : 1, f.outMs > 0 ? (end - at) / f.outMs : 1);
  return Math.max(0, Math.min(1, player.volume * k));
}

/** How often a deck's fades are applied (ms). */
const DECK_FADE_MS = 50;

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
      player.level?.disconnect();
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
      // A jump, or new start or end points: it lands there at once, with its picture (Session 52).
      const moved = soundMoved(current.sound, sound);
      current.sound = sound;
      if (moved) current.resync();
      current.el.loop = sound.loop && !sound.clip;
      if (current.volume !== sound.volume) {
        current.volume = sound.volume;
        if (!current.fade) current.el.volume = sound.volume;
      }
      continue;
    }
    const el = document.createElement('audio');
    el.loop = sound.loop && !sound.clip;
    el.volume = sound.fadeInMs || sound.fades?.inMs ? 0 : sound.volume;
    el.preload = 'auto';
    // Read by Web Audio (Part 7): the file is fetched as Drashti's media scheme allows any of its pages to.
    el.crossOrigin = 'anonymous';
    el.dataset['key'] = sound.key;
    el.dataset['mediaId'] = sound.mediaId;
    document.body.append(el);
    // Through its own gain to the chosen output (Part 7); straight out where Web Audio could not be had.
    const c = audioContext();
    let level: GainNode | null = null;
    if (c && master) {
      try {
        level = c.createGain();
        c.createMediaElementSource(el).connect(level).connect(master);
      } catch {
        level = null;
      }
    }
    if (!level) void el.setSinkId(sinkId).catch(() => undefined);
    // Sound jumps later, and changes speed less, than pictures do: a skip or a pitch change is heard.
    const player: Player = {
      el,
      volume: sound.volume,
      fadeOutMs: sound.fadeOutMs ?? 0,
      fade: null,
      sound,
      stop: () => undefined,
      resync: () => undefined,
      level,
      levelSet: -1,
    };
    // Its level before it makes a sound: the music already aside under a video playing, a file at its even loudness.
    const now = engineNow();
    setLevel(player, aside.levelAt(musicAside(useEngine.getState().state, now), now));
    const playback = startPlayback(el, {
      mediaId: sound.mediaId,
      startedAt: sound.startedAt,
      audible: true,
      limits: SOUND_LIMITS,
      timing: () => ({ loop: player.sound.loop, clip: player.sound.clip, seek: player.sound.seek }),
      // An audio playlist's track fades in once it has its first sound.
      ...(sound.fadeInMs
        ? {
            onFrame: () => {
              fadeTo(player, player.volume, sound.fadeInMs ?? 0);
            },
          }
        : {}),
    });
    // A deck's fades (Session 54, C2), by where it plays, while it plays.
    const deckFade = sound.fades
      ? setInterval(() => {
          if (!player.fade) player.el.volume = fadedVolume(player);
        }, DECK_FADE_MS)
      : null;
    player.stop = () => {
      if (deckFade) clearInterval(deckFade);
      playback();
    };
    player.resync = playback.resync;
    players.set(sound.key, player);
  }
  document.body.dataset['fading'] = String(fadingOut.size);
  // The gains follow at once (a file measured, a video come or gone), then every LEVEL_MS while anything plays.
  applyLevels();
  if (!levels && (players.size > 0 || fadingOut.size > 0)) levels = setInterval(applyLevels, LEVEL_MS);
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
    await Promise.all([
      playOn(sinkId),
      ...[...players.values(), ...fadingOut]
        .filter((p) => !p.level)
        .map((p) => p.el.setSinkId(sinkId).catch(() => undefined)),
    ]);
  }
  document.body.dataset['sinkId'] = sinkId;
  document.body.dataset['output'] = state;
  await window.drashti.audio.reportDevices(devices, state);
}

connectEngine('silent');
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
