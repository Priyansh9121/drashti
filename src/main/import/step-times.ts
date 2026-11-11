/*
 * Where a PDF's or a deck's import spends its time, step by step (Session 56): one line in Drashti's log for each
 * such file ("Import steps: …"), never shown to the operator, which the timing check (tests/e2e/import-timing.spec.ts)
 * reads back for its table. Each step is added up over the file (a step may happen more than once, as when a deck's
 * app opens two copies).
 */

/** The steps, in the order they come. */
export const IMPORT_STEPS = [
  /** Keeping the original: its copy among the library's originals, and its SHA-256. */
  'original',
  /** Reading the deck: its slides, notes and what each one does (a .pptx). */
  'read',
  /** The deck's app starting (or found running) and opening Drashti's copy. */
  'app',
  /** Writing the timed copy the app makes its movie of. */
  'timed-copy',
  /** The app saving the deck as PDF. */
  'app-pdf',
  /** The app (or the tests' stand-in) making the deck's movie. */
  'movie',
  /** Closing Drashti's copies in the app, and quitting it when Drashti started it. */
  'app-close',
  /** FFmpeg finding each slide and step in the movie. */
  'find-steps',
  /** FFmpeg cutting each step's clip, its last frame and its hold. */
  'cut',
  /** Taking the deck's own media out and making its slides of the steps. */
  'deck',
  /** Drawing the PDF's pages as pictures. */
  'pictures',
  /** Its media into the library and its rows written. */
  'write',
] as const;

export type ImportStep = (typeof IMPORT_STEPS)[number];

export class StepTimes {
  private readonly ms = new Map<ImportStep, number>();
  private readonly started = performance.now();

  add(step: ImportStep, ms: number): void {
    this.ms.set(step, (this.ms.get(step) ?? 0) + Math.max(0, ms));
  }

  /** `work`, its time added to `step` however it ends. */
  async time<T>(step: ImportStep, work: () => Promise<T>): Promise<T> {
    const from = performance.now();
    try {
      return await work();
    } finally {
      this.add(step, performance.now() - from);
    }
  }

  /** Each step that took any time, in ms, in the steps' order, and the whole file's time since this began. */
  summary(): { steps: Partial<Record<ImportStep, number>>; totalMs: number } {
    const steps: Partial<Record<ImportStep, number>> = {};
    for (const step of IMPORT_STEPS) {
      const ms = this.ms.get(step);
      if (ms !== undefined) steps[step] = Math.round(ms);
    }
    return { steps, totalMs: Math.round(performance.now() - this.started) };
  }
}

/** The log line's start, which the timing check looks for. */
export const STEPS_LINE = 'Import steps: ';

/** The log line for a file: its name, kind and slides, and where its time went (JSON after STEPS_LINE). */
export function stepsLine(
  file: { name: string; kind: string; slides: number; how: string },
  times: StepTimes,
): string {
  return `${STEPS_LINE}${JSON.stringify({ ...file, ...times.summary() })}`;
}
