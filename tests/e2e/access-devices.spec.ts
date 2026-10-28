import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { PHONE_STOPPED_TEXT, PHONE_STOPPED_TITLE, STOPPED_REFUSAL } from '../../src/shared/access';
import { expectNoSeriousA11yIssues } from './a11y';
import { PLACEHOLDER_PERSON, revoke, standInOf } from './access';
import { apiCall, device, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken, TABLET } from './devices';
import { expectFits } from './fit';
import { importAndGetIds, outputPage, type PageGlobals } from './helpers';
import { launchMain, launchNode, pairNode, type MainRun, type NodeRun } from './nodes';
import { makeTestImage } from './test-media';

/*
 * A node runs only while paired with a Main that is let in; phones and tablets work only while their Drashti is
 * (Session 54, access by Gmail, E2 and E3). When Main stops, its phones' pages say so plainly (in Safari on a phone and
 * a tablet too) and every request is refused, those the network answers by itself too (a picture, an original, a
 * link, an upload); its nodes' screens fade to black and their windows say why; a node that hears no Main let in for
 * 2 minutes (20 s here) does the same. The stand-in list on 127.0.0.1; placeholder media made at run time; tokens and
 * codes never printed.
 */

const FAST = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '6000',
  DRASHTI_TEST_ACCESS_STOP_MS: '20000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '2000',
};

test('phones and tablets stop with their Drashti: every request refused, files too, and their pages say so', async () => {
  test.setTimeout(180_000);
  const main = await launchMain({ ...NETWORK_ENV, ...FAST });
  const phone = await device('chromium');
  try {
    const { win } = main;
    const list = standInOf(main.userData);
    const { port, base } = await networkOn(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-access-phone-'));
    const [pictureId = ''] = await importAndGetIds(win, [
      await makeTestImage(win, join(dir, 'Placeholder picture.png'), { width: 640, height: 360 }),
    ]);
    expect(pictureId).not.toBe('');
    const token = await pairToken(win, port, 'remote', 'Placeholder script');
    await pairByQr(phone.page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
    // While let in: the state, the picture's original and a link to it answer.
    expect((await apiCall(port, '/api/v1/state', { token })).status).toBe(200);
    expect((await apiCall(port, `/api/v1/media/${pictureId}/original`, { token })).status).toBe(200);
    const made = await apiCall(port, `/api/v1/media/${pictureId}/link`, { token });
    expect(made.status).toBe(200);
    const link = String(made.json['url']);
    await expect(phone.page.getByTestId('phone-stopped')).toHaveCount(0);

    revoke(list, PLACEHOLDER_PERSON);
    await expect(win.getByTestId('access-stopped')).toBeVisible({ timeout: 20_000 });
    // The phone's page says plainly that Drashti has stopped.
    await expect(phone.page.getByTestId('phone-stopped')).toBeVisible({ timeout: 10_000 });
    await expect(phone.page.getByTestId('phone-stopped')).toContainText('Drashti has stopped');
    // Its feed was closed for it, and a new one is refused: nothing of the show reaches it any more.
    await expect(phone.page.getByTestId('connection')).not.toHaveAttribute('data-state', 'online');
    await expectNoSeriousA11yIssues(phone.page, 'a phone’s page once Drashti has stopped');
    // Every request refused, with the same plain words: the network's own answers (a picture, an original, a link
    // made before, an upload) as much as those it asks Drashti for, and pairing.
    const refused = [
      await apiCall(port, '/api/v1/state', { token }),
      await apiCall(port, '/api/v1/command', { method: 'POST', token, body: { type: 'next' } }),
      await apiCall(port, `/api/v1/media/${pictureId}/preview`, { token }),
      await apiCall(port, `/api/v1/media/${pictureId}/picture?width=320`, { token }),
      await apiCall(port, `/api/v1/media/${pictureId}/original`, { token }),
      await apiCall(port, `/api/v1/media/${pictureId}/link`, { token }),
      await apiCall(port, link),
      await apiCall(port, '/api/v1/uploads', { token }),
      await apiCall(port, '/api/v1/uploads', {
        method: 'POST',
        token,
        body: { name: 'Placeholder upload.jpg', bytes: 10 },
      }),
      await apiCall(port, '/api/v1/pair', { method: 'POST', body: { code: '123456' } }),
      // The computer's own screens and switches from a phone (Session 54, the phone as a full Drashti).
      await apiCall(port, '/api/v1/screens', { token }),
      await apiCall(port, '/api/v1/screen-groups', { method: 'POST', token, body: { name: 'Placeholder' } }),
      await apiCall(port, '/api/v1/screens/keep', { method: 'POST', token }),
      await apiCall(port, '/api/v1/switches/audience', { method: 'POST', token, body: { on: false } }),
    ];
    for (const r of refused)
      expect(r).toEqual({ status: 503, json: { ok: false, message: STOPPED_REFUSAL } });
  } finally {
    await phone.close();
    await main.app.close();
  }
});

test('a phone and a tablet in Safari say plainly that Drashti has stopped, at 375 × 812 and 768 × 1024', async () => {
  test.setTimeout(180_000);
  const main = await launchMain({ ...NETWORK_ENV, ...FAST });
  const phone = await device('webkit');
  const tablet = await device('webkit', TABLET);
  try {
    const { win } = main;
    const { base } = await networkOn(win);
    const held = [
      { d: phone, size: { width: 375, height: 812 }, name: 'Placeholder phone' },
      { d: tablet, size: { width: 768, height: 1024 }, name: 'Placeholder tablet' },
    ];
    for (const { d, size, name } of held) {
      await d.page.setViewportSize(size);
      await pairByQr(d.page, base, await pairingCode(win, 'remote', name), '/remote');
      await expect(d.page.getByTestId('connection')).toHaveAttribute('data-state', 'online');
      await expect(d.page.getByTestId('phone-stopped')).toHaveCount(0);
    }

    revoke(standInOf(main.userData), PLACEHOLDER_PERSON);
    await expect(win.getByTestId('access-stopped')).toBeVisible({ timeout: 20_000 });
    for (const { d, size } of held) {
      const at = `${String(size.width)} × ${String(size.height)}`;
      const stopped = d.page.getByTestId('phone-stopped');
      await expect(stopped).toBeVisible({ timeout: 10_000 });
      await expect(stopped.getByRole('heading', { level: 1 })).toHaveText(PHONE_STOPPED_TITLE);
      await expect(stopped).toContainText(PHONE_STOPPED_TEXT);
      await expectFits(stopped, `a phone’s page once Drashti has stopped, at ${at}`);
      await expectNoSeriousA11yIssues(d.page, `a phone’s page once Drashti has stopped, in Safari at ${at}`);
    }
  } finally {
    await tablet.close();
    await phone.close();
    await main.app.close();
  }
});

/** The node's second display (its pretend extra one) put into a new group on Main: the node's output. */
async function nodeScreen(main: MainRun, node: NodeRun, nodeId: string): Promise<Page> {
  const displays = () =>
    main.win.evaluate(
      async (id) =>
        (
          (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
            ?.displays ?? []
        ).map((d) => d.id),
      nodeId,
    );
  await expect.poll(async () => (await displays()).length).toBeGreaterThanOrEqual(2);
  const displayId = (await displays())[1] ?? -1;
  const assigned = await main.win.evaluate(
    async ({ nodeId, displayId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const created = await d.screens.createGroup('Placeholder Node Hall');
      if (!created.ok) throw new Error(created.message);
      const groupId = created.snapshot.groups.find((g) => g.name === 'Placeholder Node Hall')?.id ?? '';
      return (await d.screens.assignNodeDisplay(groupId, nodeId, displayId)).ok;
    },
    { nodeId, displayId },
  );
  expect(assigned).toBe(true);
  return outputPage(node.app);
}

/** The first placeholder presentation's first slide, up. */
const goLive = (main: MainRun) =>
  main.win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    if (!p) throw new Error('no placeholder presentation');
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 0 });
  });

