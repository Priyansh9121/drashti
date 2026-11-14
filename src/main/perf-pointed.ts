import { app, type BrowserWindow } from 'electron';
import type { PointAt } from '../shared/point-ahead';
import { REST_MS } from '../shared/point-ahead';

/*
 * The animations scenario's cold jump as an operator makes it (C3, Session 58: Q57-26; perf-animations.ts): the
 * pointer comes to rest on the deck slide's row, and the click comes a moment later, so every screen that loads ahead
 * has the slide's first clip waiting at the frame the click starts it from. Beside it, what that clip costs each
 * window in memory: each process's memory read just before the pointer comes, and again as the click comes.
 */

/** The row the scenario's pointed jump is measured as. */
export const POINTED_ROW = 'deck slide in (step 0), pointed at first';

/**
 * From the pointer coming to rest on the row to the click (ms): a hand's move ending on a row and pressing it. The
 * operator window says the slide REST_MS after the pointer rests (playlists/point-ahead.ts), so the screens have the
 * rest of it to load.
 */
export const POINTED_LEAD_MS = 500;

/** The click whose clip plays on air while a slide is pointed at and let go of again and again (the show's safety). */
export const POINTED_ON_AIR_ROW = 'deck click, a slide pointed at and let go meanwhile';

/** How often the pointing changes while that click's clip plays (ms): each pointing loads a clip on the screens. */
export const POINTING_EVERY_MS = 300;

/** The operator window's own bridge saying the row its pointer rests on (null: none), as its rows say it. */
export const POINT_AT = (target: PointAt | null) => `(async () => {
  await globalThis.drashti.engine.pointAt(${JSON.stringify(target)});
  return true;
})()`;

/** How long after the pointer rests the operator window says the row (ms), and how long the screens then have. */
export const POINTED_SAY_MS = REST_MS;
export const POINTED_LOAD_MS = POINTED_LEAD_MS - REST_MS;

/** Each window's process and the graphics process, by name: its memory (MB, the working set; Windows's private too). */
export type WindowsMemory = Record<string, { ws: number; priv?: number }>;

/** Every process's memory now, named by the window it draws (a hall screen's by its place, the stream's page, the operator's). */
export function windowsMemory(
  outputs: readonly BrowserWindow[],
  operator: BrowserWindow | null,
  /** The stream's page while it is open (it loads the deck clips ahead too). */
  stream: Pick<BrowserWindow, 'webContents'> | null = null,
): WindowsMemory {
  const labels = new Map<number, string>();
  outputs.forEach((w, i) => {
    if (!w.isDestroyed()) labels.set(w.webContents.getOSProcessId(), `screen ${String(i + 1)}`);
  });
  if (stream && !stream.webContents.isDestroyed())
    labels.set(stream.webContents.getOSProcessId(), 'the stream’s page');
  if (operator && !operator.isDestroyed())
    labels.set(operator.webContents.getOSProcessId(), 'operator window');
  const memory: WindowsMemory = {};
  for (const m of app.getAppMetrics()) {
    const name = labels.get(m.pid) ?? (m.type === 'GPU' ? 'graphics' : null);
    if (name === null) continue;
    const was = memory[name] ?? { ws: 0 };
    const priv = m.memory.privateBytes;
    memory[name] = {
      ws: was.ws + m.memory.workingSetSize / 1024,
      ...(priv === undefined ? {} : { priv: (was.priv ?? 0) + priv / 1024 }),
    };
  }
  return memory;
}

/** What the clip pointed at added to each process, run by run (MB): after less before. */
export function memoryAdded(before: WindowsMemory, after: WindowsMemory): WindowsMemory {
  const added: WindowsMemory = {};
  for (const [name, a] of Object.entries(after)) {
    const b = before[name];
    if (!b) continue;
    added[name] = {
      ws: a.ws - b.ws,
      ...(a.priv !== undefined && b.priv !== undefined ? { priv: a.priv - b.priv } : {}),
    };
  }
  return added;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** The memory a clip pointed at cost, each process's median over the runs and its largest, for the summary. */
export function memoryLine(runs: readonly WindowsMemory[]): string {
  if (runs.length === 0) return 'not measured';
  const names = [...new Set(runs.flatMap((r) => Object.keys(r)))].sort();
  const mb = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  return names
    .map((name) => {
      const ws = runs.flatMap((r) => (r[name] ? [r[name].ws] : []));
      const priv = runs.flatMap((r) => (r[name]?.priv !== undefined ? [r[name].priv] : []));
      const privPart =
        priv.length > 0 ? `, private ${mb(median(priv))} (largest ${mb(Math.max(...priv))})` : '';
      return `${name} ${mb(median(ws))} MB (largest ${mb(Math.max(...ws))})${privPart}`;
    })
    .join(', ');
}

/**
 * While a click's clip plays on air for `forMs`: the slide pointed at, then none, then it again, every
 * POINTING_EVERY_MS from the press, ending on none (each time it is pointed at, every screen loads its clip anew).
 */
export async function pointWhileOnAir(
  operator: () => BrowserWindow | null,
  target: PointAt,
  forMs: number,
): Promise<void> {
  const say = (t: PointAt | null) => {
    const op = operator();
    return op && !op.isDestroyed()
      ? (op.webContents.executeJavaScript(POINT_AT(t), true) as Promise<unknown>).catch(() => undefined)
      : Promise.resolve();
  };
  const until = Date.now() + forMs;
  for (let on = true; Date.now() < until; on = !on) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POINTING_EVERY_MS);
    });
    await say(on ? target : null);
  }
  await say(null);
}
