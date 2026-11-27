import { expect, test, type Locator, type Page } from '@playwright/test';
import { CHAT_API } from '../../src/shared/chat';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import { launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

interface Exit {
  surface: string;
  closed: boolean;
  inert: boolean;
  hidden: string | null;
  private: boolean;
  bounded: boolean;
  timings: { ms: number; delay: number; easing: string }[];
  stopped?: boolean;
}
type ExitWindow = typeof globalThis & { surfaceExits: Exit[] };

/** Keep the closed roots only in this test, and record at animationstart so short exits cannot be missed. */
async function watchExits(win: Page, stopNextPop = false): Promise<void> {
  await win.evaluate((stop) => {
    const w = globalThis as ExitWindow;
    w.surfaceExits = [];
    const attach = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow')?.value as (
      this: Element,
      init: ShadowRootInit,
    ) => ShadowRoot;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
      const root = attach.call(this, init);
      let recorded = false;
      root.addEventListener('animationstart', () => {
        if (recorded) return;
        const copy = root.querySelector<HTMLElement>('[data-leaving]');
        const host = root.host as HTMLElement;
        if (!copy || !host.hasAttribute('data-leaving-host')) return;
        recorded = true;
        const bounds = host.getBoundingClientRect();
        const record: Exit = {
          surface: copy.classList.contains('motionui-tooltip')
            ? 'tooltip'
            : copy.classList.contains('motionui-chat-pop')
              ? 'chat'
              : (host.dataset['leavingHost'] ?? ''),
          closed: host.shadowRoot === null,
          inert: host.inert,
          hidden: host.getAttribute('aria-hidden'),
          private: host.hasAttribute('data-report-private'),
          bounded: bounds.width < innerWidth && bounds.height < innerHeight,
          timings: root.getAnimations().map((a) => {
            const timing = a.effect?.getTiming();
            const target = (a.effect as KeyframeEffect | null)?.target;
            return {
              ms: Number(timing?.duration ?? 0),
              delay: timing?.delay ?? 0,
              easing: target ? getComputedStyle(target).animationTimingFunction : '',
            };
          }),
        };
        w.surfaceExits.push(record);
        if (stop && record.surface === 'pop') {
          document.documentElement.dataset['interfaceMotion'] = 'off';
          requestAnimationFrame(() => {
            record.stopped = !host.isConnected;
          });
        }
      });
      return root;
    };
  }, stopNextPop);
}

const exits = (win: Page) => win.evaluate(() => (globalThis as ExitWindow).surfaceExits);
const style = (el: Locator) =>
  el.evaluate((node) => {
    const seen = getComputedStyle(node);
    return {
      name: seen.animationName,
      ms: Number.parseFloat(seen.animationDuration) * 1000,
      delay: seen.animationDelay,
      transition: seen.transitionDuration,
    };
  });

async function arrives(el: Locator, max: number): Promise<void> {
  const seen = await style(el);
  expect(seen.name).toBe('surface-in');
  expect(seen.ms).toBeGreaterThan(0);
  expect(seen.ms).toBeLessThanOrEqual(max);
  expect(seen.delay).toBe('0s');
}

function safeExit(record: Exit): void {
  expect(record.closed).toBe(true);
  expect(record.inert).toBe(true);
  expect(record.hidden).toBe('true');
  expect(record.timings.length).toBeGreaterThan(0);
  for (const timing of record.timings) {
    expect(timing.ms).toBeGreaterThan(0);
    expect(timing.ms).toBeLessThanOrEqual(120);
    expect(timing.delay).toBe(0);
    expect(timing.easing).toBe('cubic-bezier(0.32, 0, 0.67, 0)');
  }
}

