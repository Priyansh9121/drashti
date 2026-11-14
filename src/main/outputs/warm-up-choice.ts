/*
 * No warm-up where Chromium draws without a graphics chip (Session 57: the owner's Q57-17 A; Session 55's Q-P1).
 * Before an output first draws the show it warms its graphics chip up, unseen (render/WarmUp.tsx), so the chip has
 * made its drawing pipelines before the first Bold push of a show. Where Chromium draws without a chip (its
 * compositing in software: CI's two-core Windows VMs with their Basic Render Driver, or a PC whose graphics driver
 * is blocked) there is nothing to warm, and the warm-up only cost time, up to its 8-s cap: after a crash the screens
 * came back in 6-10 s there. So Main reads Chromium's gpu_compositing status for each output window: `enabled…` is a
 * chip, and the output warms up exactly as before; `disabled…` or `unavailable…` is none, and the output draws the
 * show as soon as it can, told so in its context (OutputContext's noGpu). A status it cannot read warms up.
 *
 * Chromium's status means nothing until its GPU process has said how it draws (app's 'gpu-info-update', as
 * Electron's guide says): before then it says every feature is disabled, a chip or not (measured 12 Nov 2026 on a Mac
 * with a chip: disabled_software until the first update, 110-340 ms after the start, then enabled; a window can open
 * before then). So until then every output warms up as before; one that opened before then is sent its context
 * again once Chromium says it draws without a chip, and its warm-up ends there. Each output's choice is said in the
 * log once, and once more should Chromium leave its chip later (after its GPU process has stopped too often; it never
 * takes one up again): an output told to skip its warm-up is never told to warm up.
 */

import type { OutputWarmUpEnd, ScreenRole } from '../../shared/screens';

