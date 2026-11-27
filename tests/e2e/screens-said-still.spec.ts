import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { stopAnswering } from './access';
import { fitFaults } from './fit';
import { launchApp, letTimePass, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The screens' one line in the status bar (alpha.24, lead 2's screensaid; the release lead's rules): "No screen is set to
 * Stage." as Stage goes on with no Stage screen, a display plugged in given its job, the computer mirroring its screen.
 * Until alpha.24 it came in the window's flow under the top bar, and the whole window under it moved some 50 px down as
 * it came, the LIVE picture, Back, Next, Oops and every column (and the LIVE block, its column shorter, went from
 * standing still to scrolling). Now it is said in the status bar, before the access line's place: nothing above the
 * status bar moves, at any frame, as it comes or goes, in Pro and Simple Mode, at CI's 1024 × 645 and at 1410 × 900;
 * nothing in the status bar either; and at 1024 × 645 it and the access line ("No access list") show together, each
 * in short words, whole (no "…"), the whole line in its tooltip and to a screen reader. Placeholder words only.
 */

/** Stage off at the start, as an installed Drashti starts (stage-switch.spec.ts), and no display set to Stage. */
const STAGE_OFF = { DRASHTI_TEST_STAGE_AT_START: '' };

/** Checks every 2 s, each given 1 s, the access line after 12 s with no answer; its 15 days 10 minutes here. */
const QUICK = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '2000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '1000',
  DRASHTI_TEST_ACCESS_BAR_MS: '12000',
  DRASHTI_TEST_ACCESS_STOP_MS: '600000',
};

/** The line's words in sight for Stage on with no Stage screen, and its whole line (shared/screen-switches.ts). */
const NO_STAGE_SHORT = 'No Stage screen';
const NO_STAGE_WHOLE = 'No screen is set to Stage.';

/**
 * What must never move as the line comes or goes: the LIVE picture, Back, Next, Oops (Pro Mode's), the three columns,
 * the bar of clears (Simple Mode's big buttons) and every show control.
 */
const STILL = [
  '[data-testid="live-preview"]',
  '[data-testid="show-back"]',
  '[data-testid="show-next"]',
  '[data-testid="show-oops"]',
  '[data-testid="column-left"]',
  '[data-testid="column-middle"]',
  '[data-testid="column-right"]',
  '[data-testid="layer-bar"]',
  '[data-testid="simple-buttons"]',
  '[data-show-control]',
].join(', ');

/** The screens' line, wherever it is. */
const said = (win: Page) => win.getByTestId('screens-said');
const noStageLine = (win: Page) => win.locator('[data-testid="screens-said"][data-kind="no-stage"]');
const footer = (win: Page) => win.locator('footer[aria-label="Status"]');

/** The placeholder presentation's first slide up, as in a show. */
const slideUp = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    if (!p) throw new Error('no placeholder presentation');
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 0 });
  });

/** Where each of STILL is now, to the hundredth of a pixel, named by its test id and its place in the page. */
const stillParts = (win: Page) =>
  win.evaluate((selector) => {
    const out: string[] = [];
    document.querySelectorAll(selector).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const id = el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
      out.push(
        `${String(i)} ${id}: ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`,
      );
    });
    return out;
  }, STILL);

/** STILL once the window has settled at its size and mode: the same at two looks a second apart. */
async function settledStill(win: Page, where: string): Promise<string[]> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        const now = await stillParts(win);
        const same = now.length > 0 && JSON.stringify(now) === JSON.stringify(last);
        last = now;
        return same;
      },
      { message: `${where}: the window settles`, intervals: [1000] },
    )
    .toBe(true);
  return last;
}

/**
 * Watch STILL at every frame (and every 16 ms between) from now until `stop`: each part that is not exactly where it
 * was, or is gone, with where it went (the first 20).
 */
