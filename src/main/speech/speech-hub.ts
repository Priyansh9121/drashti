import { SPEECH_LANGUAGES, type Heard, type HeardWord, type SpeechState } from '../../shared/speech';

/*
 * The speech hub (Session 55, Part 10): what the stream's sound input says, for every main-process listener
 * (live captions first, then the speech helpers). The rules every listener can count on
 * (assister/s55-notes/part10-interface.md):
 * 1. Off unless an admin turned it on (Settings, Live captions). While off, listen() registers, nothing
 *    arrives, and the state is off. Pro Mode or Simple Mode does not change what the hub hears.
 * 2. It runs only while someone listens: the engine starts with the first listener and stops a few seconds
 *    after the last one stops.
 * 3. It hears the stream's sound input (before its limiter), on air or not; no sound input chosen: held,
 *    no-sound-input.
 * 4. Each phrase arrives as partials (each replaces the last with that id), then once as final. Ids run
 *    s1, s2… from each start of listening, so a listener keyed by id starts afresh when listening does.
 * 5. Every time is epoch ms on this computer's clock, a word's good to about ±0.3 s; heardAt − endAt is how
 *    far behind the engine runs, and a phrase more than 10 s behind is dropped, never sent.
 * 6. Each phrase's language is the engine's own detection among Gujarati, Hindi and English, or the one
 *    language the admin chose.
 * 7. The hub keeps words in memory only. An operator-started sound recording may save final captions
 *    as a local draft beside its audio. The log says counts and times only.
 * 8. The show comes first: the engine runs below the show's priority and stops itself when the computer is
 *    short (held, busy), and starts again by itself. A listener returns at once; one that throws is named in
 *    the log once and kept.
 * 9. Tests use generated speech of placeholder words only, never a real recording; unit tests drive
 *    createFakeSpeechHub().
 */

export interface SpeechHub {
  /** Hear speech from now on. `who` names the listener in the log ('captions', 'helper:<name>'). Returns how to stop. */
  listen(who: string, heard: (h: Heard) => void): () => void;
  /** The state now, and each change. */
  state(): SpeechState;
  /** Called at each change of the state (not at once with the state now: read state() for that). Returns how to stop. */
  onState(changed: (s: SpeechState) => void): () => void;
}

/** How far behind a phrase may be (its end to when the engine gave it) before the hub drops it. */
export const LATEST_MS = 10_000;

function isConfidence(n: number | null): boolean {
  return n === null || (Number.isFinite(n) && n >= 0 && n <= 1);
}

function isWords(text: string): boolean {
  return text.length > 0 && text.trim() === text;
}

/**
 * What is wrong with a phrase the hub never sends, or null when nothing is (added after the interface: the real hub
 * checks its engine's phrases with it too). Its words never appear in what it says.
 */
