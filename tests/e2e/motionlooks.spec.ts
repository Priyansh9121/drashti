import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { settled, expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';

interface FadeTrace {
  kind: string;
  root: string;
  targets: number;
  blocked: string[];
  frames: { pseudo: string; keys: string[] }[];
  done: boolean;
}
type Observed = typeof globalThis & { motionlooks: FadeTrace[] };

/** Observe the actual DOM shared by preload and renderer, plus Chromium's real snapshot animations. */
async function observe(win: Page): Promise<void> {
  await win.evaluate(() => {
    const records: FadeTrace[] = [];
    (globalThis as Observed).motionlooks = records;
    const root = document.documentElement;
    let current: FadeTrace | undefined;
    const capture = (trace: FadeTrace) => {
      for (const el of document.querySelectorAll<HTMLElement>('*')) {
        if (!el.style.viewTransitionName.startsWith('motionlooks-')) continue;
        trace.targets += 1;
        if (
          el.closest('[data-show-control], [data-testid="live-preview"], body.output') ||
          el.querySelector('[data-show-control], canvas, video')
        )
          trace.blocked.push(el.getAttribute('data-testid') ?? el.tagName);
      }
      for (const animation of document.getAnimations()) {
        const effect = animation.effect as KeyframeEffect | null;
        if (!effect?.pseudoElement?.includes('view-transition')) continue;
        if (trace.frames.some((frame) => frame.pseudo === effect.pseudoElement)) continue;
        trace.frames.push({
          pseudo: effect.pseudoElement,
          keys: [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))],
        });
      }
    };
    const observer = new MutationObserver(() => {
      const kind = root.dataset['interfaceFade'];
      if (current && kind === current.kind) return;
      if (current) current.done = true;
      current = undefined;
      if (!kind) return;
      const trace: FadeTrace = {
        kind,
        root: root.style.viewTransitionName,
        targets: 0,
        blocked: [],
        frames: [],
        done: false,
      };
      current = trace;
      records.push(trace);
      const look = () => {
        if (trace.done) return;
        capture(trace);
        requestAnimationFrame(look);
      };
      look();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-interface-fade'] });
  });
}

async function traces(win: Page): Promise<FadeTrace[]> {
  await expect
    .poll(() => win.evaluate(() => (globalThis as Observed).motionlooks.every((t) => t.done)))
    .toBe(true);
  return win.evaluate(() => (globalThis as Observed).motionlooks);
}

/** Exercise the chip-enabled interface path deterministically; output GPU tests use the actual hardware separately. */
async function chip(win: Page, motion: 'calm' | 'lively' | 'off' = 'calm'): Promise<boolean> {
  await win.evaluate(async (m) => {
    await (globalThis as PageGlobals).drashti.appearance.setMotion(m);
  }, motion);
  await expect(win.locator('html')).toHaveAttribute('data-interface-motion', motion);
  const actual = await win.locator('html').getAttribute('data-chip');
  await letTimePass(win, 850, 'the show-change guard is quiet before testing interface motion');
  await win.evaluate(() => {
    document.documentElement.dataset['chip'] = 'yes';
  });
  return actual === 'yes';
}

function safe(records: FadeTrace[]): void {
  expect(records.length).toBeGreaterThan(0);
  for (const trace of records) {
    expect(trace.root).toBe('none');
    expect(trace.targets).toBeGreaterThan(0);
    expect(trace.blocked).toEqual([]);
    expect(trace.frames.some((frame) => frame.pseudo.includes('(root)'))).toBe(false);
    for (const frame of trace.frames)
      expect(
        frame.keys.filter((key) => /transform|translate|scale|width|height|top|left/iu.test(key)),
      ).toEqual([]);
  }
  expect(records.some((trace) => trace.frames.length > 0)).toBe(true);
}

test('Help’s questions fade both ways in place and become no Tab stops when off; keys on show controls stay immediate', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await chip(win);
    const help = win.getByTestId('help-toggle');
    if ((await help.getAttribute('aria-pressed')) === 'true') await help.dispatchEvent('click');
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
    expect(
      await win.getByTestId('show-next').evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBe(0);
    await expect(win.locator('[data-leaving-host] [data-what-is-this]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('appearance and Pro/Simple changes fade safe controls only, leaving output pictures and show controls live', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    const realChip = await chip(win, 'lively');
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
    expect(records.some((t) => t.kind === 'look')).toBe(realChip);
    expect(records.some((t) => t.kind === 'mode')).toBe(true);
    safe(records);
  } finally {
    await app.close();
  }
});

test('Off, reduced motion and forced colours draw no fades; Appearance’s samples are decorative and fixed in place', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await observe(win);
    for (const hold of ['off', 'reduced', 'forced'] as const) {
      await win.emulateMedia({
        reducedMotion: hold === 'reduced' ? 'reduce' : 'no-preference',
        forcedColors: hold === 'forced' ? 'active' : 'none',
      });
      await chip(win, hold === 'off' ? 'off' : 'calm');
      await win.getByTestId('help-toggle').dispatchEvent('click');
      await settled(win);
    }
    expect(await traces(win)).toEqual([]);
    await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    await chip(win, 'off');
    await chooseMenuItem(app, 'appearance-window');
    await expect(win.getByTestId('appearance-dialog')).toBeVisible();
    await expect(win.locator('[data-motion-preview]')).toHaveCount(3);
    for (const preview of await win.locator('[data-motion-preview]').all()) {
      await expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(await preview.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    }
    await expectNoSeriousA11yIssues(win, 'motion looks in Appearance');
  } finally {
    await app.close();
  }
});

test('Appearance’s Calm and Lively samples answer hover with opacity alone, in the same fixed room', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await chip(win);
    await chooseMenuItem(app, 'appearance-window');
    await expect(win.getByTestId('appearance-dialog')).toBeVisible();
    await settled(win);
    for (const motion of ['calm', 'lively'] as const) {
      const choice = win.locator(`[data-motion-choice="${motion}"]`);
      const preview = choice.locator('[data-motion-preview]');
      await choice.scrollIntoViewIfNeeded();
      await win.mouse.move(1, 1);
      const before = await preview.boundingBox();
      const played = win.evaluate(
        (id) =>
          new Promise<string[]>((resolve) => {
            const started = (event: AnimationEvent) => {
              const target = event.target;
              if (
                !(target instanceof HTMLElement) ||
                !target.matches('[data-motion-preview-picture]') ||
                target.closest('[data-motion-preview]')?.getAttribute('data-motion-preview') !== id
              )
                return;
              document.removeEventListener('animationstart', started);
              resolve(
                target
                  .getAnimations()
                  .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
                  .flatMap((frame) => Object.keys(frame)),
              );
            };
            document.addEventListener('animationstart', started);
          }),
        motion,
      );
      await choice.hover();
      const keys = await played;
      expect(keys).toContain('opacity');
      expect(keys.filter((key) => /transform|translate|scale|width|height|top|left/iu.test(key))).toEqual([]);
      expect(await preview.boundingBox()).toEqual(before);
    }
  } finally {
    await app.close();
  }
});
