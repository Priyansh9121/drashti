import type { Heard, SpeechLanguage, SpeechState } from '../../shared/speech';
import { heardProblem, LATEST_MS, type SpeechHub } from './speech-hub';

/*
 * The real speech hub (Session 55, Part 10): the interface's rules (speech-hub.ts) kept around an engine that hears
 * the stream's sound input (whisper-engine.ts, or the test switch's stand-in). It is off until the admin's switch is
 * on (Live captions, Pro Mode, kept per computer), runs the engine only while someone listens, and stops it a few
 * seconds after the last listener goes. Its log says counts and times, never a word.
 */

/** What hears: started in a language, it gives phrases and its own state until stopped. */
export interface SpeechEngine {
  start(
    language: SpeechLanguage | 'auto',
    to: { heard(h: Heard): void; state(s: SpeechState): void },
  ): () => void;
}

export interface SpeechHubOptions {
  engine: SpeechEngine;
  log: { info(message: string): void; warn(message: string): void };
  /** How long the engine keeps running after the last listener stops (default 5 s). */
  lingerMs?: number;
  /** How often the log says how it went while listening (default 10 minutes). */
  reportEveryMs?: number;
}

/** The hub, and the admin's switch and language. */
export interface SpeechHubControl extends SpeechHub {
  setOn(on: boolean): void;
  setLanguage(language: SpeechLanguage | 'auto'): void;
  /** Drashti is quitting: the engine stops now. */
  close(): void;
}

const OFF: SpeechState = Object.freeze({ phase: 'off' });

export function createSpeechHub(options: SpeechHubOptions): SpeechHubControl {
  const lingerMs = options.lingerMs ?? 5_000;
  const reportEveryMs = options.reportEveryMs ?? 10 * 60_000;
  const listeners = new Set<{ who: string; heard: (h: Heard) => void }>();
  const watchers = new Set<(s: SpeechState) => void>();
  const failedOnce = new Set<string>();
  let on = false;
  let language: SpeechLanguage | 'auto' = 'auto';
  let current: SpeechState = OFF;
  let stopEngine: (() => void) | null = null;
  let linger: NodeJS.Timeout | null = null;
  let report: NodeJS.Timeout | null = null;
  let finals = new Set<string>();
  // Counts and times only (rule 7): finals passed on, how far behind they were, and phrases dropped late.
  let phrases = 0;
  let behindMs = 0;
  let dropped = 0;

  const say = (s: SpeechState): void => {
    if (JSON.stringify(s) === JSON.stringify(current)) return;
    // A new start of listening: ids run from s1 again.
    if (s.phase === 'listening' && current.phase !== 'listening') finals = new Set();
    current = Object.freeze({ ...s });
    for (const watcher of [...watchers]) {
      try {
        watcher(current);
      } catch {
        options.log.warn('Speech: a state watcher failed (kept).');
      }
    }
  };

  const tell = (): void => {
    if (phrases === 0 && dropped === 0) return;
    const behind = phrases === 0 ? 0 : behindMs / phrases / 1000;
    const late = dropped > 0 ? `, ${String(dropped)} dropped late` : '';
    options.log.info(
      `Speech: ${String(phrases)} phrase${phrases === 1 ? '' : 's'}, ${behind.toFixed(1)} s behind${late}.`,
    );
    phrases = 0;
    behindMs = 0;
    dropped = 0;
  };

  const heard = (h: Heard): void => {
    if (stopEngine === null || current.phase !== 'listening') return;
    if (h.heardAt - h.endAt > LATEST_MS) {
      dropped += 1;
      return;
    }
    const problem = heardProblem(h, current, finals);
    if (problem !== null) {
      // Its reasons name ids, languages and times, never words.
      options.log.warn(`Speech: a phrase from the engine was not passed on (${problem}).`);
      return;
    }
    if (h.final) {
      finals.add(h.id);
      phrases += 1;
      behindMs += Math.max(0, h.heardAt - h.endAt);
    }
    const phrase = Object.freeze({ ...h, words: Object.freeze(h.words.map((w) => Object.freeze({ ...w }))) });
    for (const { who, heard: to } of [...listeners]) {
      try {
        to(phrase);
      } catch {
        if (!failedOnce.has(who)) {
          failedOnce.add(who);
          options.log.warn(`Speech: the listener ${who} failed (kept).`);
        }
      }
    }
  };

  const stop = (): void => {
    if (linger) clearTimeout(linger);
    linger = null;
    if (report) clearInterval(report);
    report = null;
    const was = stopEngine;
    stopEngine = null;
    was?.();
    tell();
    say(OFF);
  };

  const run = (): void => {
    if (!on || listeners.size === 0) return;
    if (linger) clearTimeout(linger);
    linger = null;
    if (stopEngine !== null) return;
    say({ phase: 'starting' });
    report = setInterval(tell, reportEveryMs);
    const mine = { live: true };
    const stopIt = options.engine.start(language, {
      heard: (h) => {
        if (mine.live) heard(h);
      },
      state: (s) => {
        if (mine.live) say(s);
      },
    });
    stopEngine = () => {
      mine.live = false;
      stopIt();
    };
  };

  return {
    listen(who, to) {
      const entry = { who, heard: to };
      listeners.add(entry);
      run();
      return () => {
        if (!listeners.delete(entry) || listeners.size > 0 || stopEngine === null) return;
        linger ??= setTimeout(() => {
          linger = null;
          if (listeners.size === 0) stop();
        }, lingerMs);
      };
    },
    state: () => current,
    onState(changed) {
      watchers.add(changed);
      return () => {
        watchers.delete(changed);
      };
    },
    setOn(value) {
      if (on === value) return;
      on = value;
      if (on) run();
      else stop();
    },
    setLanguage(value) {
      if (language === value) return;
      language = value;
      if (stopEngine === null) return;
      stop();
      run();
    },
    close() {
      on = false;
      stop();
    },
  };
}