const startWatching = (win: Page) =>
  win.evaluate((selector) => {
    const parts = [...document.querySelectorAll(selector)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const at = (el: Element) => {
      if (!el.isConnected) return 'gone';
      const r = el.getBoundingClientRect();
      return `${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`;
    };
    const first = parts.map(at);
    const moved: string[] = [];
    let looks = 0;
    const look = () => {
      looks += 1;
      parts.forEach((el, i) => {
        const now = at(el);
        const was = first[i] ?? '';
        const line = `${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()} #${String(i)}: ${was} -> ${now}`;
        if (now !== was && moved.length < 20 && !moved.includes(line)) moved.push(line);
      });
    };
    let going = true;
    const frame = () => {
      if (!going) return;
      look();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const timer = setInterval(look, 16);
    (globalThis as { screensSaidWatch?: () => { looks: number; moved: string[] } }).screensSaidWatch = () => {
      going = false;
      clearInterval(timer);
      look();
      return { looks, moved };
    };
    return parts.length;
  }, STILL);

const stopWatching = (win: Page) =>
  win.evaluate(() => {
    const stop = (globalThis as { screensSaidWatch?: () => { looks: number; moved: string[] } })
      .screensSaidWatch;
    if (!stop) throw new Error('not watching');
    return stop();
  });

/** Stage off, from Pro Mode (Simple Mode only turns the screens on), and any line said before closed. */
async function stageOffAndQuiet(win: Page, mode: 'pro' | 'simple'): Promise<void> {
  if (mode === 'simple') {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  }
  const off = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false),
  );
  expect(off.ok).toBe(true);
  await expect(win.getByTestId('switch-off-stage')).toHaveCount(1);
  if ((await said(win).count()) > 0) await said(win).getByRole('button', { name: 'Dismiss' }).click();
  await expect(said(win)).toHaveCount(0);
  if (mode === 'simple') {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
  }
}

/** Stage on from the status bar's Turn on (both modes have it), with no screen set to Stage: the line comes. */
async function stageOnFromTheStatusBar(win: Page): Promise<void> {
  await win.getByTestId('switch-off-stage').getByRole('button', { name: 'Turn on Stage' }).click();
  await expect(win.getByTestId('switch-off-stage')).toHaveCount(0);
  await expect(noStageLine(win).getByTestId('screens-said-text')).toHaveText(NO_STAGE_WHOLE);
}

