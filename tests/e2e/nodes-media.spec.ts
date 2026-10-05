import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, killApp, outputPage, setUpScreen } from './helpers';
import { launchMain, launchNode, linkLog, nodeView, pairNode } from './nodes';
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

test('a video put up before its copy arrived: the picture before stays until it plays; cut off by Main going away, it loads as soon as its copy can land', async () => {
  test.setTimeout(300_000);
  // Copies crawl (16 KB a second), so the test can watch one under way.
  const rate = 16_384;
  const slow = { DRASHTI_TEST_COPY_RATE: String(rate) };
  const first = await launchMain(slow);
  const node = await launchNode();
  let main = first;
  try {
    const nodeId = await pairNode(main, node);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-nodes-late-'));
    const picture = await makeTestImage(main.win, join(dir, 'Placeholder before picture.png'), {
      width: 64,
      height: 36,
      color: '#406080',
    });
    const clipA = await makeTestVideo(main.win, join(dir, 'Placeholder late clip A.webm'), {
      seconds: 4,
      width: 640,
      height: 360,
      hue: 120,
    });
    const clipB = await makeTestVideo(main.win, join(dir, 'Placeholder late clip B.webm'), {
      seconds: 8,
      width: 640,
      height: 360,
      hue: 300,
    });
    await importAndGetIds(main.win, [picture, clipA, clipB]);
    const words = join(dir, 'Placeholder picture slide.txt');
    writeFileSync(words, '[Verse]\nPlaceholder words over a picture\n');
    const [slideshow = ''] = await importAndGetIds(main.win, [words]);
    const media = await main.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
    const idOf = (name: string) => media.find((m) => m.name.startsWith(name))?.id ?? '';
    const [pictureId, aId, bId] = [
      idOf('Placeholder before picture'),
      idOf('Placeholder late clip A'),
      idOf('Placeholder late clip B'),
    ];
    // The slide shows the picture too (the node will have it by the time the slide goes up).
    await main.win.evaluate(
      async ({ slideshow, pictureId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const opened = await d.library.slidesForEdit(slideshow);
        if (!opened.ok) throw new Error(opened.message);
        opened.doc.groups[0]?.slides[0]?.elements.push({
          id: 'placeholder-picture',
          kind: 'image',
          mediaId: pictureId,
          fit: 'fit',
          frame: { x: 80, y: 80, width: 320, height: 180 },
        });
        const saved = await d.library.saveSlides(slideshow, opened.doc, opened.stamp);
        if (!saved.ok) throw new Error(saved.message);
      },
      { slideshow, pictureId },
    );
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    await expect
      .poll(async () =>
        main.win.evaluate(
          async (n) =>
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((x) => x.id === n)?.displays
              .length ?? 0,
          nodeId,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await main.win.evaluate(async (nid) => {
      const d = (globalThis as PageGlobals).drashti;
      const s = await d.screens.get();
      const group = s.groups.find((g) => g.name === 'Placeholder Hall');
      const n = s.nodes.find((x) => x.id === nid);
      const r = await d.screens.assignNodeDisplay(group?.id ?? '', nid, n?.displays[1]?.id ?? -1);
      if (!r.ok) throw new Error(r.message);
    }, nodeId);
    const out = await outputPage(node.app);
    // What the node's screen does with the media, for a failed run: its requests, its video elements'
    // events, and the node's word that a copy has landed.
    const network: string[] = [];
    const heard = (what: string, url: string) => {
      if (url.startsWith('drashti-media:')) network.push(`screen ${new Date().toISOString()} ${what} ${url}`);
    };
    out.on('request', (r) => heard('request', r.url()));
    out.on('response', (r) => heard(`response ${r.status()}`, r.url()));
    out.on('requestfailed', (r) => heard(`request failed (${r.failure()?.errorText ?? ''})`, r.url()));
    await out.evaluate(() => {
      const log: string[] = [];
      (globalThis as unknown as { screenLog: string[] }).screenLog = log;
      const t = () => new Date().toISOString();
      for (const type of ['loadstart', 'error', 'loadedmetadata', 'playing', 'stalled', 'abort', 'emptied'])
        document.addEventListener(
          type,
          (e) => {
            const v = e.target;
            if (v instanceof HTMLMediaElement)
              log.push(
                `screen ${t()} ${type} ${v.dataset['mediaId'] ?? '-'} ns=${v.networkState} rs=${v.readyState}`,
              );
          },
          true,
        );
      (globalThis as PageGlobals).drashti.output.onMediaReady((id) =>
        log.push(`screen ${t()} told ${id} landed`),
      );
    });
    const screenLog = () => out.evaluate(() => (globalThis as unknown as { screenLog: string[] }).screenLog);
    const background = (main: typeof first, mediaId: string, kind: 'image' | 'video') =>
      main.win.evaluate(
        ({ mediaId, kind }) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({
            type: 'setBackground',
            background: { kind: 'media', mediaId, media: kind, fit: 'fill', loop: true },
          }),
        { mediaId, kind },
      );
    const slot = (mediaId: string) =>
      out.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(`[data-layer="background"] [data-media-id="${id}"]`);
        if (!el) return 'none';
        const state = el.dataset['state'] ?? '';
        const playing = el instanceof HTMLVideoElement && el.readyState >= 2 && !el.paused;
        return playing ? 'playing' : state;
      }, mediaId);

    // The picture first: it is small, so it is there almost at once.
    await background(main, pictureId, 'image');
    await expect.poll(() => slot(pictureId), { timeout: 20_000 }).toBe('ready');
    // Clip A goes up before it is copied: the picture stays up, whole, while the clip loads.
    await background(main, aId, 'video');
    await expect.poll(() => slot(aId)).toBe('loading');
    expect(await slot(pictureId)).toBe('ready');
    expect(
      await out.evaluate((id) => {
        const el = document.querySelector(`[data-layer="background"] [data-media-id="${id}"]`);
        return el ? getComputedStyle(el).opacity : '';
      }, pictureId),
    ).toBe('1');
    // Once copied, it plays (well past any time limit a copy could need at this rate).
    await expect.poll(() => slot(aId), { timeout: 120_000 }).toBe('playing');

    // Clip B goes up, and Main stops dead while it is still copying: the node lets the screen's request go.
    await background(main, bId, 'video');
    await expect.poll(() => slot(bId)).toBe('loading');
    // Meanwhile a slide with a picture the node has goes up: it shows at once, not behind clip B.
    await main.win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex: 0,
        }),
      slideshow,
    );
    await expect
      .poll(
        () =>
          out.evaluate((id) => {
            const img = document.querySelector<HTMLImageElement>(
              `[data-layer="slide"] img[data-media-id="${id}"]`,
            );
            return Boolean(img?.complete && img.naturalWidth > 0);
          }, pictureId),
        { timeout: 2000 },
      )
      .toBe(true);
    expect(await slot(bId)).toBe('loading');
    // Main keeps what is live within a quarter of a second, for its restart recovery: once clip B is
    // kept, Main stops dead.
    await expect
      .poll(() => {
        try {
          return readFileSync(join(main.userData, 'live-state.json'), 'utf8').includes(bId);
        } catch {
          return false;
        }
      })
      .toBe(true);
    const marks: string[] = [];
    const mark = (what: string) => marks.push(`test ${new Date().toISOString()} ${what}`);
    mark('Main is stopped dead');
    await killApp(main.app);
    // (It had not arrived: at this rate the clip takes many seconds.)
    expect(existsSync(join(node.userData, 'Media cache', `${sha(clipB)}.webm`))).toBe(false);
    await expect(node.page.getByTestId('node-link-state')).toHaveText('Offline', { timeout: 20_000 });
    mark('the node says Offline');
    await expect.poll(() => slot(bId), { timeout: 20_000 }).toBe('failed');
    mark('clip B failed on the node’s screen');
    // Main is back (restart recovery puts clip B up again): the copy carries on at once from where it
    // stopped, and the screen loads the clip by itself as soon as it has landed: within the time the rest
    // of it takes at this rate, and a few seconds.
    main = await launchMain(slow, { port: first.port, userData: first.userData });
    mark('Main is started again');
    await expect(node.page.getByTestId('node-link-state')).toHaveText('Online', { timeout: 30_000 });
    mark('the node says Online');
    const back = Date.now();
    const bytes = statSync(clipB).size;
    const part =
      statSync(join(node.userData, 'Media cache', '.part', bId), { throwIfNoEntry: false })?.size ?? 0;
    const limit = Math.ceil(((bytes - part) / rate) * 1000) + 8000;
    // What the node and Main did, for a slow or failed run: the copies, the screen's video element.
    const diagnose = async (why: string) => {
      const video = await out.evaluate(() =>
        [...document.querySelectorAll<HTMLVideoElement>('[data-layer="background"] video')].map((v) => ({
          mediaId: v.dataset['mediaId'],
          state: v.dataset['state'],
          networkState: v.networkState,
          readyState: v.readyState,
          paused: v.paused,
          error: v.error ? `${v.error.code} ${v.error.message}` : null,
        })),
      );
      const text = [
        `LATE COPY DIAGNOSTICS (${why}); clip B is ${bId}, ${bytes} bytes, ${part} copied before Main went`,
        `node media: ${JSON.stringify((await nodeView(node.page)).media)}`,
        `node screen's videos: ${JSON.stringify(video)}`,
        ...[
          ...marks,
          ...linkLog(first.userData, 'main'),
          ...linkLog(node.userData, 'node'),
          ...[...(await screenLog()), ...network].filter((l) => l.includes(bId)),
        ]
          .sort((a, b) => a.slice(a.indexOf(' ') + 1).localeCompare(b.slice(b.indexOf(' ') + 1)))
          .slice(-200),
      ].join('\n');
      console.log(text);
      await test.info().attach('late-copy diagnostics', { body: text, contentType: 'text/plain' });
    };
    try {
      await expect.poll(() => slot(bId), { timeout: limit }).toBe('playing');
    } catch (error) {
      await diagnose(`not playing ${(limit / 1000).toFixed(1)} s after the node was back online`);
      throw error;
    }
    const loads = (await screenLog()).filter((l) => l.includes(` loadstart ${bId} `)).length;
    console.log(
      `LATE COPY: clip B (${bytes} bytes, ${part} copied before Main went) played ${((Date.now() - back) / 1000).toFixed(1)} s after the node was back online (limit ${(limit / 1000).toFixed(1)} s); the screen loaded it ${loads} times`,
    );
    // Once when it went up, and once when its copy landed: never a loop of tries.
    expect(loads).toBeLessThanOrEqual(3);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
