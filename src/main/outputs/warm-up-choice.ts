/*
 * No warm-up where Chromium draws without a graphics chip (Session 57: the owner's Q57-17 A; Session 55's Q-P1).
 * Red: today every output warms up, a graphics chip or not, and the log says nothing of it.
 */

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

/** Whether an output warms up, by Chromium's feature status. Red: always. */
export function warmsUp(_status: unknown): boolean {
  return true;
}

/** An open output as Main or a node keeps it: its page's id, its name for the log, how to send its context again. */
export interface WarmUpOutput {
  id: number;
  name: string;
  tell: () => void;
}

/** Main's choice for each output window. Red: none skips its warm-up. */
export class WarmUpChoices {
  constructor(private readonly deps: { status: () => unknown; log: (line: string) => void }) {}

  /** The outputs to tell when Chromium says how it draws (Main's, or a node's). */
  follow(_outputs: () => Iterable<WarmUpOutput>): void {
    void this.deps;
  }

  /** Chromium's GPU process said how it draws (app's 'gpu-info-update'). */
  gpuSaid(): void {
    void this.deps;
  }

  /** Whether output window `id` skips its warm-up now. Red: never. */
  skips(_id: number, _name: string): boolean {
    return false;
  }

  /** An output window closed. */
  forget(_id: number): void {
    void this.deps;
  }
}

/** An output window as Main and a node keep them (the part of BrowserWindow used here). */
export interface WarmUpWindow {
  isDestroyed(): boolean;
  readonly webContents: { readonly id: number };
}

/** An output's context fact: { noGpu: true } once it skips its warm-up; nothing while it warms up as before. */
export function warmUpFact(
  choices: WarmUpChoices,
  win: WarmUpWindow | undefined,
  name: string,
): { noGpu?: true } {
  return win !== undefined && !win.isDestroyed() && choices.skips(win.webContents.id, name)
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
      .filter(([, win]) => !win.isDestroyed())
      .map(([screenId, win]) => ({
        id: win.webContents.id,
        name: names.get(screenId) ?? 'an output',
        tell: () => {
          send(screenId, win);
        },
      })),
  );
}