/** The line in the status bar: inside its box, one line, never taller than it. */
async function inTheStatusBar(win: Page, line: Locator, what: string): Promise<void> {
  const bar = await footer(win).boundingBox();
  const box = await line.boundingBox();
  expect(bar, what).not.toBeNull();
  expect(box, what).not.toBeNull();
  const b = bar ?? { x: 0, y: 0, width: 0, height: 0 };
  const l = box ?? { x: -1, y: -1, width: 0, height: 0 };
  expect(
    l.y >= b.y - 0.5 &&
      l.y + l.height <= b.y + b.height + 0.5 &&
      l.x >= b.x - 0.5 &&
      l.x + l.width <= b.x + b.width + 0.5,
    `${what}: the line ${JSON.stringify(l)} in the status bar ${JSON.stringify(b)}`,
  ).toBe(true);
}

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode: Stage on with no Stage screen says so in the status bar, and nothing in the window moves as it comes or goes, at 1024 × 645 and 1410 × 900: the LIVE picture, Back, Next${mode === 'pro' ? ', Oops' : ''}, the three columns and every show control, at every frame`, async () => {
    test.setTimeout(150_000);
    const { app } = await launchApp(STAGE_OFF);
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      // A slide up, as in a show (Simple Mode's first tips come only with none up, in a place of their own).
      await slideUp(win);
      await expect(win.getByTestId('live-text')).toContainText('slide 1 of');
      for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
        await stageOffAndQuiet(win, mode);
        await sizeOperatorWindow(app, win, size);
        const before = await settledStill(win, where);
        if (mode === 'pro')
          expect(
            before.some((p) => p.includes(' show-oops: ')),
            `${where}: Oops`,
          ).toBe(true);
        for (const id of [
          'live-preview',
          'show-back',
          'show-next',
          'column-left',
          'column-middle',
          'column-right',
        ])
          expect(
            before.some((p) => p.includes(` ${id}: `)),
            `${where}: ${id} is there`,
          ).toBe(true);
        // On: the line comes, in the status bar; nothing above it moved at any frame, and it all stays.
        expect(await startWatching(win)).toBe(before.length);
        await stageOnFromTheStatusBar(win);
        await letTimePass(win, 1000, 'a second of frames after the line came');
        const coming = await stopWatching(win);
        expect(coming.looks, `${where}: looked at every frame`).toBeGreaterThan(10);
        expect(coming.moved, `${where}: what moved as the line came`).toEqual([]);
        expect(await stillParts(win), `${where}: with the line`).toEqual(before);
        await inTheStatusBar(win, noStageLine(win), where);
        // Closed: it goes, and nothing moves either.
        expect(await startWatching(win)).toBe(before.length);
        await noStageLine(win).getByRole('button', { name: 'Dismiss' }).click();
        await expect(said(win)).toHaveCount(0);
        await letTimePass(win, 500, 'frames after the line went');
        const going = await stopWatching(win);
        expect(going.moved, `${where}: what moved as the line went`).toEqual([]);
        expect(await stillParts(win), `${where}: the line gone`).toEqual(before);
      }
    } finally {
      await app.close();
    }
  });

/**
 * The status bar, and every control and part in it named by its test id, exactly where it is (to the fraction of a
 * pixel): none of it may move as the screens' line comes or goes (the line's own place apart).
 */
const statusBar = (win: Page) =>
  win.evaluate(() => {
    const bar = document.querySelector('footer[aria-label="Status"]');
    if (!bar) return ['no status bar'];
    const out: string[] = [];
    const parts = [
      bar,
      ...bar.querySelectorAll(
        'button, a[href], input, select, [role="button"], [role="switch"], [tabindex], [data-testid]',
      ),
    ];
    for (const el of parts) {
      if (el.closest('[data-testid="screens-said-place"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
      out.push(`${id}: ${String(r.x)},${String(r.y)} ${String(r.width)}×${String(r.height)}`);
    }
    return out;
  });

/** Words in sight in `el`, whole (not cut, not past it) and inside the status bar. */
const wordsWhole = (el: Locator) =>
  el.evaluate((words) => {
    const r = words.getBoundingClientRect();
    const bar = document.querySelector('footer[aria-label="Status"]')?.getBoundingClientRect();
    const problems: string[] = [];
    if (r.width <= 1 || r.height <= 1) problems.push('not in sight');
    if (words.scrollWidth > words.clientWidth + 1)
      problems.push(`cut (${String(words.scrollWidth)} > ${String(words.clientWidth)} px)`);
    if (words.scrollHeight > words.clientHeight + 1) problems.push('cut at the bottom');
    if (
      !bar ||
      r.left < bar.left - 0.5 ||
      r.right > bar.right + 0.5 ||
      r.top < bar.top - 0.5 ||
      r.bottom > bar.bottom + 0.5
    )
      problems.push('not inside the status bar');
    return { text: words.textContent, problems };
  });

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645: the access line and the screens’ line together in the status bar, each in short words, whole, the whole line in its tooltip; nothing in the status bar moves as the screens’ line comes or goes`, async () => {
    test.setTimeout(150_000);
    const { app, access: list } = await launchApp({ ...STAGE_OFF, ...QUICK });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await slideUp(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      // The list stops answering: after 12 s here, "No access list" in the version's place.
      stopAnswering(list);
      const access = win.getByTestId('access-offline-notice');
      await expect(access).toBeVisible({ timeout: 30_000 });
      await stageOffAndQuiet(win, mode);
      // The line's place, a status region, is there before anything is said, empty.
      await expect(footer(win).getByTestId('screens-said-place')).toHaveAttribute('role', 'status');
      await expect(footer(win).getByTestId('screens-said-place').getByTestId('screens-said')).toHaveCount(0);
      await stageOnFromTheStatusBar(win);
      const line = noStageLine(win);
      const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645, both lines`;
      await inTheStatusBar(win, line, where);
      // Read out as it comes: its place is a status region, there before it came, holding it now.
      const place = footer(win).getByTestId('screens-said-place');
      await expect(place, where).toHaveAttribute('role', 'status');
      await expect(place.getByTestId('screens-said'), where).toHaveCount(1);
      await expect(access, where).toBeVisible();
      // Both whole: nothing in the status bar cut short, over another or past its edge (fit.ts).
      await expect
        .poll(async () => (await fitFaults(win, [])).filter((f) => f.startsWith('the status bar')), {
          message: `${where}: what does not fit in the status bar`,
        })
        .toEqual([]);
      // Each in its short words, whole; the whole line read out and in its tooltip.
      const shown = await wordsWhole(line.getByTestId('screens-said-short'));
      expect(shown.problems, `${where}: the screens’ line’s words in sight`).toEqual([]);
      expect(shown.text, where).toBe(NO_STAGE_SHORT);
      const offline = await wordsWhole(win.getByTestId('access-offline-short'));
      expect(offline.problems, `${where}: the access line’s words in sight`).toEqual([]);
      await expect(line.getByTestId('screens-said-text'), where).toHaveText(NO_STAGE_WHOLE);
      if (mode === 'pro')
        await expect(line.getByTestId('screens-said-set-up-stage'), where).toHaveText('Set up Stage screen…');
      else await expect(line.getByTestId('screens-said-set-up-stage'), where).toHaveCount(0);
      // The two side by side, never one over the other: the screens' line first.
      const a = await line.boundingBox();
      const b = await access.boundingBox();
      expect(
        a && b ? a.x + a.width <= b.x + 0.5 : false,
        `${where}: the screens’ line before the access line`,
      ).toBe(true);
      // Its whole line in its tooltip, where the mouse rests on its words.
      await line.getByTestId('screens-said-short').hover();
      await expect(win.locator('[role="tooltip"]'), where).toHaveText(NO_STAGE_WHOLE);
      await win.mouse.move(0, 0);
      await expect(win.locator('[role="tooltip"]')).toHaveCount(0);
      // Closed and said again (Stage on again with no Stage screen, Stage already on): nothing else in the status bar
      // moves as it goes or comes, the access line's place among them.
      const withLine = await statusBar(win);
      await line.getByRole('button', { name: 'Dismiss' }).click();
      await expect(said(win)).toHaveCount(0);
      expect(await statusBar(win), `${where}: nothing in the status bar moved as the line went`).toEqual(
        withLine,
      );
      const on = await win.evaluate(() =>
        (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', true),
      );
      expect(on.ok).toBe(true);
      await expect(line.getByTestId('screens-said-text')).toHaveText(NO_STAGE_WHOLE);
      expect(await statusBar(win), `${where}: nothing in the status bar moved as the line came`).toEqual(
        withLine,
      );
    } finally {
      await app.close();
    }
  });

/**
 * Everything in the status bar that does not fit at the window's size: fitFaults' own (cut, cut short, over another,
 * past its region), and the bar's items needing more than its width, or one past its end (the version's or the
 * access line's place, cut at the window's edge).
 */
const barFaults = async (win: Page): Promise<string[]> => [
  ...(await fitFaults(win, [])).filter((f) => f.startsWith('the status bar')),
  ...(await win.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('footer[aria-label="Status"]');
    if (!bar) return ['no status bar'];
    const out: string[] = [];
    if (bar.scrollWidth > bar.clientWidth + 1)
      out.push(`the status bar's items need ${String(bar.scrollWidth)} px of its ${String(bar.clientWidth)}`);
    // Sound's words whole (the bar's one item that gives way, with an ellipsis).
    const sound = bar.querySelector<HTMLElement>('[data-testid="sound-status"] .truncate');
    if (sound && sound.scrollWidth > sound.clientWidth + 1)
      out.push(`Sound's words cut (${String(sound.scrollWidth)} > ${String(sound.clientWidth)} px)`);
    const edge = bar.getBoundingClientRect();
    const end = edge.right - Number.parseFloat(getComputedStyle(bar).paddingRight);
    for (const el of bar.querySelectorAll('[data-testid], button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > end + 0.5 || r.left < edge.left - 0.5)
        out.push(
          `${el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 30)} past the status bar's end (${r.right.toFixed(1)} > ${end.toFixed(1)})`,
        );
    }
    return out;
  })),
];

