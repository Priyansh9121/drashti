import { HEVC_TYPE } from '../../shared/convert';

/*
 * Whether this computer plays HEVC video (Session 51). Chromium decodes HEVC only where the computer can (most Macs
 * do; Windows needs Microsoft's HEVC extension), and only a page can ask it. The main process asks once the operator
 * window has opened, in a page of its own (question 36: hevc-page.ts; the operator window, which Chromium would hold
 * until the GPU process has said which video decoders it has, never asks), and each import is told: where it cannot
 * play, HEVC is converted by itself, as any file Drashti cannot play; where it can, it plays as it is. The media list
 * is told too, to offer Convert (renderer converting.ts convertible). An import starting before the answer waits for
 * it (Session 51 review: a smart playlist's or the drop folder's first look, a few seconds after the start, took HEVC
 * as it was), at most HEVC_WAIT_MS.
 */

/** The longest an import waits for the answer before it goes on without it. */
export const HEVC_WAIT_MS = 15_000;

/** The question, as the media list asks it: Chromium's answer is "probably", "maybe" or nothing. */
export const PLAYS_HEVC_SCRIPT = `document.createElement('video').canPlayType(${JSON.stringify(HEVC_TYPE)})`;

/** A test's HEVC question (never a packaged Drashti's): how late its answer comes, and what it says. */
export interface HevcTest {
  /**
   * The page that asks it is held this long before it answers, as Chromium holds it until the GPU process has said
   * which video decoders it has (question 36 of Session 54: about 15 s on CI's Mac late in a run).
   */
  holdMs: number;
  /** The answer the page then gives (a test cannot rely on a real HEVC decoder), or null: Chromium's own. */
  given: boolean | null;
}

/** The question as a page runs it: the plain question, or a test's (held, and with its answer if given). */
export function playsHevcScript(test: HevcTest | null = null): string {
  if (test === null) return PLAYS_HEVC_SCRIPT;
  const answer = test.given === null ? PLAYS_HEVC_SCRIPT : JSON.stringify(test.given ? 'probably' : '');
  return `(() => { const until = Date.now() + ${String(Math.max(0, Math.round(test.holdMs)))}; while (Date.now() < until); return ${answer}; })()`;
}

/**
 * HEVC beyond its Main profile (Session 60, x36; the owner's "Yes, A": "at import, HEVC's own kind is checked"): Main 10
 * (10-bit 4:2:0) and the Range Extensions (4:2:2, 4:4:4 or 12-bit, a camera's or an editor's). A computer that plays
 * HEVC's Main may still not play these: Chromium then plays such a file as sound only, so each is asked of the page too,
 * and an import converts by itself the kind this computer cannot play.
 */
export interface HevcKinds {
  main10: boolean;
  rext: boolean;
}

/** Each kind's question, as the media type Chromium is asked about. */
export const HEVC_KIND_TYPES = {
  main10: 'video/mp4; codecs="hvc1.2.4.L93.B0"',
  rext: 'video/mp4; codecs="hvc1.4.10.L93.B0"',
} as const;

/** The kinds' question, as a page runs it: Chromium's answer for each, Main 10's then the Range Extensions'. */
export const HEVC_KINDS_SCRIPT = `[${JSON.stringify(HEVC_KIND_TYPES.main10)}, ${JSON.stringify(HEVC_KIND_TYPES.rext)}].map((t) => document.createElement('video').canPlayType(t))`;

/** The kinds' question as a page runs it: the plain one, or a test's (its answer, given, for every kind). */
export function hevcKindsScript(test: HevcTest | null = null): string {
  const given = test?.given ?? null;
  if (given === null) return HEVC_KINDS_SCRIPT;
  return JSON.stringify(given ? ['probably', 'probably'] : ['', '']);
}

