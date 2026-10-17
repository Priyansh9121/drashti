import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { apiCall, networkOn, pairToken } from './devices';
import { lightOf } from './pixels';
import { holdClock } from './placeholder-slides';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutputGlobals, PageGlobals } from './helpers';
import {
  holdStill,
  importAndGetIds,
  killApp,
  letTimePass,
  nodeSaved,
  outputPage,
  outputReady,
  savedLive,
  setUpScreen,
} from './helpers';
import { launchMain, launchNode, pairNode, type MainRun, type NodeRun } from './nodes';
import { makeTestVideo } from './test-media';

/*
 * Screens on a node, following the show (Session 13): a node's display in a
 * screen group draws what Main's own output draws, from the feed, on Main's
 * clock. The node's clock is set 4 s off on purpose (standing in for
 * another computer's): the node must find the offset and correct it. The
 * test measures how far apart the two paint each slide change, where a
 * dissolve stands on each, and where a video is. Placeholder words and a
 * generated video only.
 */

const SKEW_MS = 4000;
const DISSOLVE_MS = 1200;

/** The node's displays as Main last heard of them. */
async function nodeDisplays(win: Page, nodeId: string): Promise<number[]> {
  return win.evaluate(
    async (id) =>
      (
        (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)?.displays ??
        []
      ).map((d) => d.id),
    nodeId,
  );
}

/** Put the node's second display (its pretend extra one) into a group, and wait for its output. */
async function nodeScreenIn(main: MainRun, node: NodeRun, nodeId: string, groupId: string): Promise<Page> {
  await expect.poll(async () => (await nodeDisplays(main.win, nodeId)).length).toBeGreaterThanOrEqual(2);
  const displayId = (await nodeDisplays(main.win, nodeId))[1] ?? -1;
  const r = await main.win.evaluate(
    ({ groupId, nodeId, displayId }) =>
      (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(groupId, nodeId, displayId),
    { groupId, nodeId, displayId },
  );
  expect(r.ok).toBe(true);
  return outputPage(node.app);
}

const groupOf = (win: Page, name: string) =>
  win.evaluate(
    async (n) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.name === n)?.id ?? '',
    name,
  );

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

const paints = (page: Page) => page.evaluate(() => (globalThis as OutputGlobals).drashtiPaintLog ?? []);

/** Each revision's wall-clock paint on Main's output and on the node's: the gaps, node minus Main (ms). */
async function paintGaps(mainOut: Page, nodeOut: Page, revs: number[]): Promise<number[]> {
  const [a, b] = await Promise.all([paints(mainOut), paints(nodeOut)]);
  return revs.flatMap((rev) => {
    const m = a.find((p) => p.rev === rev);
    const n = b.find((p) => p.rev === rev);
    return m && n ? [n.wallAt - m.wallAt] : [];
  });
}

/** Where a background video is, read in both windows at (nearly) one moment, put to the same wall time (s). */
async function videoGap(mainOut: Page, nodeOut: Page, mediaId: string): Promise<number | null> {
  const read = (p: Page) =>
    p.evaluate((id) => {
      const v = document.querySelector<HTMLVideoElement>(
        `[data-layer="background"] video[data-media-id="${id}"]`,
      );
      return v && v.readyState >= 2 && !v.paused
        ? { t: v.currentTime, d: v.duration, wall: Date.now() }
        : null;
    }, mediaId);
  const [m, n] = await Promise.all([read(mainOut), read(nodeOut)]);
  if (!m || !n) return null;
  const nodeAtMainsMoment = n.t - (n.wall - m.wall) / 1000;
  const d = m.d;
  // Across the loop's end, 3.9 s and 0.1 s of a 4 s file are 0.2 s apart.
  return ((((nodeAtMainsMoment - m.t + d / 2) % d) + d) % d) - d / 2;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.floor(s.length / 2)] ?? NaN);
};

async function setUpShow(main: MainRun): Promise<{ id: string; videoId: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-nodes-show-'));
  const words = join(dir, 'Placeholder Node Show.txt');
  writeFileSync(
    words,
    ['[Verse]', ...Array.from({ length: 8 }, (_, i) => `Placeholder node slide ${i + 1}\n`)].join('\n'),
  );
  const video = await makeTestVideo(main.win, join(dir, 'Placeholder node clip.webm'), {
    seconds: 4,
    hue: 200,
  });
  const [id = ''] = await importAndGetIds(main.win, [words, video]);
  const videoId = await main.win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.library.listMedia()).find((m) =>
        m.name.startsWith('Placeholder node clip'),
      )?.id ?? '',
  );
  return { id, videoId };
}

