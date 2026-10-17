import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Movement } from '../../src/shared/looks';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, outputPages, setUpScreen } from './helpers';
import { engineState, goLive, holdClock, makeSlides } from './placeholder-slides';

/*
 * Lower thirds that move (Session 27, the design lab's): a Look's lower third comes in as its slide goes up,
 * its box holds while its words change to the next slide's, and it leaves with a short fade (Calm 180 ms,
 * Bold 310 ms) when the slide is taken off on its own; Clear all takes it off at once. All by the engine's
 * clock: outputs held at moments (a test switch) draw the same, and a key and fill pair draws it alike.
 * Placeholder words only.
 */

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** The lower third as an output draws it now: what it is doing, and the styles that move it. */
const drawn = (out: Page) =>
  out.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="lower-third"]');
    if (!root) return null;
    const box = root.querySelector<HTMLElement>('[data-lt-box]');
    const old = root.querySelector<HTMLElement>('[data-lt-words="old"]');
    return {
      phase: root.dataset['ltPhase'] ?? '',
      at: root.dataset['ltAt'] ?? '',
      opacity: root.style.opacity,
      clip: box?.style.clipPath ?? '',
      old: old ? old.style.opacity : null,
      lines: [...root.querySelectorAll<HTMLElement>('[data-lt-line]')].map(
        (l) => `${l.style.opacity}|${l.style.top}`,
      ),
    };
  });

/** Every group as lower thirds, moving `movement`, in the live Look. */
async function lowerThirds(win: Page, movement: Movement, role = 'audience'): Promise<void> {
  await win.evaluate(
    async ({ movement, role }) => {
      const d = (globalThis as PageGlobals).drashti;
      const look = (await d.engine.snapshot()).state.look.id;
      for (const g of (await d.screens.get()).groups.filter((x) => x.role === role)) {
        const set = await d.looks.setGroup(look, g.id, { slides: 'lowerThird', movement });
        if (!set.ok) throw new Error(set.message);
      }
    },
    { movement, role },
  );
}

const WORDS = [
  'Placeholder lower third one\nPlaceholder line two',
  'Placeholder lower third three\nPlaceholder line four',
  'Placeholder lower third five',
];

/** Held before a change, so it waits at its start on every screen; then the change; its engine time. */
async function heldChange(app: ElectronApplication, change: () => Promise<unknown>): Promise<void> {
  await holdClock(app, Date.now() - 60_000);
  await change();
}

test('a slide with more lines than a lower third holds says so under LIVE, “Lower third shows 6 of 7 lines” (Sessions 31–36, SLD-8)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const seven = Array.from({ length: 7 }, (_, i) => `Placeholder line ${String(i + 1)}`).join('\n');
  const id = await makeSlides(
    win,
    'Placeholder long lower third',
    [{ words: seven }, { words: 'Placeholder short\nPlaceholder two' }],
    { kind: 'cut', durationMs: 0 },
  );
  await setUpScreen(win);
  const note = win.getByTestId('preview-lower-third');
  // The hall draws the slide as designed: nothing to say.
  await goLive(win, id, 0);
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2');
  await expect(note).toHaveCount(0);
  // Its Look draws slides as a lower third: the first six of seven show, and LIVE says so.
  await lowerThirds(win, 'calm');
  await expect(note).toHaveText('Lower third shows 6 of 7 lines');
  // A slide that fits: nothing to say.
  await goLive(win, id, 1);
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 2');
  await expect(note).toHaveCount(0);
  await app.close();
});