/** Ask a window HEVC's other kinds (`run` runs a script in it), or null when it cannot be told. */
export async function askHevcKinds(
  run: (script: string) => Promise<unknown>,
  script: string = HEVC_KINDS_SCRIPT,
): Promise<HevcKinds | null> {
  try {
    const said = await run(script);
    if (!Array.isArray(said) || said.length !== 2 || !said.every((x) => typeof x === 'string')) return null;
    return { main10: said[0] !== '', rext: said[1] !== '' };
  } catch {
    return null;
  }
}

/** Ask a window (`run` runs a script in it): whether it plays HEVC, or null when it cannot be told. */
export async function askPlaysHevc(
  run: (script: string) => Promise<unknown>,
  script: string = PLAYS_HEVC_SCRIPT,
): Promise<boolean | null> {
  try {
    const answer = await run(script);
    return typeof answer === 'string' ? answer !== '' : null;
  } catch {
    return null;
  }
}

/**
 * Both questions as the HEVC page asks them (hevc-page.ts): whether this computer plays HEVC, then its other kinds,
 * each by `run` (a script in that page). The answer as Chromium gives it; the kinds after it, null when not asked or
 * not told within `kindsMs`.
 */
export function askHevcQuestions(
  run: (script: string) => Promise<unknown>,
  script: string,
  kindsScript: string | null,
  kindsMs: number = HEVC_KINDS_MS,
): { answer: Promise<boolean | null>; kinds: Promise<HevcKinds | null> } {
  // The answer as soon as Chromium gives it: every import waits for it (import-service.ts). In alpha.20 it waited for
  // the kinds too, and a kinds question that never came back held every import its whole wait (the owner's report of
  // 22 Nov 2026: a photo over 5 s, a video over 10 s, every time).
  const answer = askPlaysHevc(run, script);
  const kinds = answer.then((plays) => {
    if (kindsScript === null || plays === null) return null;
    // Asked after it, never holding it, and not known if Chromium does not say them in time.
    return new Promise<HevcKinds | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, kindsMs);
      void askHevcKinds(run, kindsScript).then((said) => {
        clearTimeout(timer);
        resolve(said);
      });
    });
  });
  return { answer, kinds };
}

/** The longest the HEVC page waits for Chromium to say the other kinds before they are not known. */
export const HEVC_KINDS_MS = 10_000;

/** The window's answer, as the imports wait for it: known from the start when a test gives it. */
export class HevcAnswer {
  private answer: boolean | null;
  /** Answered, or the window could not say: no import waits any more. */
  private told: boolean;
  private readonly waiting = new Set<(answer: boolean | null) => void>();

  constructor(
    given: boolean | null,
    private readonly waitMs = HEVC_WAIT_MS,
  ) {
    this.answer = given;
    this.told = given !== null;
  }

  /** The answer now: null while it is not known. */
  get now(): boolean | null {
    return this.answer;
  }

  /**
   * HEVC's other kinds (Session 60, x36), as the window said with its answer; null while not known (or given by a
   * test: then every kind is as the answer says).
   */
  kinds: HevcKinds | null = null;

  /** The window's answer (null: it could not say this time); the imports waiting go on with it. */
  tell(answer: boolean | null): void {
    if (answer !== null) this.answer = answer;
    this.told = true;
    for (const go of [...this.waiting]) go(this.answer);
  }

  /** One import has waited the whole time without an answer: the others no longer wait (alpha.20's slow imports). */
  private waitedOut = false;

  /**
   * For an import about to start: the answer at once once told, else when told, or null after the wait: one whole wait
   * at most, after which imports go on at once (a later answer still counts).
   */
  wait(): Promise<boolean | null> {
    if (this.told || this.waitedOut) return Promise.resolve(this.answer);
    return new Promise((resolve) => {
      const go = (answer: boolean | null) => {
        clearTimeout(timer);
        this.waiting.delete(go);
        resolve(answer);
      };
      const timer = setTimeout(() => {
        this.waitedOut = true;
        go(this.answer);
      }, this.waitMs);
      this.waiting.add(go);
    });
  }
}