/** Chromium's gpu_compositing status in a feature status (app.getGPUFeatureStatus()), or '' where there is none. */
export function compositingOf(status: unknown): string {
  if (typeof status !== 'object' || status === null) return '';
  try {
    const value: unknown = (status as { gpu_compositing?: unknown }).gpu_compositing;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Whether an output warms up, by Chromium's feature status: not where Chromium composites without a graphics chip
 * (`disabled…`: turned off, or in software; `unavailable…`: the chip refused); with a chip (`enabled…`), or a status it
 * cannot read, exactly as before.
 */
export function warmsUp(status: unknown): boolean {
  return !/^(?:disabled|unavailable)(?:_|$)/u.test(compositingOf(status));
}

/** An output's choice as the log says it. */
export function warmUpLine(name: string, status: unknown, role?: ScreenRole): string {
  if (role === 'stage') return `Warm-up: none (stage), for ${name}`;
  const compositing = compositingOf(status);
  const what = !warmsUp(status)
    ? `skipped, no graphics chip (gpu_compositing ${compositing})`
    : compositing.startsWith('enabled')
      ? `as before, a graphics chip (gpu_compositing ${compositing})`
      : `as before, the graphics status unclear (gpu_compositing ${compositing === '' ? 'unreadable' : compositing})`;
  return `Warm-up: ${what}, for ${name}`;
}

const ENDS: readonly OutputWarmUpEnd['how'][] = ['drawn', 'cap', 'unseen', 'error', 'cut'];
const WHYS: readonly NonNullable<OutputWarmUpEnd['why']>[] = ['no-gpu', 'stage', 'other'];

/** A page's word on how its warm-up ended, checked (a page is never trusted): null when it is not one. */
export function warmUpEndOf(raw: unknown): OutputWarmUpEnd | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const how = ENDS.find((h) => h === r['how']);
  const ms = r['ms'];
  const at = r['at'];
  if (
    !how ||
    typeof ms !== 'number' ||
    !Number.isFinite(ms) ||
    typeof at !== 'number' ||
    !Number.isFinite(at)
  )
    return null;
  const why = WHYS.find((w) => w === r['why']);
  return { how, ms: Math.min(Math.max(0, Math.round(ms)), 3_600_000), at, ...(why ? { why } : {}) };
}

/**
 * How an output's warm-up ended, as the log says it once (Session 58, WU-2: the setup weekend's real figure). Never
 * "Warm-up:" itself, the start of each output's choice above.
 */
export function warmUpEndLine(name: string, end: OutputWarmUpEnd): string {
  const s = `${(end.ms / 1000).toFixed(1)} s`;
  const how =
    end.how === 'drawn'
      ? `drew everything in ${s}`
      : end.how === 'cap'
        ? `stopped at its longest, ${s}`
        : end.how === 'unseen'
          ? `ended after ${s}, its window hidden`
          : end.how === 'error'
            ? `ended after ${s} by a scene that failed as it drew`
            : `cut short after ${s}${end.why === 'no-gpu' ? ', told it draws without a graphics chip' : end.why === 'stage' ? ', a stage screen now' : ''}`;
  return `Warm-up of ${name}: ${how}`;
}

/** An open output as Main or a node keeps it: its page's id, its name for the log, how to send its context again. */
export interface WarmUpOutput {
  id: number;
  name: string;
  tell: () => void;
}

/** Main's choice for each output window (a node's for its own): see above. */
export class WarmUpChoices {
  /** Whether Chromium's GPU process has said how it draws: its status means nothing before. */
  private said = false;
  /** What each output window (by its page's id) was last given: true, it skips its warm-up, for good. */
  private readonly given = new Map<number, boolean>();
  private outputs: () => Iterable<WarmUpOutput> = () => [];

  constructor(
    private readonly deps: {
      /** Chromium's feature status now (app.getGPUFeatureStatus(); a test switch's in the tests). */
      status: () => unknown;
      log: (line: string) => void;
    },
  ) {}

  /** The outputs to tell when Chromium says how it draws (Main's, or a node's). */
  follow(outputs: () => Iterable<WarmUpOutput>): void {
    this.outputs = outputs;
  }

  /**
   * Chromium's GPU process said how it draws (app's 'gpu-info-update', each time it does): each open output's choice
   * is made (or made again), and one that now skips its warm-up is sent its context again, once.
   */
  gpuSaid(): void {
    this.said = true;
    for (const output of this.outputs()) {
      const before = this.given.get(output.id);
      if (!this.skips(output.id, output.name) || before === true) continue;
      try {
        output.tell();
      } catch (error) {
        // Its page going as Drashti quits, say: the others are still told, and nothing goes uncaught.
        this.deps.log(
          `Warm-up: its context not sent again (${error instanceof Error ? error.message : String(error)}), for ${output.name}`,
        );
      }
    }
  }

  /**
   * Whether output window `id` (`name` for the log) skips its warm-up now: only once Chromium has said it draws
   * without a graphics chip. Said in the log as it is first given, and again only if it changes.
   */
  skips(id: number, name: string, role?: ScreenRole): boolean {
    if (!this.said) return false;
    if (this.given.get(id) === true) return true;
    let status: unknown;
    try {
      status = this.deps.status();
    } catch {
      status = undefined;
    }
    const skip = !warmsUp(status);
    if (this.given.get(id) !== skip) {
      this.given.set(id, skip);
      this.deps.log(warmUpLine(name, status, role));
    }
    return skip;
  }

  /** An output window closed. */
  forget(id: number): void {
    this.given.delete(id);
  }
}

/** An output window as Main and a node keep them (the part of BrowserWindow used here). */
export interface WarmUpWindow {
  isDestroyed(): boolean;
  readonly webContents: { readonly id: number; isDestroyed(): boolean };
}

/** The window and its page are both still there (as Drashti quits, the page goes before its window). */
const alive = (win: WarmUpWindow): boolean => !win.isDestroyed() && !win.webContents.isDestroyed();

/** An output's context fact: { noGpu: true } once it skips its warm-up; nothing while it warms up as before. */
export function warmUpFact(
  choices: WarmUpChoices,
  win: WarmUpWindow | undefined,
  name: string,
  role?: ScreenRole,
): { noGpu?: true } {
  return win !== undefined && alive(win) && choices.skips(win.webContents.id, name, role)
    ? { noGpu: true }
    : {};
}

/** Follow Main's or a node's output windows (by screen, with their names): each is sent its context with `send`. */
export function followOutputs<W extends WarmUpWindow>(
  choices: WarmUpChoices,
  windows: ReadonlyMap<string, W>,
  names: ReadonlyMap<string, string>,
  send: (screenId: string, win: W) => void,
): void {
  choices.follow(() =>
    [...windows]
      .filter(([, win]) => alive(win))
      .map(([screenId, win]) => ({
        id: win.webContents.id,
        name: names.get(screenId) ?? 'an output',
        tell: () => {
          send(screenId, win);
        },
      })),
  );
}