test('a Look’s lower third comes in, changes as its box holds, and leaves with a short fade; Clear all takes it off at once (Calm and Bold)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder lower third slides',
    WORDS.map((words) => ({ words })),
    { kind: 'cut', durationMs: 0 },
  );
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  for (const movement of ['calm', 'bold'] as const) {
    await lowerThirds(win, movement);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-movement', movement);
    await holdClock(app, null);
    await dispatch(win, { type: 'clearAll' });
    await expect(out.getByTestId('lower-third')).toHaveCount(0);
    const bold = movement === 'bold';

    // In: part-way, coming (Calm fading as a whole, Bold's box opening from the middle); then still.
    await heldChange(app, () => goLive(win, id, 0));
    const shownAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
    await holdClock(app, shownAt + 120);
    await expect
      .poll(async () => `${(await drawn(out))?.phase ?? ''} ${(await drawn(out))?.at ?? ''}`)
      .toBe('in 120');
    const coming = await drawn(out);
    if (bold) expect(coming?.clip, 'Bold opens its box from the middle').toMatch(/^inset\(0px [\d.]+%/u);
    else expect(Number(coming?.opacity), 'Calm fades in as a whole').toBeGreaterThan(0);
    if (!bold) expect(Number(coming?.opacity)).toBeLessThan(1);
    await holdClock(app, shownAt + 2000);
    await expect.poll(async () => (await drawn(out))?.phase).toBe('still');
    expect(await drawn(out)).toMatchObject({ opacity: '', clip: '', old: null, at: '' });

    // A change: the box holds (whole, not cut) while the old words go and the new come.
    await heldChange(app, () => goLive(win, id, 1));
    const changedAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
    await holdClock(app, changedAt + 150);
    await expect
      .poll(async () => `${(await drawn(out))?.phase ?? ''} ${(await drawn(out))?.at ?? ''}`)
      .toBe('change 150');
    const changing = await drawn(out);
    expect(changing).toMatchObject({ opacity: '', clip: '' });
    expect(changing?.old, 'the old words are still there, going').not.toBeNull();
    await holdClock(app, changedAt + 2000);
    await expect.poll(async () => (await drawn(out))?.phase).toBe('still');
    expect((await drawn(out))?.old).toBeNull();

    // Taken off on its own (the slide layer cleared): it leaves with a short fade, then it is gone.
    await heldChange(app, () => dispatch(win, { type: 'clearLayer', layer: 'slide' }));
    const off = (await engineState(win)).slideOff;
    expect(off?.at).toEqual(expect.any(Number));
    const outAt = bold ? 150 : 90;
    await holdClock(app, (off?.at ?? 0) + outAt);
    await expect
      .poll(async () => `${(await drawn(out))?.phase ?? ''} ${(await drawn(out))?.at ?? ''}`)
      .toBe(`out ${String(outAt)}`);
    const going = await drawn(out);
    if (bold) expect(going?.clip, 'Bold closes its box').toMatch(/^inset\(/u);
    else expect(Number(going?.opacity), 'Calm fades out').toBeLessThan(1);
    await holdClock(app, (off?.at ?? 0) + 2000);
    await expect(out.getByTestId('lower-third')).toHaveCount(0);

    // Clear all: everything at once, the lower third with it.
    await holdClock(app, null);
    await goLive(win, id, 2);
    await expect.poll(async () => (await drawn(out))?.phase, { timeout: 10_000 }).toBe('still');
    await heldChange(app, () => dispatch(win, { type: 'clearAll' }));
    expect((await engineState(win)).slideOff).toBeNull();
    await expect(out.getByTestId('lower-third')).toHaveCount(0);
    await holdClock(app, null);
  }
  await app.close();
});

test('a key and fill pair draws its moving lower third alike at every held moment', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const id = await makeSlides(
    win,
    'Placeholder key lower thirds',
    WORDS.map((words) => ({ words })),
    { kind: 'cut', durationMs: 0 },
  );
  const screens = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.screens.createGroup('Placeholder switcher');
    if (!made.ok) throw new Error(made.message);
    const group = made.snapshot.groups.find((g) => g.name === 'Placeholder switcher');
    const role = await d.screens.setGroupRole(group?.id ?? '', 'keyfill');
    if (!role.ok) throw new Error(role.message);
    for (const display of made.snapshot.displays) {
      const used = await d.screens.assignDisplay(group?.id ?? '', display.id, { coverOperator: true });
      if (!used.ok) throw new Error(used.message);
    }
    return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens ?? [];
  });
  expect(screens.map((s) => s.feed)).toEqual(['fill', 'key']);
  await expect.poll(() => outputPages(app).length).toBe(2);
  // Each page drawn far enough to say its feed (a window open before its page has drawn says none).
  const feeds = () =>
    Promise.all(outputPages(app).map((p) => p.getByTestId('output-root').getAttribute('data-feed')));
  await expect.poll(async () => (await feeds()).sort()).toEqual(['fill', 'key']);
  const byFeed = async (feed: string) => {
    for (const p of outputPages(app))
      if ((await p.getByTestId('output-root').getAttribute('data-feed')) === feed) return p;
    throw new Error(`no ${feed} output`);
  };
  const [fill, key] = [await byFeed('fill'), await byFeed('key')];
  // Both ready to draw the show (fonts in, the GPU warmed up: a window under another draws no frames, so it
  // may wait for the warm-up's longest, 8 s).
  for (const p of [fill, key])
    await expect(p.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  for (const movement of ['calm', 'bold'] as const) {
    await lowerThirds(win, movement, 'keyfill');
    await holdClock(app, null);
    await dispatch(win, { type: 'clearAll' });
    for (const p of [fill, key]) await expect(p.getByTestId('lower-third')).toHaveCount(0);
    const moments = async (at: number, offsets: number[], what: string) => {
      for (const t of offsets) {
        await holdClock(app, at + t);
        // Each has drawn the held moment (or is over, still or gone), then the two are the same.
        for (const p of [fill, key])
          await expect
            .poll(async () => {
              const d = await drawn(p);
              return d === null || d.at === '' || d.at === String(t);
            })
            .toBe(true);
        expect(JSON.stringify(await drawn(key)), `${movement} ${what} at ${String(t)} ms`).toBe(
          JSON.stringify(await drawn(fill)),
        );
      }
    };
    await heldChange(app, () => goLive(win, id, 0));
    await moments((await engineState(win)).layers.slide?.shownAt ?? 0, [60, 180, 400, 2000], 'in');
    await heldChange(app, () => goLive(win, id, 1));
    await moments((await engineState(win)).layers.slide?.shownAt ?? 0, [60, 200, 2000], 'a change');
    await heldChange(app, () => dispatch(win, { type: 'clearLayer', layer: 'slide' }));
    await moments((await engineState(win)).slideOff?.at ?? 0, [40, 120, 250], 'out');
    await holdClock(app, null);
  }
  await app.close();
});