test('a node’s display in a group follows slides, a dissolve and a video in step with Main’s own output', async () => {
  test.setTimeout(240_000);
  const main = await launchMain({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  const node = await launchNode({
    DRASHTI_TEST_CLOCK_SKEW_MS: String(SKEW_MS),
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  try {
    const nodeId = await pairNode(main, node);
    const { id, videoId } = await setUpShow(main);
    // Main's own output on its second display, and the node's second display in the same group.
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const groupId = await groupOf(main.win, 'Placeholder Hall');
    const mainOut = await outputPage(main.app);
    const nodeOut = await nodeScreenIn(main, node, nodeId, groupId);
    // Both ready to draw the show (Session 27's warm-up): Main's still warming missed slide changes.
    for (const o of [mainOut, nodeOut]) await outputReady(o);

    // The node found its clock 4 s off and corrects it: what its windows add is near 0.
    await expect
      .poll(async () =>
        Math.abs(
          (await node.app.evaluate(
            () => (globalThis as { drashtiNode?: { engineNow(): number } }).drashtiNode?.engineNow() ?? 0,
          )) - Date.now(),
        ),
      )
      .toBeLessThan(25);
    const clock = await node.app.evaluate(() => {
      const n = (
        globalThis as { drashtiNode?: { health(): { clock: { offsetMs: number; rttMs: number } | null } } }
      ).drashtiNode;
      return n?.health().clock ?? null;
    });
    expect(clock).not.toBeNull();
    const residual = (clock?.offsetMs ?? 0) + SKEW_MS;

    // Slide changes: both windows paint each one; how far apart. The next goes up once both have painted
    // this one: a frame a busy computer holds back past a fixed wait would never be recorded, as a newer
    // revision's takes its place (a Windows runner did, once: Sessions 31–36).
    const revs: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: i % 8 });
      if (r.ok) revs.push(r.rev);
      await expect(nodeOut.locator('[data-layer="slide"]')).toContainText(
        `Placeholder node slide ${(i % 8) + 1}`,
      );
      if (r.ok) await expect.poll(async () => (await paintGaps(mainOut, nodeOut, [r.rev])).length).toBe(1);
    }
    await expect.poll(async () => (await paintGaps(mainOut, nodeOut, revs)).length).toBe(revs.length);
    const gaps = await paintGaps(mainOut, nodeOut, revs);

    // A dissolve: both windows start it at the same engine time, and both stand at the same point of it.
    await main.win.evaluate(
      async ({ id, ms }) => {
        const d = (globalThis as PageGlobals).drashti;
        const opened = await d.library.slidesForEdit(id);
        if (!opened.ok) throw new Error(opened.message);
        opened.doc.transition = { kind: 'dissolve', durationMs: ms };
        const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
        if (!saved.ok) throw new Error(saved.message);
      },
      { id, ms: DISSOLVE_MS },
    );
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    // Both done with that dissolve: one slide, the first, no longer fading.
    for (const out of [mainOut, nodeOut])
      await expect
        .poll(async () => {
          const layers = await out
            .locator('[data-layer="slide"]')
            .evaluateAll((els) =>
              els.map((e) => ({ fading: e.getAttribute('data-fading') === 'true', text: e.textContent })),
            );
          const [only] = layers;
          return (
            layers.length === 1 &&
            only !== undefined &&
            !only.fading &&
            only.text.includes('Placeholder node slide 1')
          );
        })
        .toBe(true);
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 1 });
    const fadeStart = (p: Page) =>
      p.locator('[data-layer="slide"][data-fading="true"]').evaluateAll((els) => {
        const v = els[0]?.getAttribute('data-fade-start');
        return v ? Number(v) : null;
      });
    await expect.poll(() => fadeStart(mainOut)).not.toBeNull();
    await expect.poll(() => fadeStart(nodeOut)).not.toBeNull();
    expect(await fadeStart(nodeOut)).toBe(await fadeStart(mainOut));
    // Held at the same moments of the engine's time (a test switch on both; the node's clock is 4 s off its
    // computer's, Main's time held all the same), the node draws exactly Main's picture (Session 27). Held
    // before the slide goes up, so the dissolve waits at its very start on both.
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    for (const out of [mainOut, nodeOut])
      await expect(out.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(0, {
        timeout: 10_000,
      });
    for (const app of [main.app, node.app]) await holdClock(app, Date.now() - 60_000);
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 1 });
    const shownAt = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.shownAt ?? 0,
    );
    for (const p of [0.25, 0.5, 0.75]) {
      for (const app of [main.app, node.app]) await holdClock(app, shownAt + p * DISSOLVE_MS);
      for (const out of [mainOut, nodeOut])
        await expect(out.locator('[data-layer="slide"]')).toHaveAttribute('data-fade', p.toFixed(3));
      const [a, b] = [await lightOf(mainOut), await lightOf(nodeOut)];
      const off = Math.max(
        Math.abs(a.mean - b.mean),
        ...a.quad.map((q, k) => Math.abs(q - (b.quad[k] ?? 0))),
      );
      expect(off, `the node's picture at ${String(p)} of the dissolve`).toBeLessThan(0.01);
    }
    for (const app of [main.app, node.app]) await holdClock(app, null);

    // An announcement in the ticker (Session 27, the skills review's MOT-7): the node runs the words at the
    // same pass as Main, and, both held at one moment of the engine's time, they stand at the same place.
    const { port: apiPort } = await networkOn(main.win);
    const token = await pairToken(main.win, apiPort, 'announcements', 'Placeholder poster');
    const sent = await apiCall(apiPort, '/api/v1/announcements', {
      method: 'POST',
      token,
      body: { text: 'Placeholder announcement for the node', from: 'Placeholder poster', minutes: 10 },
    });
    expect(sent.status).toBe(202);
    const approved = await main.win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.announcements.approve({ id, as: 'ticker' }),
      (sent.json['announcement'] as { id: string }).id,
    );
    expect(approved.ok).toBe(true);
    for (const out of [mainOut, nodeOut])
      await expect(out.getByTestId('ticker-words')).toHaveAttribute('data-pass-ms', /^\d+$/u);
    expect(await nodeOut.getByTestId('ticker-words').getAttribute('data-pass-ms')).toBe(
      await mainOut.getByTestId('ticker-words').getAttribute('data-pass-ms'),
    );
    const words = (out: Page) =>
      out.evaluate(() => {
        const a = document.querySelector('[data-testid="ticker-words"]')?.getAnimations()[0];
        return { at: Number(a?.currentTime), paused: a?.playState === 'paused' };
      });
    const heldAt = Date.now() + 1000;
    for (const app of [main.app, node.app]) await holdClock(app, heldAt);
    for (const out of [mainOut, nodeOut]) await expect.poll(async () => (await words(out)).paused).toBe(true);
    const [onMain, onNode] = [await words(mainOut), await words(nodeOut)];
    expect(Math.abs(onMain.at - onNode.at), 'where the words are, Main against the node').toBeLessThan(1);
    for (const app of [main.app, node.app]) await holdClock(app, null);

    // A video in the background (the node copies it the moment it goes up), in step on both.
    await dispatch(main.win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: videoId, media: 'video', fit: 'fill', loop: true },
    });
    const playing = (p: Page) =>
      p.evaluate((vid) => {
        const v = document.querySelector<HTMLVideoElement>(
          `[data-layer="background"] video[data-media-id="${vid}"]`,
        );
        return Boolean(v && v.readyState >= 2 && !v.paused);
      }, videoId);
    await expect.poll(() => playing(mainOut), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => playing(nodeOut), { timeout: 30_000 }).toBe(true);
    // Let both settle on the shared clock, then sample a few times.
    await letTimePass(main.win, 2500, 'both videos settle on the shared clock before they are compared');
    const videoGaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      const g = await videoGap(mainOut, nodeOut, videoId);
      if (g !== null) videoGaps.push(Math.round(g * 1000));
      await letTimePass(main.win, 300, 'the samples spread over the video’s playing');
    }

    // The numbers, for the session report (milliseconds; positive: the node later).
    console.log(
      `NODE SYNC: clock residual ${residual.toFixed(1)} ms (round trip ${clock?.rttMs.toFixed(1)} ms); ` +
        `slide paints node minus Main: median ${median(gaps)} ms, worst ${Math.max(...gaps.map(Math.abs))} ms over ${gaps.length}; ` +
        `video node minus Main: median ${median(videoGaps)} ms, worst ${Math.max(...videoGaps.map(Math.abs))} ms over ${videoGaps.length}`,
    );
    expect(Math.abs(residual)).toBeLessThan(20);
    expect(gaps.length).toBe(revs.length);
    expect(median(gaps)).toBeLessThan(100);
    expect(videoGaps.length).toBeGreaterThan(3);
    expect(Math.abs(median(videoGaps))).toBeLessThan(150);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

