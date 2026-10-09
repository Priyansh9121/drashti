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
 * A node has its own (Session 17): the same menu item there, or
 * DRASHTI_SELFTEST=node-watchdog.
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
  audioPlayer: () => BrowserWindow | null;
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

/**
 * The window's picture once the compositor shows it steadily: two captures in a row alike, with
 * something bright in it (and, when given, not the picture from before). A slide the page has marked
 * painted can take a moment longer to reach the screen on a slow machine (CI's Macs), so a fixed
 * wait is not enough. After 5 s, the last capture, whatever it is.
 */
async function steadyFrame(win: BrowserWindow, notLike?: number, minBright = 50): Promise<Frame> {
  let last = await frameOf(win);
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    await sleep(100);
    const now = await frameOf(win);
    const steady = now.hash === last.hash && now.bright > minBright && now.hash !== notLike;
    last = now;
    if (steady) return now;
  }
  return last;
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

/** The engine revision the audio player follows ('' while it is loading). */
const audioRev = (win: BrowserWindow) => js<string>(win, `document.body.dataset.rev ?? ''`);

const reloads = (ctx: { watchdog: RendererWatchdog }, window: string) =>
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
    const before = await steadyFrame(output);
    const loadedAt = await js<number>(output, 'performance.timeOrigin');
    check('the output shows something', before.bright > 50, `${before.bright} bright pixels`);
    const audio = ctx.audioPlayer();
    const audioFollows = await waitFor(async () => audio !== null && (await audioRev(audio)) === rev1);
    check('the audio player follows the show', audioFollows, `revision ${rev1}`);
    const audioPid = audio?.webContents.getOSProcessId();
    const audioLoadedAt = audio ? await js<number>(audio, 'performance.timeOrigin') : 0;

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
    check(
      'the audio player (and its sound) was never touched',
      audio !== null &&
        audio.webContents.getOSProcessId() === audioPid &&
        (await js<number>(audio, 'performance.timeOrigin')) === audioLoadedAt,
    );

    // 2. The show carries on from the recovered operator window (a real key press).
    const op = ctx.operator();
    op?.webContents.focus();
    op?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    op?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    const moved = await waitFor(
      async () => ctx.engineRev() > Number(rev1) && (await paintedRev(output)) === String(ctx.engineRev()),
    );
    const next = await steadyFrame(output, before.hash);
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
    const restored = await steadyFrame(output);
    check(
      'the reloaded output shows the live slide again',
      back && restored.hash === next.hash && restored.pid !== next.pid,
      `frame ${restored.hash === next.hash ? 'matches' : 'differs'}, new process ${restored.pid !== next.pid ? 'yes' : 'no'}`,
    );

    // 4b. Hang the output (Session 23): stuck in a loop and taking no input, so Chromium's own
    // "unresponsive" never comes. Its reports stop, and it must be noticed and restarted.
    const beforeHang = ctx.watchdog.events.length;
    const hungPid = output.webContents.getOSProcessId();
    void output.webContents.executeJavaScript('for (;;) {}').catch(() => undefined);
    const noticed = await waitFor(
      () =>
        ctx.watchdog.events.slice(beforeHang).some((e) => e.window.startsWith('output') && e.kind === 'hung'),
      40_000,
    );
    check(
      'a hung output (stuck in a loop, taking no input) is noticed and restarted',
      noticed &&
        (await waitFor(() =>
          ctx.watchdog.events
            .slice(beforeHang)
            .some((e) => e.window.startsWith('output') && e.kind === 'reloaded'),
        )),
      noticed ? '' : 'no hung event within 40 s',
    );
    const revAfterHang = String(ctx.engineRev());
    const backAfterHang = noticed && (await waitFor(async () => (await paintedRev(output)) === revAfterHang));
    const afterHang = backAfterHang ? await steadyFrame(output) : null;
    check(
      'the restarted output shows the live slide again',
      afterHang !== null && afterHang.hash === next.hash && afterHang.pid !== hungPid,
    );

    // 5. Crash the audio player: the watchdog reloads it and it follows the show again.
    if (audio) {
      const audioReloadsBefore = reloads(ctx, 'audio player');
      audio.webContents.forcefullyCrashRenderer();
      check(
        'the watchdog reloads a crashed audio player',
        await waitFor(() => reloads(ctx, 'audio player') > audioReloadsBefore),
      );
      check(
        'the reloaded audio player follows the show again',
        (await waitFor(async () => (await audioRev(audio)) === String(ctx.engineRev()))) &&
          audio.webContents.getOSProcessId() !== audioPid,
      );
    }
    return { passed: checks.every((c) => c.ok), checks };
  } finally {
    ctx.dispatch({ type: 'clearAll' });
    undo();
  }
}

/**
 * A node's watchdog self-test (Session 17). A node has no show controls and
 * no sound: Main runs the show. It proves, on the node, that its screens keep
 * their last frame while its own window crashes or reloads, that the watchdog
 * brings the window back, that a crashed output comes back showing Main's
 * live slide, and that the node follows Main throughout. Main must have a
 * slide up, and one of this node's displays in a screen group.
 */
