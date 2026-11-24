import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, letTimePass, outputPage, setUpScreen } from './helpers';
import {
  backgroundUp,
  dispatch,
  failVideo,
  installLooks,
  makeClip,
  notices,
  OUT,
  showPicture,
  shown,
} from './hall-looks';
import { logText } from './log-lines';
import type { MainRun, NodeRun } from './nodes';
import { launchMain, launchNode, nodesStatus, pairNode } from './nodes';
import { makeTestImage } from './test-media';
import { testFfmpeg } from './stream-helpers';

/*
 * A paired computer's screen that cannot play a video (Q60-44, the owner's answer A of 20 Nov 2026; x46's ledger
 * G-A14). A node's decoder can fail where Main's plays (HEVC on an older Windows node, say). Until now the node's page
 * told no one: its screen went black, or kept the picture before, while Main's hall played on, and nobody knew. Now
 * the node keeps what it showed (the picture before, or the video's last frame), never black; Main is told in a notice
 * naming the node and the file, and logs it; and the video plays on everywhere else. Two Drashti instances on this
 * computer; generated media and placeholder names only.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

const groupOf = (win: Page, name: string) =>
  win.evaluate(
    async (n) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.name === n)?.id ?? '',
    name,
  );

/** Put the node's second display (its pretend extra one) into a group, and wait for its output. */
async function nodeScreenIn(main: MainRun, node: NodeRun, nodeId: string, groupId: string): Promise<Page> {
  const displaysOf = async () =>
    main.win.evaluate(
      async (id) =>
        (
          (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
            ?.displays ?? []
        ).map((d) => d.id),
      nodeId,
    );
  await expect.poll(async () => (await displaysOf()).length).toBeGreaterThanOrEqual(2);
  const displayId = (await displaysOf())[1] ?? -1;
  const r = await main.win.evaluate(
    ({ groupId, nodeId, displayId }) =>
      (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(groupId, nodeId, displayId),
    { groupId, nodeId, displayId },
  );
  expect(r.ok).toBe(true);
  return outputPage(node.app);
}

/**
 * From now on, every background video element of that file the page adds fails as it starts to load (its decoder's
 * error, as on a computer that cannot decode it at all): a node's try again, once its copy has landed, fails too.
 */
const failVideosFromNow = (page: Page, mediaId: string) =>
  page.evaluate((id) => {
    const seen = new Set(document.querySelectorAll(`video[data-bg-slot][data-media-id="${id}"]`));
    const observer = new MutationObserver(() => {
      for (const v of document.querySelectorAll<HTMLVideoElement>(
        `video[data-bg-slot][data-media-id="${id}"]`,
      )) {
        if (seen.has(v)) continue;
        seen.add(v);
        v.addEventListener(
          'loadstart',
          () => {
            v.dispatchEvent(new Event('error'));
          },
          { once: true },
        );
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, mediaId);

/** Main's log, every file of it (each earlier day's drashti-YYYY-MM-DD.log and its parts, then drashti.log). */
function logOf(userData: string): string {
  return existsSync(join(userData, 'logs')) ? logText(userData) : '';
}

/** The node's screen and Main's, look by look for `ms`: what each shows. */
async function both(nodeOut: Page, mainOut: Page, ms: number): Promise<string[]> {
  const looks: string[] = [];
  const until = Date.now() + ms;
  const t0 = Date.now();
  while (Date.now() < until)
    looks.push(
      `${String(Date.now() - t0)}ms node:${await shown(nodeOut, OUT)} main:${await shown(mainOut, OUT)}`,
    );
  return looks;
}

test('a node’s screen whose video cannot play (its decoder failing as it plays, or as it loads) keeps what it showed, never black; Main is told by the node’s and the file’s names; and the video plays on Main’s hall', async () => {
  test.setTimeout(360_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const nodeName = (await nodesStatus(main.win)).nodes.find((n) => n.id === nodeId)?.name ?? '';
    expect(nodeName, 'the node’s name on Main').not.toBe('');
    const dir = mkdtempSync(join(tmpdir(), 'drashti-node-cannot-play-'));
    const picture = await makeTestImage(main.win, join(dir, 'Placeholder before.png'), {
      color: '#14532d',
      width: 320,
      height: 180,
    });
    const clip = makeClip(join(dir, 'Placeholder node fails.mp4'), 'h264', 30, 330);
    const [beforeId = '', clipId = ''] = await importAndGetIds(main.win, [picture, clip]);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const nodeOut = await nodeScreenIn(main, node, nodeId, await groupOf(main.win, 'Placeholder Hall'));
    const mainOut = await outputPage(main.app);
    // The node's page's looks, and its way to raise an element's error (hall-looks.ts).
    await installLooks(nodeOut, OUT);
    const putUpVideo = () =>
      dispatch(main.win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: clipId, media: 'video', fit: 'fill', loop: true },
      });
    // Told: the notice (the operator window shows the latest) names the file and the node; each showing is logged.
    const noticed = async () =>
      (await notices(main.win)).some((t) => t.includes('Placeholder node fails') && t.includes(nodeName));
    const logged = () =>
      logOf(main.userData)
        .split('\n')
        .filter(
          (l) => l.includes(`could not play on the paired computer “${nodeName}”`) && l.includes(clipId),
        ).length;

    // 1. As it plays: the node's decoder fails. Its screen keeps the video's last frame, never black; Main is told;
    // the video plays on Main's hall, and stays up.
    await putUpVideo();
    await expect
      .poll(() => shown(nodeOut, OUT), { timeout: 90_000, message: 'the node plays it (its copy here)' })
      .toBe('VIDEO');
    await expect.poll(() => shown(mainOut, OUT), { timeout: 30_000, message: 'Main plays it' }).toBe('VIDEO');
    await letTimePass(main.win, 1000, 'it plays a moment on both');
    expect(await failVideo(nodeOut, clipId), 'the node’s video element').toBe(true);
    const playing = await both(nodeOut, mainOut, 5000);
    expect(
      playing.filter((l) => l.includes('node:BLACK')),
      `the node never black: ${playing.join(' | ')}`,
    ).toEqual([]);
    expect(
      playing.filter((l) => !l.includes('main:VIDEO')),
      `Main’s hall plays on: ${playing.join(' | ')}`,
    ).toEqual([]);
    await expect
      .poll(noticed, { timeout: 15_000, message: 'Main is told by the node’s and the file’s names' })
      .toBe(true);
    await expect.poll(logged, { timeout: 15_000, message: 'and logs it' }).toBe(1);
    expect(await backgroundUp(main.win), 'still up on Main').toBe(clipId);

    // 2. As it loads: put up again over a picture, the node's decoder fails before its first frame. The node keeps
    // the picture before, never black; Main is told again; Main's hall plays it.
    await dispatch(main.win, { type: 'clearAll' });
    await showPicture(main.win, beforeId);
    await expect
      .poll(() => shown(nodeOut, OUT), { timeout: 60_000, message: 'the picture before on the node' })
      .toBe('BEFORE');
    await expect.poll(() => shown(mainOut, OUT), { timeout: 30_000 }).toBe('BEFORE');
    await failVideosFromNow(nodeOut, clipId);
    await putUpVideo();
    await expect.poll(() => shown(mainOut, OUT), { timeout: 30_000, message: 'Main plays it' }).toBe('VIDEO');
    const loading = await both(nodeOut, mainOut, 5000);
    expect(
      loading.filter((l) => !l.includes('node:BEFORE')),
      `the node kept the picture before: ${loading.join(' | ')}`,
    ).toEqual([]);
    await expect.poll(logged, { timeout: 15_000, message: 'Main is told again, for this showing' }).toBe(2);
    expect(await noticed(), 'the notice names the file and the node').toBe(true);
    expect(await backgroundUp(main.win), 'still up on Main').toBe(clipId);
  } finally {
    await node.app.close().catch(() => undefined);
    await main.app.close().catch(() => undefined);
  }
});
