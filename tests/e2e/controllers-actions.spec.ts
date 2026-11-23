import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, outputPage, outputReady, setUpScreen } from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { makeTestVideo } from './test-media';
import { expectNoSeriousA11yIssues } from './a11y';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';

test('Main chooses controller actions; presses apply once, stale ones are refused, and reconnect never replays', async () => {
  test.setTimeout(180_000);
  const main = await launchMain();
  const node = await launchNode({ DRASHTI_TEST_NODE_LINK_HOLD: '1' });
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-controller-actions-'));
    const file = join(dir, 'Placeholder shared actions.txt');
    writeFileSync(
      file,
      '[Verse]\nPlaceholder action first\n\n[Chorus]\nPlaceholder action second\n\n[Bridge]\nPlaceholder action third\n',
    );
    const [id = ''] = await importAndGetIds(main.win, [file]);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const output = await outputPage(main.app);
    await outputReady(output);
    await main.win.evaluate(
      (pid) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: pid,
          slideIndex: 0,
        }),
      id,
    );
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder action first');
    const nodeId = await pairNode(main, node);
    await main.win.getByRole('button', { name: 'Screens', exact: true }).click();
    const card = main.win.locator(`[data-testid="node-card"][data-node="${nodeId}"]`);
    await card.getByRole('checkbox', { name: 'Shared show view', exact: true }).check();
    const view = node.page.getByTestId('controller-view');
    await expect(view.getByTestId('controller-status')).toHaveText('Connected to Main');
    await expect(view.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await card.getByRole('checkbox', { name: 'Show controls', exact: true }).check();
    const next = view.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeEnabled();
    const firstRev = await main.win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev,
    );
    await next.click();
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder action second');
    await expect(view.getByTestId('controller-live')).toContainText('Placeholder action second');
    await expect(view.getByTestId('controller-action-result')).toHaveText('Applied on Main.');
    expect(
      await main.win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev),
    ).toBe(firstRev + 1);
    // A request made from an older view cannot overwrite Main's newer change.
    const old = await node.page.evaluate(async () => {
      const s = await (globalThis as PageGlobals).drashti.engine.snapshot();
      return {
        id: 'placeholder-stale',
        session: s.session ?? '',
        rev: s.rev,
        command: { type: 'toggleBlackout' as const },
      };
    });
    await main.win.evaluate(() =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'toggleWallpaper' }),
    );
    expect(
      await node.page.evaluate((press) => (globalThis as PageGlobals).drashti.node.action(press), old),
    ).toMatchObject({ status: 'stale' });
    expect(
      await main.win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.blackout,
      ),
    ).toBe(false);
    // A duplicate identifier returns the first result; it never toggles twice.
    const duplicate = await node.page.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const s = await d.engine.snapshot();
      const press = {
        id: 'placeholder-duplicate',
        session: s.session ?? '',
        rev: s.rev,
        command: { type: 'toggleBlackout' as const },
      };
      const answers = await Promise.all([d.node.action(press), d.node.action(press)]);
      return { answers, rev: s.rev };
    });
    expect(duplicate.answers[0]).toMatchObject({ status: 'accepted', rev: duplicate.rev + 1 });
    expect(duplicate.answers[1]).toEqual(duplicate.answers[0]);
    const beforeDrop = await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    await node.app.evaluate(() => {
      const link = (globalThis as { drashtiNode?: { pauseLink(): void } }).drashtiNode;
      if (!link) throw new Error('The test link control is missing.');
      link.pauseLink();
    });
    await expect(view.getByTestId('controller-status')).toHaveText('Not connected');
    await expect(next).toBeDisabled();
    expect(
      await node.page.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const s = await d.engine.snapshot();
        return d.node.action({
          id: 'placeholder-offline',
          session: s.session ?? '',
          rev: s.rev,
          command: { type: 'next' },
        });
      }),
    ).toMatchObject({ status: 'refused' });
    expect((await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).rev).toBe(
      beforeDrop.rev,
    );
    await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }));
    const afterMain = await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    await node.app.evaluate(() => {
      const link = (globalThis as { drashtiNode?: { resumeLink(): void } }).drashtiNode;
      if (!link) throw new Error('The test link control is missing.');
      link.resumeLink();
    });
    await expect(view.getByTestId('controller-status')).toHaveText('Connected to Main');
    await expect(view).toHaveAttribute('data-rev', String(afterMain.rev));
    expect((await main.win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).rev).toBe(
      afterMain.rev,
    );
    await node.page.setViewportSize({ width: 1024, height: 645 });
    await expectNoSeriousA11yIssues(node.page, 'controller show actions');
    await card.getByRole('checkbox', { name: 'Show controls', exact: true }).uncheck();
    await expect(next).toHaveCount(0);
    expect(
      await node.page.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const s = await d.engine.snapshot();
        return d.node.action({
          id: 'placeholder-revoked',
          session: s.session ?? '',
          rev: s.rev,
          command: { type: 'next' },
        });
      }),
    ).toMatchObject({ status: 'refused' });
    await main.win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    expect(
      await main.win.evaluate(
        (nid) => (globalThis as PageGlobals).drashti.nodes.setControllerAreas(nid, ['show']),
        nodeId,
      ),
    ).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