test('Calm tooltips, menus, notices and sheets arrive and leave within budget without moving the show controls', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await expect(win.locator('html')).toHaveAttribute('data-opened', '');
    await watchExits(win);
    await openLibrary(win);
    const row = win.getByTestId('presentation-list').getByRole('button').first();
    const show = win.getByTestId('blackout-button');
    const before = await show.boundingBox();
    expect(before).not.toBeNull();

    const screens = win.getByRole('button', { name: 'Screens', exact: true });
    await screens.hover();
    const tip = win.locator('[role="tooltip"].motionui-tooltip');
    await expect(tip).toBeVisible();
    await arrives(tip, 120);
    expect(await show.boundingBox()).toEqual(before);
    await win.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);

    // Escape also closes the Library sheet that owns the row. Restore it for the menu checks.
    await expect(win.getByTestId('library-sheet')).toHaveCount(0);
    await openLibrary(win);
    await row.focus();
    await row.click({ button: 'right' });
    await arrives(win.getByRole('menu'), 180);
    await win.keyboard.press('Escape');
    await expect(row).toBeFocused();

    await screens.click();
    const sheet = win.locator('[data-motion="sheet"]');
    await expect(sheet).toBeVisible();
    await arrives(sheet, 180);
    await win.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    expect(await show.boundingBox()).toEqual(before);

    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows())
        if (w.webContents.getURL().includes('index.html'))
          w.webContents.send('app:notice', { text: 'Placeholder transient notice' });
    });
    const notice = win.getByTestId('operator-notice');
    await expect(notice).toBeVisible();
    await arrives(notice, 180);
    expect(await show.boundingBox()).toEqual(before);
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect
      .poll(async () => (await exits(win)).map((r) => r.surface))
      .toEqual(expect.arrayContaining(['tooltip', 'pop', 'sheet', 'notice']));
    for (const record of await exits(win)) safeExit(record);
    await expect(win.locator('[data-leaving-host]')).toHaveCount(0);
    expect(await show.boundingBox()).toEqual(before);
  } finally {
    await app.close();
  }
});

test('a transient containing, inside, or itself a show control stays completely still in Calm and Lively', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    for (const mode of ['calm', 'lively'] as const) {
      expect(
        await win.evaluate(
          (m: 'calm' | 'lively' | 'off') => (globalThis as PageGlobals).drashti.appearance.setMotion(m),
          mode,
        ),
      ).toEqual({ ok: true });
      await expect(win.locator('html')).toHaveAttribute('data-interface-motion', mode);
      const moving = await win.evaluate(() => {
        const fixture = document.createElement('div');
        fixture.style.cssText = 'position:fixed;top:8px;left:8px';
        for (const kind of ['scrim', 'dialog', 'sheet', 'pop', 'notice']) {
          const parent = document.createElement('div');
          parent.dataset['motion'] = kind;
          const control = document.createElement('button');
          control.dataset['showControl'] = '';
          control.textContent = 'Placeholder show control';
          const child = document.createElement('span');
          child.dataset['motion'] = kind;
          control.append(child);
          parent.append(control);
          fixture.append(parent);
          const self = control.cloneNode(true) as HTMLElement;
          self.dataset['motion'] = kind;
          fixture.append(self);
        }
        document.body.append(fixture);
        const found = [...fixture.querySelectorAll('*')].flatMap((node) => {
          const seen = getComputedStyle(node);
          return seen.animationName !== 'none' ||
            seen.transitionDuration.split(',').some((d) => Number.parseFloat(d) > 0)
            ? [`${node.tagName}: ${seen.animationName} ${seen.transitionDuration}`]
            : [];
        });
        fixture.remove();
        return found;
      });
      expect(moving, mode).toEqual([]);
    }
  } finally {
    await app.close();
  }
});

