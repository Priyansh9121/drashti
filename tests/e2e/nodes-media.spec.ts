import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, outputPage, setUpScreen } from './helpers';
import { launchMain, launchNode, nodeView, pairNode } from './nodes';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * Media on a node (Session 13): copies by content hash, fetched from Main
 * over the paired link before they are needed. What is in the week's
 * playlists comes first; something put up before its copy arrived is
 * fetched at once and shows when it lands; "Get everything ready" copies
 * the whole library. Every copy matches the file on Main by its SHA-256.
 * Generated pictures and video only.
 */

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('media is copied before it is needed, checked by hash; what goes up first is fetched at once', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-nodes-media-'));
    const picture = await makeTestImage(main.win, join(dir, 'Placeholder week picture.png'), {
      width: 640,
      height: 360,
      color: '#305070',
    });
    const spare = await makeTestImage(main.win, join(dir, 'Placeholder spare picture.png'), {
      width: 320,
      height: 180,
      color: '#705030',
    });
    const video = await makeTestVideo(main.win, join(dir, 'Placeholder later clip.webm'), {
      seconds: 3,
      hue: 40,
    });
    const words = join(dir, 'Placeholder Media Words.txt');
    writeFileSync(words, '[Verse]\nPlaceholder words over the clip\n');
    const [, , , wordsId = ''] = await importAndGetIds(main.win, [picture, spare, video, words]);
    const media = await main.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
    const idOf = (name: string) => media.find((m) => m.name.startsWith(name))?.id ?? '';
    // This week's playlist has the picture in it: the node copies it ahead, before anything goes up.
    await main.win.evaluate(async (pictureId) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder This Week', null, false);
      if (!made.ok) throw new Error(made.message);
      const tree = await d.playlists.tree();
      const id = tree.find((p) => p.name === 'Placeholder This Week')?.id ?? '';
      const added = await d.playlists.addItems(id, null, [{ kind: 'media', mediaId: pictureId }]);
      if (!added.ok) throw new Error(added.message);
    }, idOf('Placeholder week picture'));
    const cacheDir = join(node.userData, 'Media cache');
    const pictureCopy = join(cacheDir, `${sha(picture)}.png`);
    await expect.poll(() => existsSync(pictureCopy), { timeout: 30_000 }).toBe(true);
    // Checked by hash: the copy is the file Main has, byte for byte.
    expect(sha(pictureCopy)).toBe(sha(picture));
    // Not in a playlist this week: not copied (yet).
    expect(existsSync(join(cacheDir, `${sha(video)}.webm`))).toBe(false);
    expect(existsSync(join(cacheDir, `${sha(spare)}.png`))).toBe(false);
    await expect.poll(async () => (await nodeView(node.page)).media.ready).toBeGreaterThanOrEqual(1);

    // A screen on the node; the clip goes up with words over it before the node has a copy: the words
    // show at once, and the clip is fetched there and then and plays when it lands.
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const groupId = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find(
          (g) => g.name === 'Placeholder Hall',
        )?.id ?? '',
    );
    await expect
      .poll(
        async () =>
          await main.win.evaluate(
            async (id) =>
              (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
                ?.displays.length ?? 0,
            nodeId,
          ),
      )
      .toBeGreaterThanOrEqual(2);
    await main.win.evaluate(
      async ({ groupId, nodeId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const n = (await d.screens.get()).nodes.find((x) => x.id === nodeId);
        const r = await d.screens.assignNodeDisplay(groupId, nodeId, n?.displays[1]?.id ?? -1);
        if (!r.ok) throw new Error(r.message);
      },
      { groupId, nodeId },
    );
    const nodeOut = await outputPage(node.app);
    const clipId = idOf('Placeholder later clip');
    await main.win.evaluate(
      async ({ wordsId, clipId }) => {
        const d = (globalThis as PageGlobals).drashti;
        await d.engine.dispatch({ type: 'goLive', presentationId: wordsId, slideIndex: 0 });
        await d.engine.dispatch({
          type: 'setBackground',
          background: { kind: 'media', mediaId: clipId, media: 'video', fit: 'fill', loop: true },
        });
      },
      { wordsId, clipId },
    );
    await expect(nodeOut.locator('[data-layer="slide"]')).toContainText('Placeholder words over the clip');
    await expect
      .poll(
        () =>
          nodeOut.evaluate((id) => {
            const v = document.querySelector<HTMLVideoElement>(
              `[data-layer="background"] video[data-media-id="${id}"]`,
            );
            return Boolean(v && v.readyState >= 2 && !v.paused);
          }, clipId),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(sha(join(cacheDir, `${sha(video)}.webm`))).toBe(sha(video));

    // "Get everything ready": the rest of the library comes too.
    const ready = await main.win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.nodes.everything(id, true),
      nodeId,
    );
    expect(ready.ok).toBe(true);
    await expect.poll(() => existsSync(join(cacheDir, `${sha(spare)}.png`)), { timeout: 30_000 }).toBe(true);
    // Nothing half-copied is left about, and every copy is named by its hash.
    await expect.poll(() => readdirSync(join(cacheDir, '.part')).length).toBe(0);
    for (const f of readdirSync(cacheDir).filter((n) => /^[0-9a-f]{64}\./u.test(n)))
      expect(sha(join(cacheDir, f))).toBe(f.split('.')[0]);
    await expect.poll(async () => (await nodeView(node.page)).media.problem).toBeNull();
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
