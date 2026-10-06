import type { EngineState } from '../../../shared/engine/state';
import { SOUND_LIMITS } from '../../../shared/media';
import type { DeviceChoice } from '../../../shared/stream';
import type { Sound } from '../audio/sounds';
import { soundsOf } from '../audio/sounds';
import { startPlayback } from '../render/playback';
import { failureState, findDevice, setSoundState } from './camera';
import { useProgram } from './program-store';

/*
 * The stream's sound: one input (the mixer's line in), held back by the
 * delay that lines it up with the camera's picture, and, when asked,
 * Drashti's own sound (videos and audio cues) for mandirs whose mixer
 * cannot send the hall's sound back. All of it is mixed here, in the
 * stream's page, at 48 kHz: none of it reaches a loudspeaker.
 */

export const STREAM_SAMPLE_RATE = 48_000;

interface OwnSound {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** What it plays now (its start and end points and a jump, as the audio player follows them). */
  sound: Sound;
  stop: () => void;
  resync: () => void;
}

export class StreamSound {
  readonly ctx = new AudioContext({ sampleRate: STREAM_SAMPLE_RATE, latencyHint: 'playback' });
  /** Everything the stream hears. */
  private readonly mix = this.ctx.createGain();
  private readonly delay = this.ctx.createDelay(1.5);
  private readonly meter = this.ctx.createAnalyser();
  private readonly out = this.ctx.createMediaStreamDestination();
  private input: { key: string; stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null;
  private own = new Map<string, OwnSound>();
  private ownOn = false;
  private readonly samples = new Float32Array(2048);

  constructor() {
    this.meter.fftSize = 2048;
    this.delay.connect(this.mix);
    this.mix.connect(this.meter);
    this.mix.connect(this.out);
    document.body.dataset['audio'] = this.ctx.state;
    this.ctx.addEventListener('statechange', () => {
      document.body.dataset['audio'] = this.ctx.state;
    });
    void this.ctx.resume();
  }

  /** The stream's sound as a track, for the encoder. */
  track(): MediaStreamTrack | null {
    return this.out.stream.getAudioTracks()[0] ?? null;
  }

  setDelay(ms: number): void {
    this.delay.delayTime.setValueAtTime(Math.max(0, Math.min(1000, ms)) / 1000, this.ctx.currentTime);
  }

  /** The loudest point just now, in dBFS (-100 for silence). */
  level(): number {
    this.meter.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const v of this.samples) peak = Math.max(peak, Math.abs(v));
    return peak > 0 ? Math.max(-100, 20 * Math.log10(peak)) : -100;
  }

  /** Open the chosen sound input (or close it). */
  async useInput(choice: DeviceChoice | null): Promise<void> {
    const device = findDevice(choice, useProgram.getState().microphones);
    const key = choice ? (device?.id ?? 'missing') : '';
    if (this.input?.key === key) return;
    this.closeInput();
    if (!choice) {
      setSoundState('none');
      return;
    }
    if (!device) {
      setSoundState('missing');
      return;
    }
    setSoundState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.id },
          // A mixer's feed as it is: no voice-call processing.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: STREAM_SAMPLE_RATE },
        },
        video: false,
      });
      const source = this.ctx.createMediaStreamSource(stream);
      source.connect(this.delay);
      this.input = { key, stream, source };
      for (const t of stream.getAudioTracks())
        t.addEventListener('ended', () => {
          this.closeInput();
          setSoundState('missing');
        });
      setSoundState('on');
    } catch (error) {
      setSoundState(failureState(error));
    }
  }

  private closeInput(): void {
    if (!this.input) return;
    this.input.source.disconnect();
    for (const t of this.input.stream.getTracks()) t.stop();
    this.input = null;
  }

  /** Drashti's own sound in the stream: what the audio player plays, in step with it. */
  setOwnSound(on: boolean, state: EngineState | null): void {
    this.ownOn = on;
    const wanted = new Map((on && state ? soundsOf(state) : []).map((s) => [s.key, s]));
    for (const [key, own] of this.own) {
      if (wanted.has(key)) continue;
      own.stop();
      own.source.disconnect();
      own.el.remove();
      this.own.delete(key);
    }
    for (const sound of wanted.values()) {
      const current = this.own.get(sound.key);
      if (current) {
        const jumped = current.sound.seek?.at !== sound.seek?.at;
        current.sound = sound;
        if (jumped) current.resync();
        current.el.loop = sound.loop && !sound.clip;
        current.gain.gain.value = sound.volume;
        continue;
      }
      const el = document.createElement('audio');
      el.loop = sound.loop && !sound.clip;
      el.preload = 'auto';
      el.dataset['key'] = sound.key;
      document.body.append(el);
      // Into the stream's mix only (an element taken into Web Audio no longer plays out loud).
      const source = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = sound.volume;
      source.connect(gain).connect(this.mix);
      const own: OwnSound = { el, source, gain, sound, stop: () => undefined, resync: () => undefined };
      const playback = startPlayback(el, {
        mediaId: sound.mediaId,
        startedAt: sound.startedAt,
        audible: true,
        limits: SOUND_LIMITS,
        timing: () => ({ loop: own.sound.loop, clip: own.sound.clip, seek: own.sound.seek }),
      });
      own.stop = playback;
      own.resync = playback.resync;
      this.own.set(sound.key, own);
    }
  }

  /** Whether Drashti's own sound is going in. */
  get ownSound(): boolean {
    return this.ownOn;
  }
}