test('media playback is a separate grant and still runs on Main without sound on the controller', async () => {
  test.setTimeout(180_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-controller-playback-'));
    const file = await makeTestVideo(main.win, join(dir, 'Placeholder controlled clip.webm'), {
      seconds: 4,
      hue: 70,
      tone: 330,
    });
    await importAndGetIds(main.win, [file]);
    const nodeId = await pairNode(main, node);
    const mediaId = await main.win.evaluate(async (nid) => {
      const d = (globalThis as PageGlobals).drashti;
      const id =
        (await d.library.listMedia()).find((m) => m.name.startsWith('Placeholder controlled clip'))?.id ?? '';
      await d.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
      });
      await d.nodes.setController(nid, true);
      await d.nodes.setControllerAreas(nid, ['media']);
      return id;
    }, nodeId);
    const view = node.page.getByTestId('controller-view');
    await expect(view.getByTestId('controller-status')).toHaveText('Connected to Main');
    await expect(view.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    // A press carries the revision its controller saw, and Main refuses one the show has moved past ("The show
    // already moved"). Main's revision also moves by itself while a new video settles: its loudness measured after
    // the import and its length learned as the audio player plays it (bookkeeping, no press). On CI's Mac one of
    // them came between the controller seeing the pause and its Play, so Play was refused (a21-full2, run
    // 45097059190). Each press waits until both are done and the controller shows Main's revision.
    await expect
      .poll(() =>
        main.win.evaluate(
          async (id) => (await (globalThis as PageGlobals).drashti.sound.file(id))?.measured,
          mediaId,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        main.win.evaluate(async () => {
          const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
          return bg?.kind === 'media' && bg.durationMs !== undefined;
        }),
      )
      .toBe(true);
    const caughtUp = async (): Promise<void> => {
      await expect
        .poll(async () => {
          const rev = await main.win.evaluate(
            async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev,
          );
          return (await view.getAttribute('data-rev')) === String(rev);
        })
        .toBe(true);
    };
    await caughtUp();
    await view.getByTestId('controller-pause-background').click();
    await expect
      .poll(() =>
        main.win.evaluate(async () => {
          const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
          return bg?.kind === 'media' ? (bg.seek?.paused ?? false) : false;
        }),
      )
      .toBe(true);
    await caughtUp();
    await view.getByTestId('controller-resume-background').click();
    await expect
      .poll(() =>
        main.win.evaluate(async () => {
          const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
          return bg?.kind === 'media' ? (bg.seek?.paused ?? false) : true;
        }),
      )
      .toBe(false);
    const video = view.getByTestId('controller-live').locator('video').first();
    await expect
      .poll(() =>
        video.evaluate((el) => (el as HTMLVideoElement).readyState >= 2 && (el as HTMLVideoElement).muted),
      )
      .toBe(true);
    expect(await node.page.evaluate(() => document.querySelectorAll('audio').length)).toBe(0);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
