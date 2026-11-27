import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { settled, expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

interface FadeTrace {
  kind: string;
  root: string;
  targets: number;
  blocked: string[];
  frames: { pseudo: string; keys: string[] }[];
  done: boolean;
}
type Observed = typeof globalThis & { motionlooks: FadeTrace[] };

/** Observe real Chromium snapshots, including their targets at capture time, without replacing an animation. */
async function observe(win: Page): Promise<void> {
  await win.evaluate(() => {
    const records: FadeTrace[] = [];
    (globalThis as Observed).motionlooks = records;
    const native = document.startViewTransition.bind(document);
    const doc = document as unknown as {
      startViewTransition(change: () => void): ViewTransition;
    };
    doc.startViewTransition = (change) => {
      const root = document.documentElement;
      const trace: FadeTrace = {
        kind: root.dataset['interfaceFade'] ?? '', root: root.style.viewTransitionName,
        targets: 0, blocked: [], frames: [], done: false,
      };
      const capture = () => {
        for (const el of document.querySelectorAll<HTMLElement>('*')) {
          if (!el.style.viewTransitionName.startsWith('motionlooks-')) continue;
          trace.targets += 1;
          if (el.closest('[data-show-control], [data-testid="live-preview"], body.output') ||
              el.querySelector('[data-show-control], canvas, video'))
            trace.blocked.push(el.getAttribute('data-testid') ?? el.tagName);
        }
      };
      capture();
      records.push(trace);
      const transition = native(() => { change(); capture(); });
      void transition.ready.then(() => {
        trace.frames = document.getAnimations().flatMap((animation) => {
          const effect = animation.effect as KeyframeEffect | null;
          if (!effect?.pseudoElement?.includes('view-transition')) return [];
          return [{ pseudo: effect.pseudoElement,
            keys: [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))],
          }];
        });
      }, () => {});
      void transition.finished.then(() => { trace.done = true; }, () => { trace.done = true; });
      return transition;
    };
  });
}

async function traces(win: Page): Promise<FadeTrace[]> {
  await expect.poll(() => win.evaluate(() => (globalThis as Observed).motionlooks.every((t) => t.done))).toBe(true);
  return win.evaluate(() => (globalThis as Observed).motionlooks);
}

/** Exercise the chip-enabled interface path deterministically; output GPU tests use the actual hardware separately. */
async function chip(win: Page, motion: 'calm' | 'lively' | 'off' = 'calm'): Promise<void> {
  await win.evaluate(async (m) => {
    await (globalThis as PageGlobals).drashti.appearance.setMotion(m);
  }, motion);
  await expect(win.locator('html')).toHaveAttribute('data-interface-motion', motion);
  await win.evaluate(() => { document.documentElement.dataset['chip'] = 'yes'; });
}

function safe(records: FadeTrace[]): void {
  expect(records.length).toBeGreaterThan(0);
  for (const trace of records) {
    expect(trace.root).toBe('none');
    expect(trace.targets).toBeGreaterThan(0);
    expect(trace.blocked).toEqual([]);
    expect(trace.frames.some((frame) => frame.pseudo.includes('(root)'))).toBe(false);
    for (const frame of trace.frames)
      expect(frame.keys.filter((key) => /transform|translate|scale|width|height|top|left/iu.test(key))).toEqual([]);
  }
  expect(records.some((trace) => trace.frames.length > 0)).toBe(true);
}

test('Help’s questions fade both ways in place and become no Tab stops when off; keys on show controls stay immediate', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await chip(win);
    const help = win.getByTestId('help-toggle');
    if (await help.getAttribute('aria-pressed') === 'true') await help.dispatchEvent('click');
    await settled(win);
    const before = await win.getByTestId('show-next').boundingBox();
    await observe(win);
    await help.dispatchEvent('click');
    await expect(win.locator('[data-what-is-this]').first()).toBeVisible();
    await traces(win);
    expect(await win.getByTestId('show-next').boundingBox()).toEqual(before);
    await help.dispatchEvent('click');
    await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
    safe(await traces(win));
    expect(await win.getByTestId('show-next').boundingBox()).toEqual(before);
    expect(await win.getByTestId('show-next').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(win.locator('[data-leaving-host] [data-what-is-this]')).toHaveCount(0);
  } finally { await app.close(); }
});

test('appearance and Pro/Simple changes fade safe controls only, leaving output pictures and show controls live', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await chip(win, 'lively');
    await observe(win);
    await chooseMenuItem(app, 'appearance-white');
    await expect(win.locator('html')).toHaveAttribute('data-appearance', 'white');
    await traces(win);
    await chip(win);
    await win.getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await traces(win);
    await win.getByRole('button', { name: 'Pro Mode', exact: true }).dblclick();
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    const records = await traces(win);
    expect(records.map((t) => t.kind)).toEqual(expect.arrayContaining(['look', 'mode']));
    safe(records);
  } finally { await app.close(); }
});

test('Off, reduced motion and forced colours draw no fades; Appearance’s samples are decorative and fixed in place', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await observe(win);
    for (const hold of ['off', 'reduced', 'forced'] as const) {
      await win.emulateMedia({ reducedMotion: hold === 'reduced' ? 'reduce' : 'no-preference',
        forcedColors: hold === 'forced' ? 'active' : 'none' });
      await chip(win, hold === 'off' ? 'off' : 'calm');
      await win.getByTestId('help-toggle').dispatchEvent('click');
      await settled(win);
    }
    expect(await traces(win)).toEqual([]);
    await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    await chip(win, 'off');
    await chooseMenuItem(app, 'appearance');
    await expect(win.getByTestId('appearance-dialog')).toBeVisible();
    await expect(win.locator('[data-motion-preview]')).toHaveCount(3);
    for (const preview of await win.locator('[data-motion-preview]').all()) {
      await expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(await preview.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    }
    await expectNoSeriousA11yIssues(win, 'motion looks in Appearance');
  } finally { await app.close(); }
});
