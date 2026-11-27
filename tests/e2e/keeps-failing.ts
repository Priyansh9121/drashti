import type { ElectronApplication, Page } from '@playwright/test';
import type { MenuItem } from 'electron';
import { expect } from '@playwright/test';
import type { PageGlobals } from './helpers';

/*
 * A page that keeps failing on what is up (x53; the owner's Q60-31 bug hunt, x52's show-stoppers; Q60-50 A): the main
 * process brings a window's renderer down each time it loads something, as a file that crashes the renderer decoding
 * it would, and reads the windows Playwright cannot follow once they have crashed and loaded again. Nothing real:
 * generated media and placeholder names in the specs.
 */

/**
 * The renderer of the window whose address has `part` goes down at once, and again each time its page loads and has
 * `selector`. Killed, never dumped by Main (so Main is never held, as a real crash would not hold it); each kill counted.
 */
export async function poisonWindow(app: ElectronApplication, part: string, selector: string): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { at, sel }) => {
      const g = globalThis as { x53Crash?: Record<string, { on: boolean; kills: number[] }> };
      g.x53Crash ??= {};
      const crash = { on: true, kills: [] as number[] };
      g.x53Crash[at] = crash;
      const w = BrowserWindow.getAllWindows().find(
        (b) => !b.isDestroyed() && b.webContents.getURL().includes(at),
      );
      if (!w) return;
      const wc = w.webContents;
      const kill = () => {
        if (!crash.on || wc.isDestroyed() || wc.isCrashed()) return;
        crash.kills.push(Date.now());
        try {
          process.kill(wc.getOSProcessId(), 'SIGKILL');
        } catch {
          // Already gone.
        }
      };
      wc.on('did-finish-load', () => {
        let tries = 0;
        const timer = setInterval(() => {
          tries += 1;
          if (tries > 120 || wc.isDestroyed() || wc.isCrashed() || !crash.on) {
            clearInterval(timer);
            return;
          }
          void wc
            .executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`)
            .then((has: unknown) => {
              if (has === true) {
                clearInterval(timer);
                kill();
              }
            })
            .catch(() => undefined);
        }, 250);
      });
      kill();
    },
    { at: part, sel: selector },
  );
}

/** The poison of that window stops: its page loads and stays. */
export const poisonOff = (app: ElectronApplication, part: string) =>
  app.evaluate((_electron, at) => {
    const crash = (globalThis as { x53Crash?: Record<string, { on: boolean }> }).x53Crash?.[at];
    if (crash) crash.on = false;
  }, part);

/** How many times the poison brought that window down. */
export const poisonKills = (app: ElectronApplication, part: string) =>
  app.evaluate(
    (_electron, at) =>
      (globalThis as { x53Crash?: Record<string, { kills: number[] }> }).x53Crash?.[at]?.kills.length ?? 0,
    part,
  );

/**
 * How long a page is given to answer a read. One that goes down in the middle of a read never answers (Electron's
 * executeJavaScript then never settles: on CI's Mac, 20 Nov, x53-1120-180624-2390, a sampler waited on one such read
 * until the test's time ran out), so it is 'no answer', which the looks count as black.
 */
const READ_MS = 2000;

/** A window's state by Main: crashed, its page's answer to `script` (a string), or why there is none. */
export const askWindow = (app: ElectronApplication, part: string, script: string): Promise<string> =>
  app.evaluate(
    async ({ BrowserWindow }, { at, js, ms }) => {
      // On Main's own turn: its READ_MS timer is never made inside the call (src/main/e2e-main-evaluate.test.ts).
      await new Promise<void>((resolve) => setImmediate(resolve));
      const w = BrowserWindow.getAllWindows().find(
        (b) => !b.isDestroyed() && b.webContents.getURL().includes(at),
      );
      if (!w) return 'no window';
      if (w.webContents.isCrashed()) return 'crashed';
      const answer: unknown = await Promise.race([
        w.webContents.executeJavaScript(js).catch(() => 'no answer'),
        new Promise<string>((resolve) => setTimeout(() => resolve('no answer'), ms)),
      ]);
      return typeof answer === 'string' ? answer : JSON.stringify(answer);
    },
    { at: part, js: script, ms: READ_MS },
  );

/**
 * What a screen's page draws now, by its own markup (read by Main, so a page loaded again is read too): VIDEO, PIC, WALL
 * (the Wallpaper), BLACKOUT, or black of a kind: LOADING (its fonts), NOSCENE (its warm-up), RENDER-ERROR (a failed
 * drawing's black), BLACK-… (nothing drawn).
 */
const LOOK = `(() => {
  const base = document.querySelector('[data-testid="output-root"]');
  if (!base) return 'NOROOT';
  if (base.getAttribute('data-fonts') === 'loading') return 'LOADING';
  if (base.querySelector('[data-render-error]')) return 'RENDER-ERROR';
  const scene = base.querySelector('[data-testid="scene"]');
  if (!scene) return 'NOSCENE';
  if (base.querySelector('[data-testid="blackout"]')) return 'BLACKOUT';
  if (base.querySelector('[data-testid="wallpaper"]')) return 'WALL';
  const nothing = scene.getAttribute('data-nothing-up');
  if (nothing === 'wallpaper') return 'WALL';
  if (nothing === 'black') return 'BLACK-NOTHING-UP';
  const seen = Array.from(scene.querySelectorAll('[data-bg-slot]')).filter(
    (e) => e.dataset.state !== 'loading' && Number(getComputedStyle(e).opacity) > 0.01,
  );
  if (seen.some((e) => e instanceof HTMLVideoElement)) return 'VIDEO';
  return seen.length > 0 ? 'PIC' : 'BLACK-LOADING';
})()`;

/** What the screen `screenId` draws now (Main's read), 'crashed', or 'no window'. */
export const screenLook = (app: ElectronApplication, screenId: string) =>
  askWindow(app, `screen=${screenId}`, LOOK);

/** A look that is black: the screen draws nothing of the show (its warm-up, a failed drawing, nothing), or is down. */
export const isBlackLook = (look: string) =>
  look.startsWith('BLACK-') ||
  ['LOADING', 'NOSCENE', 'NOROOT', 'RENDER-ERROR', 'crashed', 'no window', 'no answer'].includes(look);

/** The watchdog's events so far, as "<at> <kind> <window>". */
export const watchdogEvents = (app: ElectronApplication) =>
  app.evaluate(() =>
    (
      globalThis as unknown as {
        drashtiDiagnostics: { watchdog: { events: { window: string; kind: string; at: number }[] } };
      }
    ).drashtiDiagnostics.watchdog.events.map((e) => `${String(e.at)} ${e.kind} ${e.window}`),
  );

/**
 * A menu item found by its words, clicked on Main's next turn: whether it was found. setImmediate, never a Node timer,
 * inside a call into Main (src/main/e2e-main-evaluate.test.ts, a24-nature-hang).
 */
export const clickMenu = (app: ElectronApplication, label: string) =>
  app.evaluate(
    ({ Menu }, words) =>
      new Promise<boolean>((resolve) => {
        setImmediate(() => {
          const find = (items: MenuItem[]): MenuItem | null => {
            for (const item of items) {
              if (item.label === words) return item;
              const inner = item.submenu ? find(item.submenu.items) : null;
              if (inner) return inner;
            }
            return null;
          };
          const item = find(Menu.getApplicationMenu()?.items ?? []);
          item?.click();
          resolve(item !== null);
        });
      }),
    label,
  );

/** The background up now as a page that follows the show has it (a file's id, its kind, or none). */
export async function upNow(page: Page): Promise<string> {
  const bg = (await page.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state.layers
    .background;
  if (bg === null) return 'none';
  return bg.kind === 'media' ? bg.mediaId : bg.kind;
}

/** A screen's state in Screens now (showing, stopped, missing-display…), as a page that follows the show reads it. */
export async function screenState(page: Page, screenId: string): Promise<string> {
  const s = await page.evaluate(() => (globalThis as PageGlobals).drashti.screens.get()).catch(() => null);
  return s?.status.find((x) => x.screenId === screenId)?.state ?? 'none';
}

/** Samples taken every `everyMs` in the background, until stopped. */
export function sampler<T>(
  take: () => Promise<T | null>,
  everyMs = 250,
): { stop: () => Promise<{ at: number; v: T }[]> } {
  const got: { at: number; v: T }[] = [];
  let on = true;
  const running = expect
    .poll(
      async () => {
        if (!on) return true;
        const v = await take().catch(() => null);
        if (v !== null) got.push({ at: Date.now(), v });
        return false;
      },
      { timeout: 600_000, intervals: [everyMs] },
    )
    .toBe(true);
  return {
    stop: async () => {
      on = false;
      await running;
      return got;
    },
  };
}

/** How long, in samples' time, a run of samples was `bad` (each sample until the next counts). */
export function msWhere<T>(samples: { at: number; v: T }[], bad: (v: T) => boolean): number {
  let ms = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a && b && bad(a.v)) ms += b.at - a.at;
  }
  return ms;
}

/** The runs of a list of samples in short ("+<ms> <value>" at each change), at most 40. */
export function runsOf(samples: { at: number; v: unknown }[], t0: number): string[] {
  const out: string[] = [];
  let last = '';
  for (const s of samples) {
    const v = JSON.stringify(s.v);
    if (v === last) continue;
    last = v;
    out.push(`+${String(s.at - t0)} ${v}`);
  }
  return out.slice(0, 40);
}