/** Audience and Stage turned as asked, from Pro Mode (Simple Mode only turns them on), then back in `mode`. */
async function switchesTo(
  win: Page,
  mode: 'pro' | 'simple',
  audience: boolean,
  stage: boolean,
): Promise<void> {
  if (mode === 'simple') {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  }
  const now = await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());
  for (const [which, on] of [
    ['audience', audience],
    ['stage', stage],
  ] as const) {
    if (now[which] === on) continue;
    const turned = await win.evaluate(
      ([w, o]) => (globalThis as PageGlobals).drashti.screenSwitches.turn(w, o),
      [which, on] as const,
    );
    expect(turned.ok).toBe(true);
  }
  if (mode === 'simple') {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
  }
  await expect(win.getByTestId('switch-off-audience')).toHaveCount(audience ? 0 : 1);
  await expect(win.getByTestId('switch-off-stage')).toHaveCount(stage ? 0 : 1);
}

/** One state of the sweep: what to do, then Audience, Stage and the line (none, Stage's, or a display's) after it. */
interface Step {
  act: 'switches' | 'dismiss' | 'stage on again';
  audience: boolean;
  stage: boolean;
  line: 'none' | 'no-stage' | 'set' | 'mirroring';
}

/**
 * With no display set to Stage: Stage's line only while Stage is on. It closes as Stage goes off (the release lead's
 * call, 27 Nov 2026: it says Stage is on with no Stage screen, so it ends when that is no longer so; it had stayed,
 * beside Stage off, and at 1024 × 645 with Audience off too the bar ran some 30 px past the window's edge).
 */
