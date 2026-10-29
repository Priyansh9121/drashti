/*
 * The operator window's own start (question 36 of Session 54: from its 650th test on, every start on CI's Mac took
 * about 15 s more, inside the operator window, before its status bar said the version, and nothing said where). The
 * window tells the main process when it first knew each thing it waits for before it draws its controls, and when it
 * drew them; the main process writes them in the log as one of the start's phase lines (main/start-phases.ts).
 */

/** The moments, on this computer's clock (ms since the epoch). */
export interface StartMarks {
  /** Its access known: let in, so the controls may show. */
  access: number;
  /** Pro or Simple Mode known. */
  mode: number;
  /** Whether the single-letter keys act, known. */
  keys: number;
  /** What Drashti is (the status bar's version), known. */
  info: number;
  /** Its controls drawn. */
  drawn: number;
}

export const START_MARKS = [
  'access',
  'mode',
  'keys',
  'info',
  'drawn',
] as const satisfies readonly (keyof StartMarks)[];

/** The marks a window sent, or null unless every one is a time on this computer's clock. */
export function parseStartMarks(raw: unknown): StartMarks | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const sent = raw as Record<string, unknown>;
  const marks: Partial<StartMarks> = {};
  for (const name of START_MARKS) {
    const at = sent[name];
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
    marks[name] = at;
  }
  return marks as StartMarks;
}
