/*
 * A new message from someone else while the chat's page is open (QA23-CHAT-1): a short buzz on an Android phone, a
 * short sound on an iPhone (Safari gives web pages no vibration) or on a computer, and on both a banner (ChatView).
 * A browser lets a page do neither until the person has tapped it once, so nothing is tried before that first tap;
 * an iPhone's sound is made ready inside that tap, as Safari requires. No sound file: two short tones made here.
 * A locked phone, or the browser put away, gets nothing: the page shows the messages when it is opened again.
 */

/** The buzz: two short pulses (ms on, off, on). */
export const BUZZ_MS = [120, 80, 120] as const;

/** How this phone tells of a new message: a buzz, a sound, or (before a first tap, or with neither) only the banner. */
export type AlertWay = 'buzz' | 'sound' | 'none';

/** What the page can use: where taps land, the browser's vibration, a touch screen, and Web Audio. */
export interface AlertPlace {
  target: EventTarget;
  vibrate: ((pattern: number[]) => boolean) | undefined;
  /** How many touch points the screen has (0: no touch screen, a computer). */
  touchPoints: number;
  Sound: (new () => AudioContext) | undefined;
}

/** What counts as a tap (a browser's own "user activation": touchend, pointerup, click, a key). */
const TAPS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/** The two tones (Hz) and how long each lasts (s). */
const TONES = [880, 1320] as const;
const TONE_S = 0.12;

export function makeAlerts(place: AlertPlace): { arm(): void; alert(how?: { sound?: boolean }): AlertWay } {
  let tapped = false;
  let armed = false;
  let sound: AudioContext | null = null;
  const buzzes = place.vibrate !== undefined && place.touchPoints > 0;

  /** Made, resumed and started silently inside a tap: Safari keeps a sound made any other way silent. */
  const ready = (): void => {
    if (buzzes || !place.Sound) return;
    try {
      if (!sound) {
        sound = new place.Sound();
        const silence = sound.createBufferSource();
        silence.buffer = sound.createBuffer(1, 1, 22_050);
        silence.connect(sound.destination);
        silence.start(0);
      }
      if (sound.state !== 'running') void sound.resume().catch(() => undefined);
    } catch {
      sound = null;
    }
  };

  const onTap = (): void => {
    tapped = true;
    ready();
  };

  const play = (ctx: AudioContext): void => {
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + TONES.length * TONE_S + 0.05);
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    TONES.forEach((hz, i) => {
      tone.frequency.setValueAtTime(hz, t + i * TONE_S);
    });
    tone.connect(gain);
    tone.start(t);
    tone.stop(t + TONES.length * TONE_S + 0.06);
  };

  return {
    /** Listen for the first tap (and later ones, to resume a sound a call or the lock paused). */
    arm: () => {
      if (armed) return;
      armed = true;
      for (const type of TAPS) place.target.addEventListener(type, onTap, { capture: true, passive: true });
    },
    alert: () => {
      if (!tapped) return 'none';
      if (buzzes) {
        try {
          place.vibrate?.([...BUZZ_MS]);
        } catch {
          // A browser that refuses: the banner says it.
        }
        return 'buzz';
      }
      if (!sound) return 'none';
      try {
        play(sound);
      } catch {
        return 'none';
      }
      return 'sound';
    },
  };
}

/** This page's (made on first use: none of it exists outside a browser). */
let page: ReturnType<typeof makeAlerts> | null = null;

function pageAlerts(): ReturnType<typeof makeAlerts> {
  if (!page) {
    const nav: Partial<Navigator> = typeof navigator === 'undefined' ? {} : navigator;
    const audio = globalThis as {
      AudioContext?: new () => AudioContext;
      webkitAudioContext?: new () => AudioContext;
    };
    page = makeAlerts({
      target: window,
      vibrate: typeof nav.vibrate === 'function' ? (pattern) => nav.vibrate?.(pattern) ?? false : undefined,
      touchPoints: nav.maxTouchPoints ?? 0,
      Sound: audio.AudioContext ?? audio.webkitAudioContext,
    });
  }
  return page;
}

/** Listen for the person's first tap on this page. */
export function armAlerts(): void {
  pageAlerts().arm();
}

/** Tell of a new message: a buzz or a sound, as this phone can and has been allowed. */
export function alertNewMessage(): AlertWay {
  return pageAlerts().alert();
}