const NO_STAGE_STEPS: Step[] = [
  { act: 'switches', audience: true, stage: false, line: 'none' },
  { act: 'switches', audience: false, stage: false, line: 'none' },
  { act: 'switches', audience: false, stage: true, line: 'no-stage' },
  { act: 'switches', audience: true, stage: true, line: 'no-stage' },
  { act: 'dismiss', audience: true, stage: true, line: 'none' },
  { act: 'switches', audience: false, stage: true, line: 'none' },
  { act: 'stage on again', audience: false, stage: true, line: 'no-stage' },
  { act: 'switches', audience: false, stage: false, line: 'none' },
  { act: 'switches', audience: true, stage: false, line: 'none' },
];

/** Two displays just plugged in (one the stage): their line stays as Audience and Stage go off and on. */
const SET2_STEPS: Step[] = [
  { act: 'switches', audience: true, stage: false, line: 'set' },
  { act: 'switches', audience: false, stage: false, line: 'set' },
  { act: 'switches', audience: false, stage: true, line: 'set' },
  { act: 'switches', audience: true, stage: true, line: 'set' },
  { act: 'switches', audience: true, stage: false, line: 'set' },
];

/**
 * One display plugged in (the audience picture), or the computer mirroring, with Stage on at the start: the line stays as
 * Audience goes off and Stage off (Stage on again would say Stage's line in its place: no screen is set to Stage).
 */
const ONE_LINE_STEPS = (line: 'set' | 'mirroring'): { version: Step[]; access: Step[] } => ({
  version: [
    { act: 'switches', audience: true, stage: true, line },
    { act: 'switches', audience: false, stage: true, line },
  ],
  access: [
    { act: 'switches', audience: false, stage: true, line },
    { act: 'switches', audience: false, stage: false, line },
    { act: 'switches', audience: true, stage: false, line },
  ],
});

/** The pretend displays, set by themselves (screens-set-themselves.spec.ts). */
const AUTO = {
  DRASHTI_TEST_AUTO_SCREENS: 'pretend',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_DISPLAY_CHANGES: '1',
  DRASHTI_TEST_DISPLAY_SERIALS: 'PJ-A,PJ-B',
};