test('a node stops with its Main: its screens fade to black, and its window says why', async () => {
  test.setTimeout(240_000);
  const main = await launchMain(FAST);
  const node = await launchNode(FAST);
  try {
    const nodeId = await pairNode(main, node);
    const out = await nodeScreen(main, node, nodeId);
    await goLive(main);
    await expect(out.locator('[data-layer="slide"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(node.page.getByTestId('node-stopped')).toHaveCount(0);

    revoke(standInOf(main.userData), PLACEHOLDER_PERSON);
    await expect(main.win.getByTestId('access-stopped')).toBeVisible({ timeout: 20_000 });
    await expect(out.getByTestId('stopped-cover')).toHaveAttribute('data-stopped', 'black', {
      timeout: 20_000,
    });
    await expect(out.locator('[data-layer="slide"]')).toHaveCount(0);
    await expect(node.page.getByTestId('node-stopped')).toHaveAttribute('data-why', 'main-stopped');
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

test('a node that hears no Main let in for 2 minutes (20 s here) goes black, and shows again when it does', async () => {
  test.setTimeout(240_000);
  const main = await launchMain(FAST);
  const node = await launchNode(FAST);
  try {
    const nodeId = await pairNode(main, node);
    const out = await nodeScreen(main, node, nodeId);
    await goLive(main);
    await expect(out.locator('[data-layer="slide"]')).toHaveCount(1, { timeout: 20_000 });
    // Main quits: the node keeps its last picture for a while, then goes black.
    await main.app.close();
    await expect(out.locator('[data-layer="slide"]')).toHaveCount(1);
    await expect(out.getByTestId('stopped-cover')).toHaveAttribute('data-stopped', 'black', {
      timeout: 40_000,
    });
    await expect(node.page.getByTestId('node-stopped')).toHaveAttribute('data-why', 'not-heard');
    // Main again, let in: the node shows its show again.
    const again = await launchMain(FAST, { port: main.port, userData: main.userData });
    try {
      await expect(node.page.getByTestId('node-link-state')).toHaveText('Online', { timeout: 30_000 });
      await expect(node.page.getByTestId('node-stopped')).toHaveCount(0, { timeout: 20_000 });
      await expect(out.getByTestId('stopped-cover')).toHaveCount(0);
    } finally {
      await again.app.close();
    }
  } finally {
    await node.app.close();
  }
});
