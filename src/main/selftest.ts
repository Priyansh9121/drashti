import type { BrowserWindow } from 'electron';
import type { EngineCommand } from '../shared/engine/commands';
import type { ScreensResult } from '../shared/screens';
import type { RendererWatchdog } from './watchdog';

/*
 * Watchdog self-test. Proves, on the real machine, that the screens keep
 * their last frame when the operator window crashes or reloads, that the
 * watchdog brings a crashed window back, and that the show carries on.
 *
 * Run it from Diagnostics > Run Watchdog Self-Test (DRASHTI_DIAGNOSTICS=1),
 * or headless with DRASHTI_SELFTEST=watchdog (prints the result and exits).
 */

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  passed: boolean;
  checks: SelfTestCheck[];
}

export interface SelfTestContext {
  operator: () => BrowserWindow | null;
  outputs: () => BrowserWindow[];
  watchdog: RendererWatchdog;
  dispatch: (command: EngineCommand) => { ok: boolean };
  engineRev: () => number;
  firstPresentationId: () => string | null;
  /** Make sure at least one output is showing; returns an undo function. */
  ensureOutput: () => Promise<() => void>;
}

interface Frame {
  hash: number;
  bright: number;
  pid: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(what: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await what()) return true;
    } catch {
      // The page may be mid-reload; try again.
    }
    await sleep(50);
  }
  return false;
}

/** What the compositor drew for this window: a hash of its pixels and how many are bright. */
async function frameOf(win: BrowserWindow): Promise<Frame> {
  const bitmap = (await win.webContents.capturePage()).resize({ width: 160, quality: 'good' }).toBitmap();
  let hash = 0;
  let bright = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    const b = bitmap[i] ?? 0;
    const g = bitmap[i + 1] ?? 0;
    const r = bitmap[i + 2] ?? 0;
    if (Math.max(r, g, b) > 180) bright++;
    hash = (hash * 31 + r + g * 257 + b * 65537) % 2147483647;
  }
  return { hash, bright, pid: win.webContents.getOSProcessId() };
}

const js = <T>(win: BrowserWindow, code: string) =>
  win.webContents.executeJavaScript(code, true) as Promise<T>;

const paintedRev = (win: BrowserWindow) =>
  js<string>(win, `document.querySelector('[data-testid="output-root"]')?.dataset.paintedRev ?? ''`);

const operatorReady = async (ctx: SelfTestContext) => {
  const op = ctx.operator();
  if (!op || op.webContents.isCrashed() || op.webContents.isLoading()) return false;
  return js<boolean>(op, `document.querySelectorAll('[data-testid="presentation-list"] button').length > 0`);
};

const reloads = (ctx: SelfTestContext, window: string) =>
  ctx.watchdog.events.filter((e) => e.window === window && e.kind === 'reloaded').length;

export async function runWatchdogSelfTest(ctx: SelfTestContext): Promise<SelfTestResult> {
  const checks: SelfTestCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const undo = await ctx.ensureOutput();
  try {
    const presentationId = ctx.firstPresentationId();
    const output = await (async () => {
      await waitFor(() => ctx.outputs().length > 0);
      return ctx.outputs()[0] ?? null;
    })();
    if (!check('an output window is open', output !== null) || !output || !presentationId)
      return { passed: false, checks };
    await waitFor(
      async () =>
        (await js<string>(
          output,
          `document.querySelector('[data-testid="output-root"]')?.dataset.fonts ?? ''`,
        )) === 'ready',
    );
    await waitFor(() => operatorReady(ctx));

    ctx.dispatch({ type: 'goLive', presentationId, slideIndex: 0 });
    const rev1 = String(ctx.engineRev());
    check(
      'the first slide reaches the output',
      await waitFor(async () => (await paintedRev(output)) === rev1),
      `revision ${rev1}`,
    );
    await sleep(150);
    const before = await frameOf(output);
    const loadedAt = await js<number>(output, 'performance.timeOrigin');
    check('the output shows something', before.bright > 50, `${before.bright} bright pixels`);

    // 1. Crash the operator window's renderer.
    const operatorReloadsBefore = reloads(ctx, 'operator');
    ctx.operator()?.webContents.forcefullyCrashRenderer();
    await sleep(40);
    const during = await frameOf(output);
    check(
      'while the operator is crashed, the output keeps the same frame',
      during.hash === before.hash && during.pid === before.pid,
      `frame ${during.hash === before.hash ? 'unchanged' : 'CHANGED'}, output process ${during.pid === before.pid ? 'unchanged' : 'CHANGED'}`,
    );
    check(
      'the watchdog reloads the operator window',
      await waitFor(() => reloads(ctx, 'operator') > operatorReloadsBefore),
    );
    check('the reloaded operator window works', await waitFor(() => operatorReady(ctx)));
    const after = await frameOf(output);
    check(
      'the output was never reloaded or redrawn',
      after.hash === before.hash &&
        after.pid === before.pid &&
        (await js<number>(output, 'performance.timeOrigin')) === loadedAt,
    );

    // 2. The show carries on from the recovered operator window (a real key press).
    const op = ctx.operator();
    op?.webContents.focus();
    op?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    op?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    const moved = await waitFor(
      async () => ctx.engineRev() > Number(rev1) && (await paintedRev(output)) === String(ctx.engineRev()),
    );
    await sleep(150);
    const next = await frameOf(output);
    check(
      'Next in the recovered operator window updates the output',
      moved && next.hash !== before.hash && next.pid === before.pid,
    );

    // 3. Reload the operator window: the output does not change.
    ctx.operator()?.webContents.reload();
    await sleep(40);
    const reloading = await frameOf(output);
    check(
      'while the operator reloads, the output keeps the same frame',
      reloading.hash === next.hash && reloading.pid === next.pid,
    );
    check('the operator window comes back after a reload', await waitFor(() => operatorReady(ctx)));

    // 4. Crash the output itself: the watchdog reloads it and it shows the live slide again.
    const outName = ctx.watchdog.events.length;
    output.webContents.forcefullyCrashRenderer();
    const outputReloaded = await waitFor(() =>
      ctx.watchdog.events.slice(outName).some((e) => e.window.startsWith('output') && e.kind === 'reloaded'),
    );
    check('the watchdog reloads a crashed output', outputReloaded);
    const revNow = String(ctx.engineRev());
    const back = await waitFor(async () => (await paintedRev(output)) === revNow);
    await sleep(150);
    const restored = await frameOf(output);
    check(
      'the reloaded output shows the live slide again',
      back && restored.hash === next.hash && restored.pid !== next.pid,
      `frame ${restored.hash === next.hash ? 'matches' : 'differs'}, new process ${restored.pid !== next.pid ? 'yes' : 'no'}`,
    );
    return { passed: checks.every((c) => c.ok), checks };
  } finally {
    ctx.dispatch({ type: 'clearAll' });
    undo();
  }
}

/** Turn a ScreensResult into the id of the group it created (for undo). */
export function createdGroupId(result: ScreensResult, name: string): string | null {
  return result.ok ? (result.snapshot.groups.find((g) => g.name === name)?.id ?? null) : null;
}