export function heardProblem(h: Heard, state: SpeechState, finals: ReadonlySet<string>): string | null {
  if (state.phase !== 'listening') {
    return `the hub is ${state.phase}, not listening: call setState({ phase: 'listening', language: 'auto' }) first`;
  }
  if (!/^s[1-9]\d*$/.test(h.id)) return `its id is ${JSON.stringify(h.id)}, not s1, s2…`;
  if (finals.has(h.id)) {
    return `phrase ${h.id} was final already: a final phrase’s id is never sent again (until listening starts again)`;
  }
  if (!(SPEECH_LANGUAGES as readonly string[]).includes(h.language)) {
    return `its language ${JSON.stringify(h.language)} is not one of ${SPEECH_LANGUAGES.join(', ')}`;
  }
  if (state.language !== 'auto' && h.language !== state.language) {
    return `its language is ${h.language}, but the admin chose ${state.language}`;
  }
  if (!isConfidence(h.languageConfidence)) return 'its language confidence is not 0 to 1, or null';
  for (const word of h.words) {
    if (!isWords(word.text)) return 'a word is empty or has spaces around it';
    if (word.text.normalize('NFC') !== word.text) return 'a word is not NFC';
    if (!isConfidence(word.confidence)) return 'a word’s confidence is not 0 to 1, or null';
  }
  if (h.text !== '' && !isWords(h.text)) return 'its text has spaces around it';
  if (h.text.normalize('NFC') !== h.text) return 'its text is not NFC';
  if (!Number.isFinite(h.startAt) || !Number.isFinite(h.endAt) || h.startAt > h.endAt) {
    return 'its times run backwards (startAt after endAt)';
  }
  let previous: HeardWord | null = null;
  for (const word of h.words) {
    if (!Number.isFinite(word.startAt) || !Number.isFinite(word.endAt) || word.startAt > word.endAt) {
      return 'a word’s times run backwards (startAt after endAt)';
    }
    if (previous && (word.startAt < previous.startAt || word.endAt < previous.endAt)) {
      return 'its words’ times run backwards';
    }
    if (word.startAt < h.startAt || word.endAt > h.endAt) return 'a word’s times fall outside its phrase’s';
    previous = word;
  }
  if (h.final && (h.words.length === 0 || h.text === '')) {
    return 'a final phrase has words and text (only a partial may have none)';
  }
  if (!Number.isFinite(h.heardAt)) return 'its heardAt is not a time';
  if (h.heardAt - h.endAt > LATEST_MS) {
    return `it is ${String(h.heardAt - h.endAt)} ms behind: the hub drops a phrase more than 10 s behind`;
  }
  return null;
}

function sameState(a: SpeechState, b: SpeechState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A frozen copy, so one listener can never change what the others are given. */
function frozen(h: Heard): Heard {
  return Object.freeze({ ...h, words: Object.freeze(h.words.map((word) => Object.freeze({ ...word }))) });
}

/**
 * For unit tests: a hub that hears only what the test says. It keeps the real hub's rules, so a test cannot
 * count on what the real one never does: it starts off; say() throws unless the state is listening, and for a
 * phrase the real hub would never send (an id sent final already, a word empty or not NFC, times running
 * backwards, another language than the admin chose, more than 10 s behind…); each listener is given a frozen
 * copy; ids may start again from s1 at each start of listening. heardAt is Date.now() unless given. A listener
 * that throws is kept and the others are still given the phrase, as in the real hub; then say() throws that
 * error, so a failed expect() inside a listener fails the test.
 */
export function createFakeSpeechHub(): SpeechHub & {
  say(h: Omit<Heard, 'heardAt'> & { heardAt?: number }): void;
  setState(s: SpeechState): void;
} {
  let current: SpeechState = Object.freeze({ phase: 'off' });
  const listeners = new Set<{ who: string; heard: (h: Heard) => void }>();
  const watchers = new Set<{ changed: (s: SpeechState) => void }>();
  let finals = new Set<string>();

  return {
    listen(who, heard) {
      if (!isWords(who))
        throw new Error(`listen(): name the listener (for the log), not ${JSON.stringify(who)}`);
      const entry = { who, heard };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    state() {
      return current;
    },
    onState(changed) {
      const entry = { changed };
      watchers.add(entry);
      return () => {
        watchers.delete(entry);
      };
    },
    say(h) {
      const phrase = frozen({ ...h, heardAt: h.heardAt ?? Date.now() });
      const problem = heardProblem(phrase, current, finals);
      if (problem !== null) throw new Error(`say(): ${problem}.`);
      if (phrase.final) finals.add(phrase.id);
      let failure: Error | null = null;
      for (const { who, heard } of [...listeners]) {
        try {
          heard(phrase);
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(`Listener ${who} threw a non-Error.`);
        }
      }
      if (failure !== null) throw failure;
    },
    setState(s) {
      if (sameState(current, s)) return;
      // A new start of listening: its ids run from s1 again.
      if (s.phase === 'listening' && current.phase !== 'listening') finals = new Set();
      current = Object.freeze({ ...s });
      for (const { changed } of [...watchers]) changed(current);
    },
  };
}