export interface NodeSelfTestContext {
  nodeWindow: () => BrowserWindow | null;
  outputs: () => BrowserWindow[];
  watchdog: RendererWatchdog;
  /** The show's revision as the node has it from Main. */
  rev: () => number;
  /** Whether the link to Main is up. */
  online: () => boolean;
}

/** Bright pixels in a node's capture (160 px wide) that say it shows something: black has none. */
const NODE_BRIGHT = 10;

const nodeWindowReady = async (ctx: NodeSelfTestContext) => {
  const win = ctx.nodeWindow();
  if (!win || win.webContents.isCrashed() || win.webContents.isLoading()) return false;
  return js<boolean>(win, `document.querySelector('[data-testid="node-window"]') !== null`);
};

export async function runNodeWatchdogSelfTest(ctx: NodeSelfTestContext): Promise<SelfTestResult> {
  const checks: SelfTestCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    checks.push({ name, ok, detail });
    return ok;
  };
  check(
    'the node follows Main',
    await waitFor(() => ctx.online(), 20_000),
    ctx.online() ? 'online' : 'not connected: start Main, or pair this node again',
  );
  await waitFor(() => ctx.outputs().length > 0);
  const output = ctx.outputs()[0] ?? null;
  if (
    !check(
      'an output window is open',
      output !== null,
      output ? '' : "none: put one of this node's displays in a screen group on Main",
    ) ||
    !output
  )
    return { passed: false, checks };
  await waitFor(
    async () =>
      (await js<string>(
        output,
        `document.querySelector('[data-testid="output-root"]')?.dataset.fonts ?? ''`,
      )) === 'ready',
  );
  check(
    "the output shows Main's live slide",
    await waitFor(async () => (await paintedRev(output)) === String(ctx.rev())),
    `revision ${String(ctx.rev())}`,
  );
  // Whatever Main has up, so long as it is not black: a node's screen may be small (a window, in tests).
  const before = await steadyFrame(output, undefined, NODE_BRIGHT);
  const loadedAt = await js<number>(output, 'performance.timeOrigin');
  check(
    'the output shows something',
    before.bright > NODE_BRIGHT,
    `${String(before.bright)} bright pixels${before.bright > NODE_BRIGHT ? '' : ': put a slide of words up on Main first'}`,
  );

  // 1. Crash the node's own window.
  const windowReloadsBefore = reloads(ctx, 'node window');
  ctx.nodeWindow()?.webContents.forcefullyCrashRenderer();
  await sleep(40);
  const during = await frameOf(output);
  check(
    "while the node's window is crashed, the output keeps the same frame",
    during.hash === before.hash && during.pid === before.pid,
    `frame ${during.hash === before.hash ? 'unchanged' : 'CHANGED'}, output process ${during.pid === before.pid ? 'unchanged' : 'CHANGED'}`,
  );
  check(
    "the watchdog reloads the node's window",
    await waitFor(() => reloads(ctx, 'node window') > windowReloadsBefore),
  );
  check("the reloaded node's window works", await waitFor(() => nodeWindowReady(ctx)));
  const after = await frameOf(output);
  check(
    'the output was never reloaded or redrawn',
    after.hash === before.hash &&
      after.pid === before.pid &&
      (await js<number>(output, 'performance.timeOrigin')) === loadedAt,
  );

  // 2. Reload the node's window: the output does not change.
  ctx.nodeWindow()?.webContents.reload();
  await sleep(40);
  const reloading = await frameOf(output);
  check(
    "while the node's window reloads, the output keeps the same frame",
    reloading.hash === before.hash && reloading.pid === before.pid,
  );
  check("the node's window comes back after a reload", await waitFor(() => nodeWindowReady(ctx)));

  // 3. Crash the output itself: the watchdog reloads it and it shows Main's live slide again.
  const fromEvent = ctx.watchdog.events.length;
  output.webContents.forcefullyCrashRenderer();
  check(
    'the watchdog reloads a crashed output',
    await waitFor(() =>
      ctx.watchdog.events
        .slice(fromEvent)
        .some((e) => e.window.startsWith('output') && e.kind === 'reloaded'),
    ),
  );
  const back = await waitFor(async () => (await paintedRev(output)) === String(ctx.rev()));
  const restored = await steadyFrame(output, undefined, NODE_BRIGHT);
  check(
    "the reloaded output shows Main's live slide again",
    back && restored.hash === before.hash && restored.pid !== before.pid,
    `frame ${restored.hash === before.hash ? 'matches' : 'differs'}, new process ${restored.pid !== before.pid ? 'yes' : 'no'}`,
  );
  check(
    'the node still follows Main',
    ctx.online(),
    ctx.online() ? `online, revision ${String(ctx.rev())}` : 'not connected',
  );
  return { passed: checks.every((c) => c.ok), checks };
}

/** Turn a ScreensResult into the id of the group it created (for undo). */
export function createdGroupId(result: ScreensResult, name: string): string | null {
  return result.ok ? (result.snapshot.groups.find((g) => g.name === name)?.id ?? null) : null;
}
