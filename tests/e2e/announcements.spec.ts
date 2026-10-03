import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV, TABLET } from './devices';
import { expectFits } from './fit';
import {
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';

/*
 * Announcements from phones: sent from the poster's link (Safari on an
 * iPhone, and on an iPad), edited, approved as a message and in the ticker
 * (in step on every screen), rejected; one coming off by itself when its
 * time is up; Simple Mode refusing to approve; and one put back after a
 * crash. Placeholder words; the poster's key is made at run time and never
 * printed.
 */

/** Two windowed outputs (the second on a pretend display), so the ticker can be seen in step on both. */
const ENV = { ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

const queue = (win: Page) => ({
  list: () => win.evaluate(() => (globalThis as PageGlobals).drashti.announcements.list()),
  approve: (id: string, as: 'message' | 'ticker') =>
    win.evaluate(({ id, as }) => (globalThis as PageGlobals).drashti.announcements.approve({ id, as }), {
      id,
      as,
    }),
});

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** A new poster link's key (the part after #k=). */
function posterKey(win: Page): Promise<string> {
  return win.evaluate(async () => {
    const r = await (globalThis as PageGlobals).drashti.network.makePoster();
    if (!r.ok || !r.status.poster) throw new Error(r.ok ? 'no poster link' : r.message);
    return r.status.poster.url.split('#k=')[1] ?? '';
  });
}

/** Send one from the phone's page. */
async function send(page: Page, text: string, minutes = '10') {
  await page.getByTestId('announce-text').fill(text);
  await page.getByTestId('announce-from').fill('Placeholder name');
  await page.getByTestId('announce-minutes').selectOption(minutes);
  await page.getByTestId('announce-send').click();
  await expect(page.getByRole('status')).toContainText('waiting for the operator');
}

/**
 * How far (ms) a screen's ticker is from where the engine's clock says its
 * words should be, at the frame it last drew (the animation's own clock).
 */
const tickerOffBy = (page: Page) =>
  page.evaluate(() => {
    const words = document.querySelector<HTMLElement>('[data-testid="ticker-words"]');
    const animation = words?.getAnimations()[0];
    const pass = Number(words?.dataset['passMs']);
    const started = Number(words?.dataset['startedAt']);
    const frame = Number(document.timeline.currentTime);
    if (!animation || !(pass > 0) || !Number.isFinite(frame)) return Number.POSITIVE_INFINITY;
    const want = (performance.timeOrigin + frame - started) % pass;
    const off = Math.abs(want - (Number(animation.currentTime) % pass));
    return Math.min(off, pass - off);
  });

function twoOutputs(app: ElectronApplication): [Page, Page] {
  const [main, side] = outputPages(app);
  if (!main || !side) throw new Error('Two outputs should be open.');
  return [main, side];
}

/** Up with the operator window and two outputs, the network on, and a phone on the poster's page. */
async function setUp(env: Record<string, string> = ENV) {
  const { app, userData } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Side Hall', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const { base } = await networkOn(win);
  const key = await posterKey(win);
  const openPoster = async (name?: string) => {
    const d = await device('webkit', name);
    await d.page.goto(`${base}/announce#k=${key}`);
    await expect(d.page.getByTestId('announce-send')).toBeEnabled();
    return d;
  };
  const phone = await openPoster();
  return { app, userData, win, phone, openPoster };
}

test('from a phone: edited and approved as a message, one in the ticker in step on every screen, one rejected', async () => {
  test.setTimeout(180_000);
  const { app, win, phone, openPoster } = await setUp();
  const p = phone.page;
  const [main, side] = twoOutputs(app);
  try {
    // The poster's key leaves the address at once; the page passes the checks on a phone, at 375 x 812 and on a tablet.
    expect(p.url()).not.toContain('#k=');
    await expectNoSeriousA11yIssues(p, 'the announcements page on a phone');
    await p.setViewportSize({ width: 375, height: 812 });
    await expectNoSeriousA11yIssues(p, 'the announcements page at 375 x 812');
    const tablet = await openPoster(TABLET);
    try {
      await expectNoSeriousA11yIssues(tablet.page, 'the announcements page on a tablet');
    } finally {
      await tablet.close();
    }

    // Sent: it waits for the operator, and nothing goes on the screens.
    await send(p, 'Placeholder: prasad is in the hall after arti');
    await expect(p.getByTestId('announce-sent').first()).toContainText('Waiting for the operator');
    await expect(main.locator('[data-layer="messages"]')).toHaveCount(0);

    // The operator: the header says one is waiting; edit it, then approve it as a message.
    await win.setViewportSize({ width: 1280, height: 720 });
    const open = win.getByTestId('open-announcements');
    await expect(open).toHaveText('Announcements (1)');
    await open.click();
    const panel = win.getByTestId('announcements-panel');
    const waiting = panel.getByTestId('announcement-waiting');
    await expect(waiting).toContainText('Placeholder: prasad is in the hall after arti');
    await expectFits(panel, 'the announcements queue at 1280 x 720');
    await expectNoSeriousA11yIssues(win, 'the announcements queue');
    await waiting.getByTestId('announcement-edit').click();
    await waiting
      .getByTestId('announcement-edit-text')
      .fill('Placeholder: prasad is in the main hall after arti');
    await waiting.getByTestId('announcement-save').click();
    await expect(waiting).toContainText('edited');
    await waiting.getByTestId('announcement-as').selectOption('message');
    await waiting.getByTestId('announcement-approve').click();
    for (const output of [main, side])
      await expect(output.locator('[data-layer="messages"]')).toContainText(
        'Placeholder: prasad is in the main hall after arti',
      );
    await expect(panel.getByTestId('announcement-showing')).toContainText('On the screens');
    await p.reload();
    await expect(p.getByTestId('announce-sent').first()).toContainText('On the screens until');

    // One in the ticker: in step on both screens, from the engine's clock, with the message above its band.
    await send(p, 'Placeholder: car 12 please move');
    await expect(waiting).toContainText('car 12');
    await waiting.getByTestId('announcement-as').selectOption('ticker');
    await waiting.getByTestId('announcement-approve').click();
    for (const output of [main, side]) {
      await expect(output.getByTestId('ticker')).toContainText('Placeholder: car 12 please move');
      await expect.poll(() => tickerOffBy(output), { timeout: 15_000 }).toBeLessThan(100);
    }
    expect(await main.getByTestId('ticker-words').getAttribute('data-pass-ms')).toBe(
      await side.getByTestId('ticker-words').getAttribute('data-pass-ms'),
    );
    const message = await main.locator('[data-layer="messages"]').boundingBox();
    const band = await main.getByTestId('ticker').boundingBox();
    expect((message?.y ?? 0) + (message?.height ?? 0)).toBeLessThanOrEqual((band?.y ?? 0) + 1);

    // Black-out covers the ticker, which carries on underneath; Clear all takes it off, Put it back returns it.
    await dispatch(win, { type: 'setBlackout', on: true });
    await expect(main.getByTestId('blackout')).toBeVisible();
    await dispatch(win, { type: 'setBlackout', on: false });
    await expect.poll(() => tickerOffBy(main), { timeout: 15_000 }).toBeLessThan(100);
    await dispatch(win, { type: 'clearAll' });
    await expect(main.getByTestId('ticker')).toHaveCount(0);
    await expect(panel.getByTestId('announcement-showing').first()).toContainText('Cleared from the screens');
    await dispatch(win, { type: 'putBack' });
    await expect(main.getByTestId('ticker')).toContainText('car 12');

    // One rejected: never on the screens, and the phone says so.
    await send(p, 'Placeholder: not for the screens');
    await waiting.getByTestId('announcement-reject').click();
    await expect(waiting).toHaveCount(0);
    await expect(panel.getByTestId('announcement-earlier')).toContainText('Not shown');
    await p.reload();
    await expect(p.getByTestId('announce-sent').first()).toContainText('Not shown');
    await expect(main.getByTestId('ticker')).not.toContainText('not for the screens');

    // Taken off before its time (the message, sent first).
    await panel.getByTestId('announcement-showing').first().getByTestId('announcement-take-off').click();
    await expect(main.locator('[data-layer="messages"]')).toHaveCount(0);
    await expect(main.getByTestId('ticker')).toContainText('car 12');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('an announcement comes off by itself when its time is up; Simple Mode refuses to approve one', async () => {
  test.setTimeout(120_000);
  // A minute lasts a second here.
  const { app, win, phone } = await setUp({ ...ENV, DRASHTI_TEST_ANNOUNCE_MINUTE_MS: '1000' });
  const p = phone.page;
  const [main] = twoOutputs(app);
  const q = queue(win);
  try {
    await send(p, 'Placeholder: for five minutes', '5');
    const [first] = (await q.list()).waiting;
    expect((await q.approve(first?.id ?? '', 'ticker')).ok).toBe(true);
    await expect(main.getByTestId('ticker')).toContainText('for five minutes');
    await expect(main.getByTestId('ticker')).toHaveCount(0, { timeout: 20_000 });
    expect((await q.list()).earlier[0]).toMatchObject({ id: first?.id, status: 'ended' });
    await p.reload();
    await expect(p.getByTestId('announce-sent').first()).toContainText('Shown');

    // Simple Mode: the badge says one is waiting; approving is refused, as in the window.
    await send(p, 'Placeholder: waiting for Pro Mode');
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('network-badge')).toContainText('1 announcement waiting');
    const [second] = (await q.list()).waiting;
    const refused = await q.approve(second?.id ?? '', 'ticker');
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? '' : refused.message).toContain('Simple Mode');
    expect((await q.list()).waiting).toHaveLength(1);
    await expect(main.getByTestId('ticker')).toHaveCount(0);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('after a crash, an approved announcement is back on the screens until its time', async () => {
  test.setTimeout(180_000);
  const { app, userData, win, phone } = await setUp();
  const p = phone.page;
  const q = queue(win);
  try {
    // One in the ticker, and one as a message that the operator then cleared from the screens.
    await send(p, 'Placeholder: kept through a crash', '30');
    await send(p, 'Placeholder: cleared before the crash', '30');
    const [kept, cleared] = (await q.list()).waiting;
    expect((await q.approve(kept?.id ?? '', 'ticker')).ok).toBe(true);
    expect((await q.approve(cleared?.id ?? '', 'message')).ok).toBe(true);
    await dispatch(win, { type: 'clearLayer', layer: 'messages' });
    const [main] = twoOutputs(app);
    await expect(main.getByTestId('ticker')).toContainText('kept through a crash');
    await expect(main.locator('[data-layer="messages"]')).toHaveCount(0);
    const startedAt = (await main.getByTestId('ticker-words').getAttribute('data-started-at')) ?? '';
    // Saved, then Drashti stops dead.
    await win.waitForTimeout(1500);
    await killApp(app);

    const again = await relaunchApp(userData, ENV);
    const win2 = await operatorPage(again.app);
    await operatorReady(win2);
    await expect.poll(() => outputPages(again.app).length).toBe(2);
    for (const output of twoOutputs(again.app)) {
      await expect(output.getByTestId('ticker')).toContainText('kept through a crash');
      // In step from when it started before the crash, not from the restart.
      await expect(output.getByTestId('ticker-words')).toHaveAttribute('data-started-at', startedAt);
      await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);
    }
    await expect
      .poll(
        async () => (await win2.evaluate(() => (globalThis as PageGlobals).drashti.network.status())).state,
      )
      .toBe('listening');
    const after = await queue(win2).list();
    expect(after.showing.map((a) => a.id)).toEqual([kept?.id]);
    expect(after.earlier.map((a) => [a.id, a.status])).toEqual([[cleared?.id, 'ended']]);
    // The phone asks again and sees it is still up.
    await p.reload();
    await expect(p.getByTestId('announce-sent').nth(1)).toContainText('On the screens until');
    await again.app.close();
  } finally {
    await phone.close();
  }
});