test('switching Off removes a menu exit already running inside a closed shadow root', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await openLibrary(win);
    await watchExits(win, true);
    await win.getByTestId('presentation-list').getByRole('button').first().click({ button: 'right' });
    await expect(win.getByRole('menu')).toBeVisible();
    await win.keyboard.press('Escape');
    await expect.poll(async () => (await exits(win)).find((r) => r.surface === 'pop')?.stopped).toBe(true);
    await expect(win.locator('[data-leaving-host]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('chat arrives calmly, its exit stays private, and Off or reduced motion leaves chat and tooltips still', async () => {
  const { app } = await launchApp(NETWORK_ENV);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const { port } = await networkOn(win);
    const token = await pairToken(win, port, 'remote', 'Placeholder phone');
    expect(
      (
        await apiCall(port, CHAT_API.name, {
          method: 'POST',
          token,
          body: { name: 'Placeholder Sender' },
        })
      ).status,
    ).toBe(200);
    const send = async (text: string) => {
      expect((await apiCall(port, CHAT_API.send, { method: 'POST', token, body: { text } })).status).toBe(
        200,
      );
    };
    await watchExits(win);
    const focus = win.getByTestId('blackout-button');
    await focus.focus();
    const before = await focus.boundingBox();
    await send('Placeholder calm chat');
    const chat = win.getByTestId('chat-pop');
    await expect(chat).toBeVisible();
    await arrives(chat, 180);
    await expect(focus).toBeFocused();
    expect(await focus.boundingBox()).toEqual(before);
    await win.getByTestId('chat-pop-dismiss').click();
    await expect(chat).toHaveCount(0);
    await expect.poll(async () => (await exits(win)).some((r) => r.surface === 'chat')).toBe(true);
    const record = (await exits(win)).find((r) => r.surface === 'chat');
    if (!record) throw new Error('Chat exit was not observed');
    safeExit(record);
    expect(record.private).toBe(true);
    expect(record.bounded).toBe(true);
    await expect(win.locator('[data-leaving-host]')).toHaveCount(0);

    for (const mode of ['off', 'reduced'] as const) {
      const motion: 'off' | 'lively' = mode === 'off' ? 'off' : 'lively';
      expect(
        await win.evaluate(
          (m: 'calm' | 'lively' | 'off') => (globalThis as PageGlobals).drashti.appearance.setMotion(m),
          motion,
        ),
      ).toEqual({ ok: true });
      await expect(win.locator('html')).toHaveAttribute('data-interface-motion', motion);
      if (mode === 'reduced') await win.emulateMedia({ reducedMotion: 'reduce' });
      const count = (await exits(win)).length;
      await send(`Placeholder ${mode} chat`);
      await expect(chat).toBeVisible();
      expect(await style(chat)).toMatchObject({ name: 'none', transition: '0s' });
      await win.getByTestId('chat-pop-dismiss').click();
      await expect(chat).toHaveCount(0);
      await focus.hover();
      await win.getByRole('button', { name: 'Screens', exact: true }).hover();
      const tip = win.locator('[role="tooltip"].motionui-tooltip');
      await expect(tip).toBeVisible();
      expect(await style(tip)).toMatchObject({ name: 'none', transition: '0s' });
      await win.keyboard.press('Escape');
      await expect(tip).toHaveCount(0);
      await expect(win.locator('[data-leaving-host]')).toHaveCount(0);
      expect((await exits(win)).length, mode).toBe(count);
    }
  } finally {
    await app.close();
  }
});

test('secondary desktop exits retain their original timing, curve and animation', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const defaults = await win.evaluate(() => {
      const was = document.body.className;
      const fixture = document.createElement('div');
      fixture.style.cssText = 'position:fixed;left:-9999px;top:0';
      try {
        document.body.classList.remove('operator');
        for (const kind of ['dialog', 'sheet', 'pop', 'notice']) {
          const copy = document.createElement('div');
          copy.dataset['leaving'] = kind;
          copy.append(document.createElement('div'));
          fixture.append(copy);
        }
        document.body.append(fixture);
        return [...fixture.children].flatMap((copy) => {
          const parts = [
            copy,
            ...(copy.matches('[data-leaving="dialog"], [data-leaving="sheet"]') ? copy.children : []),
          ];
          return parts.map((part) => {
            const st = getComputedStyle(part);
            return {
              kind: copy.getAttribute('data-leaving'),
              panel: part !== copy,
              name: st.animationName,
              ms: Number.parseFloat(st.animationDuration) * 1000,
              easing: st.animationTimingFunction,
            };
          });
        });
      } finally {
        fixture.remove();
        document.body.className = was;
      }
    });
    expect(defaults).toHaveLength(6);
    for (const result of defaults) {
      const sheet = result.kind === 'sheet' && result.panel;
      expect(result.name).toBe(
        result.panel
          ? sheet
            ? 'sheet-out'
            : 'drop-out'
          : result.kind === 'pop' || result.kind === 'notice'
            ? 'drop-out'
            : 'fade-out',
      );
      expect(result.ms).toBe(150);
      expect(result.easing).toBe(sheet ? 'cubic-bezier(0.32, 0.72, 0, 1)' : 'cubic-bezier(0.23, 1, 0.32, 1)');
    }
  } finally {
    await app.close();
  }
});