/** Each step in turn, at 1024 × 645: the line as it should be, and everything in the status bar fitting. */
async function sweep(win: Page, mode: 'pro' | 'simple', steps: Step[], access: string): Promise<void> {
  for (const step of steps) {
    const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode, ${access}, Audience ${step.audience ? 'on' : 'off'}, Stage ${step.stage ? 'on' : 'off'}, ${step.act}, the line ${step.line}`;
    if (step.act === 'dismiss') await said(win).getByRole('button', { name: 'Dismiss' }).click();
    else if (step.act === 'stage on again') {
      // On again, Stage already on: said again.
      const on = await win.evaluate(() =>
        (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', true),
      );
      expect(on.ok, where).toBe(true);
    } else await switchesTo(win, mode, step.audience, step.stage);
    if (step.line === 'none') await expect(said(win), where).toHaveCount(0);
    else {
      const line = win.locator(`[data-testid="screens-said"][data-kind="${step.line}"]`);
      await expect(line, where).toBeVisible();
      await inTheStatusBar(win, line, where);
      // Its words in sight, whole; only on a line that keeps an action button (Pro Mode's Change… and Set up Stage
      // screen…), with Audience off in a window under 1280 px wide, they give way (its icon and buttons stay, the
      // whole line in its tooltip and read out), so the bar's items all fit. Simple Mode's lines and mirroring keep
      // their words (saidwords: an icon and an X alone would not say what the line is).
      const short = line.getByTestId('screens-said-short');
      const action = mode === 'pro' && (step.line === 'no-stage' || step.line === 'set');
      if (step.audience || !action) expect((await wordsWhole(short)).problems, where).toEqual([]);
      else await expect(short, where).toBeHidden();
      await expect(line.getByTestId('screens-said-text'), where).not.toBeEmpty();
    }
    await expect
      .poll(() => barFaults(win), { message: `${where}: what does not fit in the status bar` })
      .toEqual([]);
  }
}

/** The sweep's lines: Stage's (no display), two displays', one display's, and mirroring's. */
const KINDS = {
  'no-stage': { name: 'Stage’s line', env: STAGE_OFF, plug: 0 },
  set2: { name: 'two displays’ line', env: { ...STAGE_OFF, ...AUTO }, plug: 2 },
  set1: { name: 'one display’s line', env: AUTO, plug: 1 },
  mirroring: {
    name: 'mirroring’s line',
    env: { ...AUTO, DRASHTI_TEST_MIRRORED_ONTO: 'PLACEHOLDER PJ' },
    plug: 0,
  },
} as const;

for (const mode of ['pro', 'simple'] as const)
  for (const kind of ['no-stage', 'set2', 'set1', 'mirroring'] as const)
    test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645, ${KINDS[kind].name}: Audience on and off × Stage on and off × the line × the access line, the status bar’s items all fit, nothing cut at its end, Sound’s words whole${kind === 'no-stage' ? '; Stage’s line closes as Stage goes off' : ''}${mode === 'simple' || kind === 'mirroring' ? '; its short words kept with Audience off (no action button)' : ''}`, async () => {
      test.setTimeout(180_000);
      const { app, access: list } = await launchApp({ ...QUICK, ...KINDS[kind].env });
      try {
        const win = await operatorPage(app);
        await operatorReady(win);
        await slideUp(win);
        await sizeOperatorWindow(app, win, CI_WINDOW);
        if (KINDS[kind].plug > 0)
          await app.evaluate((_electron, n) => {
            (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(n);
          }, KINDS[kind].plug);
        if (kind === 'set2') {
          await expect(said(win).getByTestId('screens-said-text')).toHaveText(
            '“Extra display 1” shows the audience picture, and “Extra display 2” the stage.',
          );
          // "new" dropped from the plural (saidwords, lead 2): the count says it, and Simple Mode's line fits.
          await expect(said(win).getByTestId('screens-said-short')).toHaveText('2 screens set up');
        }
        if (kind === 'set1') {
          await expect(said(win).getByTestId('screens-said-text')).toHaveText(
            '“Extra display 1” shows the audience picture.',
          );
          await expect(said(win).getByTestId('screens-said-short')).toHaveText('New screen set up');
        }
        if (kind === 'mirroring') await expect(said(win)).toHaveAttribute('data-kind', 'mirroring');
        const steps =
          kind === 'no-stage'
            ? { version: NO_STAGE_STEPS, access: NO_STAGE_STEPS }
            : kind === 'set2'
              ? { version: SET2_STEPS, access: SET2_STEPS }
              : ONE_LINE_STEPS(kind === 'set1' ? 'set' : 'mirroring');
        await sweep(win, mode, steps.version, 'the version showing');
        // The list stops answering: "No access list" in the version's place, and the same again.
        stopAnswering(list);
        await expect(win.getByTestId('access-offline-notice')).toBeVisible({ timeout: 30_000 });
        await sweep(win, mode, steps.access, 'No access list showing');
      } finally {
        await app.close();
      }
    });
