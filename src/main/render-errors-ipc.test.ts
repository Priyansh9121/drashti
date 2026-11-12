import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipc';
import { hearRenderErrors } from './render-errors-ipc';
import type { RendererWatchdog, WatchTarget } from './watchdog';

/*
 * Render errors as Main hears them from its windows (Session 23): a line in the log, one a window every 10 s at most,
 * and an output reloaded once. An error in a page's GPU warm-up (Session 57, the review of h-maskperf's MEDIUM-1)
 * ended the warm-up there, and the page draws the show without it: a line in the log saying so, on a count of its
 * own, and nothing reloaded (a reload would only warm up, and fail, again). Electron's ipcMain is stood in for.
 */

const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
vi.mock('./ipc/handle', () => ({
  handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  },
}));

const OUTPUT = 7;
const OPERATOR = 1;
const HALL = 'output "Placeholder Hall"';

/** A report as a page sends it (shared/render-errors.ts), from what its root was given. */
const report = (kind: string, message: string, component: string): unknown => ({
  where: 'output',
  kind,
  message,
  stack: null,
  componentStack: `\n    at ${component} (output.js:1:1)\n    at Output`,
});
const WARM_UP = report(
  'warm-up',
  'Error: A test asked this warm-up scene to fail as it drew',
  'FailForTests',
);
const CAUGHT = report('caught', 'Error: A test asked this output to fail as it drew', 'ThrowForTests');

function setUp() {
  handlers.clear();
  const lines: string[] = [];
  const reloads: string[] = [];
  const output = {} as WatchTarget;
  const watchdog = {
    renderError: (target: WatchTarget, name: string, reason: string) => {
      if (target === output) reloads.push(`${name}: ${reason}`);
    },
  } as unknown as RendererWatchdog;
  hearRenderErrors({
    log: (line) => lines.push(line),
    watchdog,
    windowOf: (sender) =>
      sender.id === OUTPUT ? { name: HALL, output } : { name: 'operator', output: null },
  });
  const send = (id: number, raw: unknown) =>
    handlers.get(IPC.app.renderError)?.({ sender: { id } } as unknown as IpcMainInvokeEvent, raw);
  return { lines, reloads, send };
}

describe('render errors as Main hears them', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('an error in an output’s show: one line, and the output reloaded once (as before)', () => {
    const { lines, reloads, send } = setUp();
    send(OUTPUT, CAUGHT);
    expect(lines).toEqual([
      `Render error in ${HALL} (caught): Error: A test asked this output to fail as it drew (in ThrowForTests)`,
    ]);
    expect(reloads).toEqual([`${HALL}: Error: A test asked this output to fail as it drew`]);
  });

  it('an error in a page’s warm-up: one line saying so, and nothing reloaded, the hall’s screen or any other', () => {
    const { lines, reloads, send } = setUp();
    send(OUTPUT, WARM_UP);
    send(OPERATOR, WARM_UP);
    expect(lines).toEqual([
      `Render error in ${HALL} (warm-up): Error: A test asked this warm-up scene to fail as it drew (in FailForTests)`,
      'Render error in operator (warm-up): Error: A test asked this warm-up scene to fail as it drew (in FailForTests)',
    ]);
    expect(reloads).toEqual([]);
    // Said again within 10 s (the page warmed up again, say): counted, not written again, still nothing reloaded.
    vi.setSystemTime(Date.now() + 2000);
    send(OUTPUT, WARM_UP);
    expect(lines).toHaveLength(2);
    expect(reloads).toEqual([]);
  });

  it('a warm-up’s line never holds back the line, or the reload, of an error in the show just after it', () => {
    const { lines, reloads, send } = setUp();
    send(OUTPUT, WARM_UP);
    vi.setSystemTime(Date.now() + 2000);
    send(OUTPUT, CAUGHT);
    expect(lines).toEqual([
      `Render error in ${HALL} (warm-up): Error: A test asked this warm-up scene to fail as it drew (in FailForTests)`,
      `Render error in ${HALL} (caught): Error: A test asked this output to fail as it drew (in ThrowForTests)`,
    ]);
    expect(reloads).toEqual([`${HALL}: Error: A test asked this output to fail as it drew`]);
  });

  it('a report that is not one is dropped, as before', () => {
    const { lines, reloads, send } = setUp();
    send(OUTPUT, report('later', 'Error: placeholder', 'Placeholder'));
    send(OUTPUT, null);
    expect(lines).toEqual([]);
    expect(reloads).toEqual([]);
  });
});