test('Main stops: the node holds its picture; Main comes back: the node catches up by itself', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const { id } = await setUpShow(main);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const nodeOut = await nodeScreenIn(main, node, nodeId, await groupOf(main.win, 'Placeholder Hall'));
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 2 });
    await expect(nodeOut.locator('[data-layer="slide"]')).toContainText('Placeholder node slide 3');
    // Main stops dead (a crash, a power cut): the node's screen keeps its picture, and its window says so.
    await expect
      .poll(async () => {
        const raw = await main.win.evaluate(
          async () =>
            (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.slideIndex,
        );
        return raw;
      })
      .toBe(2);
    await savedLive(main.userData, (saved) => saved.slide?.slideIndex === 2);
    await killApp(main.app);
    await expect(node.page.getByTestId('node-link-state')).toHaveText('Offline', { timeout: 20_000 });
    await expect(nodeOut.locator('[data-layer="slide"]')).toContainText('Placeholder node slide 3');
    await holdStill(
      async () =>
        ((await nodeOut.locator('[data-layer="slide"]').textContent()) ?? '').includes(
          'Placeholder node slide 3',
        ),
      1500,
      'the node keeps its picture while Main is away',
    );
    // Main starts again (recovery puts the slide back): the node is back by itself, and follows the show.
    const again = await launchMain({}, { port: main.port, userData: main.userData });
    try {
      await expect(node.page.getByTestId('node-link-state')).toHaveText('Online', { timeout: 30_000 });
      await dispatch(again.win, { type: 'goLive', presentationId: id, slideIndex: 4 });
      await expect(nodeOut.locator('[data-layer="slide"]')).toContainText('Placeholder node slide 5');
      // A new run of the engine (revisions from 0 again): its state, not the old one, is what shows.
      const runs = await node.app.evaluate(
        () => (globalThis as { drashtiNode?: { mirror(): { rev: number } } }).drashtiNode?.mirror().rev ?? -1,
      );
      expect(runs).toBeLessThan(50);
    } finally {
      await again.app.close();
    }
  } finally {
    await node.app.close();
  }
});

