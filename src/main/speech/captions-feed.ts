import {
  CAPTION_LINE_CHARS,
  captionLines,
  type CaptionSettings,
  type CaptionsShown,
} from '../../shared/captions';
import { toGujaratiScript } from '../../shared/scripts';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import type { SpeechHub } from './speech-hub';

/*
 * Live captions (Session 55, Part 10): the speech hub's first listener. It turns what is heard into the one or two
 * lines the screens draw (engine state 26, set as bookkeeping), at most every few hundred milliseconds, and takes
 * them off a few seconds after the last words, or at once when the hub stops listening. It keeps only the phrase
 * being heard and the one before it, in memory. A local sound recording can receive final phrases for its draft.
 */

export interface CaptionsFeedOptions {
  hub: SpeechHub;
  /** Put the lines on the screens (the engine's setCaptions), or take them off (null). */
  show: (captions: CaptionsShown | null) => void;
  /** The local sound recorder can save settled phrases while this feed is on. */
  onFinalPhrase?: (phrase: Heard) => void;
  /** The library's captions settings, read at each change. */
  settings: () => CaptionSettings;
  /** Captions go this long after the last words (default 6 s). */
  clearAfterMs?: number;
  /** At most one change of the screens in this long (default 300 ms). */
  minGapMs?: number;
}

export interface CaptionsFeed {
  /** Listen (the admin turned captions on). */
  start(): void;
  /** Stop listening, and take the captions off. */
  stop(): void;
  /** The settings changed: draw the lines again with them. */
  refresh(): void;
}

interface Phrase {
  id: string;
  words: readonly string[];
  language: SpeechLanguage;
}

export function createCaptionsFeed(options: CaptionsFeedOptions): CaptionsFeed {
  const clearAfterMs = options.clearAfterMs ?? 6_000;
  const minGapMs = options.minGapMs ?? 300;
  let unlisten: (() => void) | null = null;
  let unwatch: (() => void) | null = null;
  let before: Phrase | null = null;
  let now: Phrase | null = null;
  let shownAt = Number.NEGATIVE_INFINITY;
  let trailing: NodeJS.Timeout | null = null;
  let clear: NodeJS.Timeout | null = null;
  let showing = false;

  const lines = (): CaptionsShown | null => {
    const latest = now ?? before;
    if (latest === null) return null;
    const settings = options.settings();
    const max = CAPTION_LINE_CHARS[settings.size];
    // Each phrase starts on a line of its own; the one before stays above it while it is spoken (roll-up).
    const shown = [
      ...(before && now ? captionLines(before.words, max) : []),
      ...captionLines(latest.words, max),
    ];
    const kept = shown.slice(Math.max(0, shown.length - 2));
    if (kept.length === 0) return null;
    return {
      lines: kept,
      language: latest.language,
      audience: settings.audience,
      size: settings.size,
      place: settings.place,
    };
  };

  const put = (): void => {
    if (trailing) clearTimeout(trailing);
    trailing = null;
    shownAt = Date.now();
    const captions = lines();
    showing = captions !== null;
    options.show(captions);
  };

  const soon = (): void => {
    const wait = shownAt + minGapMs - Date.now();
    if (wait <= 0) put();
    else trailing ??= setTimeout(put, wait);
  };

  const off = (): void => {
    before = null;
    now = null;
    if (trailing) clearTimeout(trailing);
    trailing = null;
    if (clear) clearTimeout(clear);
    clear = null;
    if (showing) {
      showing = false;
      shownAt = Date.now();
      options.show(null);
    }
  };

  const heard = (h: Heard): void => {
    const sanskrit = h.language === 'sa';
    // The screens and recording draft share these converted words and the original capture times.
    const words = sanskrit
      ? h.words.map((word) => ({ ...word, text: toGujaratiScript(word.text).normalize('NFC') }))
      : h.words;
    const phrase: Phrase = { id: h.id, words: words.map((w) => w.text), language: h.language };
    if (h.final) {
      before = phrase;
      now = null;
      options.onFinalPhrase?.(sanskrit ? { ...h, words, text: phrase.words.join(' ') } : h);
    } else {
      // A new phrase: the last one (heard whole, or as far as it got) goes above it.
      if (now !== null && now.id !== h.id) before = now;
      now = phrase;
    }
    if (clear) clearTimeout(clear);
    clear = setTimeout(off, clearAfterMs);
    soon();
  };

  return {
    start() {
      if (unlisten) return;
      unlisten = options.hub.listen('captions', heard);
      unwatch = options.hub.onState((s) => {
        if (s.phase !== 'listening') off();
      });
    },
    stop() {
      unlisten?.();
      unwatch?.();
      unlisten = null;
      unwatch = null;
      off();
      // Off whatever was shown before this run (a restart's state, a test's).
      options.show(null);
    },
    refresh() {
      if (showing) put();
    },
  };
}
