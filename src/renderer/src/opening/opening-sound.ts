import { OPENING_MS, openingSoundCurve } from '../../../shared/opening';

/*
 * The opening pack's sound as the opening plays (alpha.16, the owner's words of 11 Nov 2026; shared/opening.ts): in the
 * operator window only, through Web Audio to this computer's own sound as the system has it, never the show's chosen
 * sound output, the stream, a node or a phone. Its loudness for the whole two seconds is given to the audio thread as
 * it starts (in from silence, gently, out to silence: openingSoundCurve), so the window's busy start never makes it
 * uneven; a longer file is silent by then and stopped, and one ended sooner (a key, a click) fades out in about a tenth
 * of a second, never cut. Its element is in the page (data-opening-sound), with how loud its way out is now (data-level,
 * dBFS, -100 for silence), as the audio player's is: for the tests.
 */

/** How often its way out is measured, and its end looked for (ms). */
const METER_MS = 50;
/** Ended sooner: it fades out over about this long (ms), then stops. */
const STOP_MS = 120;
/** Its end on the audio clock is waited for this much longer on the page's own, should that clock never run (ms). */
const LATE_MS = 1000;

export interface OpeningSoundPlayer {
  /** Ready to play from its start (or it cannot be): resolved either way. */
  ready: Promise<void>;
  /** Play it now, with the photo (once: asked again, nothing). */
  start(): void;
  /** Stop it (faded out quickly if it still sounds) and let it go. */
  stop(): void;
}

/** The sound at `url`, loading, ready to start; null where Web Audio cannot be had (then the opening has no sound). */
export function openingSound(url: string): OpeningSoundPlayer | null {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  const el = document.createElement('audio');
  el.preload = 'auto';
  // Read by Web Audio: fetched as Drashti's media scheme allows any of its pages to.
  el.crossOrigin = 'anonymous';
  el.hidden = true;
  el.dataset['openingSound'] = '';
  el.dataset['level'] = '-100';
  let graph: { source: MediaElementAudioSourceNode; shape: GainNode; end: GainNode; meter: AnalyserNode };
  try {
    graph = {
      source: context.createMediaElementSource(el),
      shape: context.createGain(),
      end: context.createGain(),
      meter: context.createAnalyser(),
    };
  } catch {
    void context.close().catch(() => undefined);
    return null;
  }
  const { source, shape, end, meter } = graph;
  shape.gain.value = 0;
  meter.fftSize = 2048;
  source.connect(shape).connect(end).connect(context.destination);
  end.connect(meter);
  // Never left waiting: the operator window plays without a gesture.
  void context.resume().catch(() => undefined);
  el.src = url;
  document.body.append(el);
  const samples = new Float32Array(meter.fftSize);
  let timer: ReturnType<typeof setInterval> | null = null;
  let late: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let gone = false;
  /** Silent: paused where it is, and measured no more. */
  const hush = () => {
    if (timer) clearInterval(timer);
    if (late) clearTimeout(late);
    timer = null;
    late = null;
    el.pause();
    el.dataset['level'] = '-100';
  };
  const ready = new Promise<void>((resolve) => {
    if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) resolve();
    el.addEventListener('canplaythrough', () => resolve(), { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
  return {
    ready,
    start() {
      if (started || gone) return;
      started = true;
      // The two seconds, or the file's own length when it is shorter.
      const length =
        Number.isFinite(el.duration) && el.duration > 0 ? Math.min(OPENING_MS, el.duration * 1000) : OPENING_MS;
      const from = context.currentTime;
      shape.gain.setValueCurveAtTime(Float32Array.from(openingSoundCurve(length)), from, length / 1000);
      void el.play().catch(() => undefined);
      timer = setInterval(() => {
        meter.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        const rms = Math.sqrt(sum / samples.length);
        el.dataset['level'] = String(rms > 0 ? Math.max(-100, Math.round(20 * Math.log10(rms))) : -100);
        // Its two seconds are over on the audio clock (silent since): stopped.
        if (context.currentTime >= from + length / 1000 + METER_MS / 1000) hush();
      }, METER_MS);
      late = setTimeout(hush, length + LATE_MS);
    },
    stop() {
      if (gone) return;
      gone = true;
      const done = () => {
        hush();
        source.disconnect();
        el.removeAttribute('src');
        el.load();
        el.remove();
        void context.close().catch(() => undefined);
      };
      if (!started || el.paused) {
        done();
        return;
      }
      // Ended sooner: out quickly, never cut.
      end.gain.setTargetAtTime(0, context.currentTime, STOP_MS / 4000);
      setTimeout(done, STOP_MS);
    },
  };
}