test('a node that restarts while Main is away shows the last picture again', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const { id } = await setUpShow(main);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const nodeOut = await nodeScreenIn(main, node, nodeId, await groupOf(main.win, 'Placeholder Hall'));
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 5 });
    await expect(nodeOut.locator('[data-layer="slide"]')).toContainText('Placeholder node slide 6');
    // The node keeps the picture at most a second after it changes.
    await nodeSaved(node.userData, (state) => state.layers.slide?.slideIndex === 5);
  } finally {
    await main.app.close();
  }
  await node.app.close();
  // Main is away; the node starts again on its own.
  const again = await launchNode({}, node.userData);
  try {
    const out = await outputPage(again.app);
    await expect(out.locator('[data-layer="slide"]')).toContainText('Placeholder node slide 6', {
      timeout: 20_000,
    });
    await expect(again.page.getByTestId('node-from-saved')).toBeVisible();
    await expect(again.page.getByTestId('node-link-state')).not.toHaveText('Online');
  } finally {
    await again.app.close();
  }
});

test('a node whose link drops in the middle of a dissolve, in either order, ends on Main’s slide (Sessions 31–36)', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const { id } = await setUpShow(main);
    await main.win.evaluate(
      async ({ id, ms }) => {
        const d = (globalThis as PageGlobals).drashti;
        const opened = await d.library.slidesForEdit(id);
        if (!opened.ok) throw new Error(opened.message);
        opened.doc.transition = { kind: 'dissolve', durationMs: ms };
        const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
        if (!saved.ok) throw new Error(saved.message);
      },
      { id, ms: 2500 },
    );
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const mainOut = await outputPage(main.app);
    const nodeOut = await nodeScreenIn(main, node, nodeId, await groupOf(main.win, 'Placeholder Hall'));
    for (const o of [mainOut, nodeOut]) await outputReady(o);
    const dropLink = () =>
      node.app.evaluate(() => {
        (globalThis as { drashtiNode?: { dropLink(): void } }).drashtiNode?.dropLink();
      });
    /** Both on this slide alone, the dissolve over. */
    const endsOn = async (text: string) => {
      for (const out of [mainOut, nodeOut])
        await expect
          .poll(
            async () => {
              const layers = await out
                .locator('[data-layer="slide"]')
                .evaluateAll((els) =>
                  els.map((e) => ({ fading: e.getAttribute('data-fading') === 'true', text: e.textContent })),
                );
              const [only] = layers;
              return layers.length === 1 && only !== undefined && !only.fading && only.text.includes(text);
            },
            { timeout: 20_000 },
          )
          .toBe(true);
    };
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await endsOn('Placeholder node slide 1');

    // A dissolve starts; the link drops part-way; Main moves on while the node is away.
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 1 });
    await expect(nodeOut.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(1);
    await dropLink();
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 2 });
    await endsOn('Placeholder node slide 3');

    // The link drops first; a dissolve starts while the node is away, and it comes back part-way through.
    await dropLink();
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 3 });
    await endsOn('Placeholder node slide 4');
    await expect(node.page.getByTestId('node-link-state')).toHaveText('Online');
    // The link did drop, both times: the node's own log says so.
    const nodeLog = readFileSync(join(node.userData, 'logs', 'drashti.log'), 'utf8');
    expect(nodeLog.match(/Node: link offline/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
