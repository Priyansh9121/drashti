import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ToDevice } from '../../src/shared/network';
import { settled } from './a11y';
import { NETWORK_ENV, networkOn, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  openAllSections,
  openLibrary,
  openSection,
  operatorPage,
  operatorReady,
} from './helpers';
import { makeTestImage, makeTestTone, makeTestVideo, setWebmDuration } from './test-media';
import { dispatch, row, slideWithVideos } from './time-bar-helpers';
import type { MayEndInEllipsis } from './fit';
import { fitFaults } from './fit';
import { helpOn } from './help';
import { CI_WINDOW, liveColumnToTop, sizeOperatorWindow } from './window-size';

/*
 * The whole operator window fits (alpha.21, the owner's "dont like the design here. frontend issue." and "all good fit
 * in 21", 22 Nov 2026), in Pro and Simple Mode: at his own 1410 × 900, at 1280 × 720 and at CI's 1024 × 645, with the
 * side columns at their least, the left one at its most and the live column at its most, and typical content in it
 * (long names, the network on, a playlist open, a slide's video playing, the background's paused, Audio's playlists and
 * a track, every section under LIVE open, a long notice; in Pro Mode the library's sheet open too), each part that scrolls at its top
 * and at its end. In every one of them no control or heading is cut, lies over another (an action in a row's own room,
 * as Rename and Delete at its end, may, if none of the row's words or icons are under it), runs out of its column or is
 * under a notice, no words of Drashti's own are cut short (a name the operator gave may be, with an ellipsis), nothing
 * scrolls sideways, and every target is 24 px (axe's target-size). Placeholder names and generated media only.
 */

/** The owner's own window (22 Nov 2026, alpha.20.1 on his Mac), in CSS pixels. */
const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

const SIZES = [OWNERS_WINDOW, { width: 1280, height: 720 }, CI_WINDOW] as const;

/** The side columns, each set by its splitter's keys as an operator can: Home at its least, End at its most. */
const COLUMNS = {
  'both columns at their least': { left: 'Home', right: 'Home' },
  'the playlists at their most': { left: 'End', right: 'Home' },
  'the live column at its most': { left: 'Home', right: 'End' },
} as const;

const LONG = {
  // Gujarati's marks above and below as the owner's own names have them (the word "placeholder" in its letters).
  playlist: 'Placeholder પ્લેસહોલ્ડર Sunday Evening Sabha with a Long Name',
  presentation: 'Placeholder Opening Words over a Video with a Long Name',
  video: 'Placeholder Evening Talk Recording with a Long File Name.webm',
  picture: 'Placeholder Wide Picture of the Stage with a Long Name.png',
  tone: 'Placeholder Evening Music Track with a Long File Name.wav',
  audio: [
    'Placeholder Music Before the Sabha with a Long Name',
    'Placeholder પ્લેસહોલ્ડર Music After the Sabha',
    'Placeholder Quiet Music',
  ],
  notice:
    'Placeholder notice: the diagnostics were saved to a folder with a long placeholder name on this computer, so this card is as tall as a long notice gets.',
} as const;

/** The slide clip's file, and the words over it (slideWithVideos). */
const CLIP = 'Placeholder slide clip.webm';
const SLIDE_WORDS = 'Placeholder words over the videos';

/**
 * The names an operator gave in this test, each as Drashti may show it (a file's with its type and without), and the
 * library's two seeded presentations (src/main/db/seed.ts): the only words that may be cut short with an ellipsis (a
 * notice's, the test's own included, may not).
 */
const NAMES: string[] = [
  LONG.playlist,
  LONG.presentation,
  ...[LONG.video, LONG.picture, LONG.tone, CLIP].flatMap((file) => [file, file.replace(/\.[a-z0-9]+$/u, '')]),
  ...LONG.audio,
  SLIDE_WORDS,
  'Language test slides',
  'Sample kirtan (placeholder)',
];

/** axe's target-size findings (every target 24 px, or room around it): its words for each. */
async function smallTargets(win: Page): Promise<string[]> {
  type AxeWindow = typeof globalThis & { axe?: typeof axe };
  if (!(await win.evaluate(() => Boolean((globalThis as AxeWindow).axe)))) await win.evaluate(axe.source);
  return win.evaluate(async () => {
    const engine = (globalThis as AxeWindow).axe;
    if (!engine) throw new Error('axe-core did not load');
    const result = await engine.run(
      { exclude: [['[data-a11y-picture]']] },
      { runOnly: { type: 'rule', values: ['target-size'] }, resultTypes: ['violations'] },
    );
    return result.violations.flatMap((v) =>
      v.nodes.map(
        (n) => `target-size: ${n.target.join(' ')}: ${(n.failureSummary ?? '').replace(/\s+/gu, ' ')}`,
      ),
    );
  });
}

/** Both side columns as `columns` has them, then laid out. */
async function setColumns(win: Page, columns: { left: string; right: string }): Promise<void> {
  // The live column first: the playlists' most is what the middle leaves beside it.
  for (const [name, key] of [
    ['Resize the live column', columns.right],
    ['Resize the playlists', columns.left],
  ] as const) {
    const splitter = win.getByRole('separator', { name, exact: true });
    await splitter.focus();
    await splitter.press(key);
  }
  await win.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await laidOut(win);
}

/**
 * Laid out, and what a size change starts (a container query, the LIVE block's choice) done: three frames, then every
 * finite animation running then finished (a11y's settled).
 */
async function laidOut(win: Page): Promise<void> {
  await win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }),
  );
  await settled(win);
}

/** Every part of the window that scrolls up and down, at its top or at its end, then laid out. */
async function scrollAll(win: Page, end: boolean): Promise<void> {
  await win.evaluate((end) => {
    for (const el of document.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
      const y = getComputedStyle(el).overflowY;
      if (y === 'auto' || y === 'scroll') el.scrollTop = end ? el.scrollHeight : 0;
    }
  }, end);
  await win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** The window filled as a sabha has it (see the top), in `mode`. */
async function fill(app: ElectronApplication, win: Page, mode: 'pro' | 'simple'): Promise<void> {
  // Set up in Pro Mode (Simple Mode makes no presentation), then the mode.
  await networkOn(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-operator-fit-'));
  // The background: two hours long (its time left the widest), paused.
  const long = await makeTestVideo(win, join(dir, LONG.video), { seconds: 4, hue: 20 });
  writeFileSync(long, setWebmDuration(readFileSync(long), 2 * 3600 * 1000));
  const clip = await makeTestVideo(win, join(dir, CLIP), { seconds: 8, hue: 200 });
  const picture = await makeTestImage(win, join(dir, LONG.picture), { width: 320, height: 180 });
  const tone = makeTestTone(join(dir, LONG.tone), { seconds: 30, hz: 440 });
  const [longId = '', clipId = '', pictureId = '', toneId = ''] = await importAndGetIds(win, [
    long,
    clip,
    picture,
    tone,
  ]);
  const presentationId = await slideWithVideos(win, dir, LONG.presentation, [clipId]);
  await win.evaluate(
    async ({ names, presentationId, longId, pictureId, toneId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(names.playlist, null, false);
      if (!made.ok) throw new Error(made.message);
      const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId },
        { kind: 'media', mediaId: longId },
        { kind: 'media', mediaId: pictureId },
      ]);
      if (!added.ok) throw new Error(added.message);
      for (const name of names.audio) {
        const music = await d.music.create(name);
        if (!music.ok || !music.id) throw new Error('Could not make an audio playlist');
        // A track in the first.
        if (name === names.audio[0]) {
          const tracked = await d.music.addTracks(music.id, [toneId], null);
          if (!tracked.ok) throw new Error('Could not add the track');
        }
      }
    },
    { names: LONG, presentationId, longId, pictureId, toneId },
  );
  await win.getByTestId('playlist-node').filter({ hasText: LONG.playlist }).click();
  await expect(win.getByTestId('column-middle')).toContainText(LONG.presentation);
  // The slide with its video live, the long background under it, paused.
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: longId, media: 'video', fit: 'fill', loop: true },
  });
  await expect(row(win, `slide:${clipId}`).getByRole('slider')).toBeVisible({ timeout: 15_000 });
  const bg = row(win, 'background');
  await expect(bg.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
  await bg.getByRole('button', { name: 'Pause' }).click();
  await expect(bg).toHaveAttribute('data-paused', 'true');
  // The first audio playlist shown, with its track (Audio opened first: every section under LIVE is folded at the
  // start, alpha.22).
  await openSection(win, 'audio');
  await win.getByTestId('music-playlist').filter({ hasText: LONG.audio[0] }).click();
  await expect(win.getByTestId('music-track')).toBeVisible();
  // Every section under LIVE open (Pro Mode's; More tools until alpha.22).
  if (mode === 'pro') await openAllSections(win);
  if (mode === 'simple') {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(win.getByTestId('column-middle')).toContainText(LONG.presentation);
    await expect(row(win, 'background')).toHaveAttribute('data-paused', 'true');
  }
  // A long notice last (a command that goes through takes the notice away).
  await app.evaluate(({ BrowserWindow }, text) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:notice', { text });
  }, LONG.notice);
  await expect(win.getByTestId('operator-notice')).toBeVisible();
}

/**
 * The window at `size` in `mode` with everything in it (fill), Help off or on: with the columns at their least and at
 * their most (Pro Mode's library open over the playlists too), each scroller at its top and its end, nothing is cut,
 * over another, out of its column or under the notice, and every target is 24 px.
 */
async function fitsEverywhere(
  mode: 'pro' | 'simple',
  size: { width: number; height: number },
  help: boolean,
) {
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, size);
  await fill(app, win, mode);
  // Help on (alpha.24: off at a first start): every ? and every key beside a button's words drawn, as in alpha.23.
  if (help) await helpOn(win);
  await win.evaluate(() => document.fonts.ready.then(() => undefined));
  const findings: string[] = [];
  // Pro Mode's library over the playlists too.
  for (const library of mode === 'pro' ? [false, true] : [false]) {
    if (library) await openLibrary(win);
    for (const [name, columns] of Object.entries(COLUMNS)) {
      await setColumns(win, columns);
      for (const end of [false, true]) {
        await scrollAll(win, end);
        // Still there after the columns moved (a resize sends no command).
        await expect(win.getByTestId('operator-notice')).toBeVisible();
        const faults = [...(await fitFaults(win, NAMES)), ...(await smallTargets(win))];
        const where = `${library ? 'the library open, ' : ''}${name}${end ? ', scrolled to the end' : ''}`;
        findings.push(...faults.map((f) => `${where}: ${f}`));
        if (faults.length > 0)
          await test.info().attach(`${mode}-${String(size.width)}-${where}`, {
            body: await win.screenshot(),
            contentType: 'image/png',
          });
      }
    }
  }
  console.log(
    `${mode} ${String(size.width)} × ${String(size.height)}${help ? ' (Help on)' : ''}: ${String(findings.length)} findings\n${findings.join('\n')}`,
  );
  expect(findings).toEqual([]);
  await app.close();
}

for (const mode of ['pro', 'simple'] as const)
  for (const size of SIZES)
    test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}: with the columns at their least and at their most, nothing is cut, over another, out of its column or under the notice, and every target is 24 px`, async () => {
      test.setTimeout(180_000);
      await fitsEverywhere(mode, size, false);
    });

// With Help on (alpha.24): every ?, and every button with its key, as alpha.23 drew them all the time (the release
// lead's review of uihelp, MUST-1): in CI's window in both modes, and in the owner's.
for (const [mode, size] of [
  ['pro', CI_WINDOW],
  ['simple', CI_WINDOW],
  ['pro', OWNERS_WINDOW],
] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)} with Help on: every ? and key drawn, with the columns at their least and at their most, nothing is cut, over another, out of its column or under the notice, and every target is 24 px`, async () => {
    test.setTimeout(180_000);
    await fitsEverywhere(mode, size, true);
  });

/** A tablet's feed opened as its stage display's page opens it (paired-seats.spec.ts): the hello, then the welcome. */
async function connectTablet(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/api/v1/feed`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      resolve();
    });
    ws.once('error', reject);
  });
  const welcome = new Promise<ToDevice>((resolve) =>
    ws.once('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString('utf8')) as ToDevice);
    }),
  );
  ws.send(JSON.stringify({ type: 'hello', token }));
  expect(await welcome).toMatchObject({ type: 'welcome', device: { kind: 'stage' } });
  return ws;
}

/** The status bar's parts and how wide each is, and the row's own width and what it needs, for the run's output. */
const statusParts = (win: Page) =>
  win.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('footer[aria-label="Status"]');
    if (!bar) return null;
    return {
      width: bar.clientWidth,
      needs: bar.scrollWidth,
      parts: [...bar.children].map((c) => ({
        part: c.getAttribute('data-testid') ?? c.tagName.toLowerCase(),
        width: Math.round(c.getBoundingClientRect().width),
        words: c.textContent.slice(0, 60),
      })),
    };
  });

/** Simple Mode's day playlist as theDaysPlaylist tells it. */
interface DaysPlaylist {
  name: string;
  row: Locator;
  mayCut: MayEndInEllipsis[];
}

/**
 * Simple Mode's day playlist in a new library with none open (main/simple-playlist.ts makes "Sabha, <date>" and the
 * window opens it), as the main process tells it: its name, its row in the left column, and the one exception the owner
 * allowed for it (QA23-STAGE8-5): that element, with exactly its name, may end in "…".
 */
async function theDaysPlaylist(win: Page): Promise<DaysPlaylist> {
  const day = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const id = await d.app.simplePlaylist();
    return (await d.playlists.tree()).find((n) => n.id === id) ?? null;
  });
  expect(day?.name).toMatch(/^Sabha, \d{1,2} \p{L}{3,4} \d{4}$/u);
  const { id, name } = day ?? { id: '', name: '' };
  const row = win.getByTestId('column-left').locator(`[data-testid="playlist-node"][data-node-id="${id}"]`);
  await expect(row).toHaveAttribute('data-open', 'true');
  await expect(win.getByTestId('column-middle').getByTestId('playlist-title')).toHaveText(name);
  const mayCut = [
    {
      selector: `[data-testid="column-left"] [data-testid="playlist-node"][data-node-id="${id}"] [data-testid="playlist-node-name"]`,
      words: name,
    },
  ];
  return { name, row, mayCut };
}

/*
 * Stage off with a stage tablet connected (alpha.23; the owner's QA23-STAGE8-2, "Keep Off, say so (Rec.)", and
 * a22-review-stage8's third look, MUST 1): the status bar's Stage off says the tablet shows the audience picture (a
 * tablet in place of its screen icon, the words for screen readers and in its tooltip). In CI's 1024 × 645, with
 * Audience on and off too (an ordinary end of a service):
 * - Pro Mode: nothing anywhere is cut short, over another or past the window's edge (the status bar's version words
 *   shortened for it, QA23-STAGE8-4);
 * - Simple Mode: the same, with the tablet connected and with none showing (paired, not connected: the status bar as
 *   with no tablet), and the Stage off item as wide: the tablet adds nothing. Its own day playlist's name in this new
 *   library alone may end in "…" in the left column, as the owner allowed (QA23-STAGE8-5, 25 Nov 2026, word for word:
 *   "End it in '…' (Recommended)"): the same one-element exception as the day playlist's own state below, checked as
 *   strictly (whole in its title, to a screen reader and in the middle's header).
 */
for (const mode of ['pro', 'simple'] as const)
  for (const audience of ['on', 'off'] as const)
    test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645, Stage off with a stage tablet connected, Audience ${audience}: ${mode === 'pro' ? 'nothing cut short or past the window’s edge' : 'nothing cut short or past the window’s edge, with the tablet or without; the day playlist’s name alone may end in “…” (the owner’s QA23-STAGE8-5)'}`, async () => {
      test.setTimeout(120_000);
      const { app } = await launchApp(NETWORK_ENV);
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      const { port } = await networkOn(win);
      // Paired in Pro Mode (Simple Mode pairs nothing), not connected yet: it shows nothing, so the status bar is as
      // with no tablet at all (no hint: stageTabletsShowing counts connected ones only).
      const token = await pairToken(win, port, 'stage', 'Placeholder stage tablet');
      // Off from Pro Mode first (Simple Mode only turns them on).
      for (const which of audience === 'off' ? (['stage', 'audience'] as const) : (['stage'] as const)) {
        const turned = await win.evaluate(
          (w) => (globalThis as PageGlobals).drashti.screenSwitches.turn(w, false),
          which,
        );
        expect(turned.ok).toBe(true);
      }
      let day: DaysPlaylist | null = null;
      if (mode === 'simple') {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
        day = await theDaysPlaylist(win);
      }
      await expect(win.getByTestId('switch-off-audience')).toHaveCount(audience === 'off' ? 1 : 0);
      const stageOff = win.getByTestId('switch-off-stage');
      const faultsNow = async (label: string) => {
        await win.evaluate(() => document.fonts.ready.then(() => undefined));
        console.log(
          `${mode}, Audience ${audience}, ${label}: the status bar ${JSON.stringify(await statusParts(win))}`,
        );
        // Simple Mode: the day playlist's name in the left column alone may end in "…" (QA23-STAGE8-5); Pro Mode: none.
        const faults = [...(await fitFaults(win, NAMES, day?.mayCut)), ...(await smallTargets(win))];
        if (faults.length > 0)
          await test.info().attach(`${mode}-stage-off-audience-${audience}-${label}`, {
            body: await win.screenshot(),
            contentType: 'image/png',
          });
        if (day) await dayNameStrictly(win, day.row, day.name, `${mode}, Audience ${audience}, ${label}`);
        const box = await stageOff.boundingBox();
        return { faults, width: Math.round(box?.width ?? 0) };
      };
      // The same state with no tablet showing first.
      await expect(stageOff).toContainText('Stage off');
      await expect(win.getByTestId('switch-off-stage-tablet')).toHaveCount(0);
      const without = await faultsNow('no tablet showing');
      // The stage tablet connected: said by a tablet in place of the screen icon, the sentence for screen readers and
      // in its tooltip.
      const feed = await connectTablet(port, token);
      await expect(win.getByTestId('switch-off-stage-tablet')).toBeVisible();
      await expect(win.getByTestId('switch-off-stage-hint')).toHaveText(
        'the stage tablet shows the audience picture',
      );
      const withTablet = await faultsNow('a tablet connected');
      expect(withTablet.width, 'the Stage off item no wider with the tablet').toBe(without.width);
      expect(withTablet.faults).toEqual([]);
      // Simple Mode: none with no tablet showing either.
      if (mode === 'simple') expect(without.faults).toEqual([]);
      feed.close();
      await app.close();
    });

/** Text taken as itself in a regular expression. */
const literally = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Simple Mode's day playlist's name as the owner allowed it (QA23-STAGE8-5, 25 Nov 2026, word for word: "End it in '…'
 * (Recommended)"), checked strictly: in the left column it ends in "…" when it does not fit, cut by CSS on one line,
 * and is whole on hover (its own title, the one under the pointer) and to a screen reader (its row's name begins with
 * it); in the middle's header it is whole, in sight, and its name. Whether the left column cuts it now.
 */
async function dayNameStrictly(win: Page, row: Locator, name: string, where: string): Promise<boolean> {
  const shown = row.getByTestId('playlist-node-name');
  await expect(shown, `${where}: the left column's name`).toHaveCount(1);
  await expect(shown, `${where}: the left column's name, whole in its words`).toHaveText(name);
  await expect(shown, `${where}: the left column's name, whole on hover`).toHaveAttribute('title', name);
  await expect(row, `${where}: the left column's row, whole to a screen reader`).toHaveAccessibleName(
    new RegExp(`^${literally(name)}(?: |$)`, 'u'),
  );
  const left = await shown.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      cut: el.scrollWidth > el.clientWidth + 1,
      ellipsis: style.textOverflow === 'ellipsis' && style.overflowX === 'hidden',
      oneLine:
        style.whiteSpace === 'nowrap' &&
        new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size === 1,
      hoverShows: under?.closest('[title]') === el,
    };
  });
  expect(left.ellipsis, `${where}: the left column's name ends in “…” by CSS`).toBe(true);
  expect(left.oneLine, `${where}: the left column's name on one line`).toBe(true);
  expect(left.hoverShows, `${where}: the pointer over the left column's name shows its own title`).toBe(true);
  const header = win.getByTestId('column-middle').getByTestId('playlist-title');
  await expect(header, `${where}: the middle's header`).toHaveText(name);
  await expect(header, `${where}: the middle's header to a screen reader`).toHaveAccessibleName(name);
  await expect(header, `${where}: the middle's header in sight`).toBeInViewport({ ratio: 1 });
  expect(
    await header.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    `${where}: the middle's header whole, not cut`,
  ).toBe(true);
  return left.cut;
}

test('Simple Mode at 1024 × 645 with the day’s own playlist (the owner’s QA23-STAGE8-5): its name in the left column alone may end in “…”, whole in its title, to a screen reader and in the middle’s header; nothing else is cut, over another or out of its column, and every target is 24 px', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // A new library with none open: Simple Mode makes the day's own "Sabha, <date>" playlist and opens it
  // (main/simple-playlist.ts).
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // That one element, with exactly the day's name, may end in "…"; nothing else may that NAMES does not name.
  const { name, row, mayCut } = await theDaysPlaylist(win);
  await win.evaluate(() => document.fonts.ready.then(() => undefined));
  const states: [string, { left: string; right: string } | null][] = [
    ['as Simple Mode opens', null],
    ...Object.entries(COLUMNS),
  ];
  const findings: string[] = [];
  const cutIn: string[] = [];
  for (const [state, columns] of states) {
    // As it opens: laid out and done arriving, with the very wait setColumns ends with.
    if (columns) await setColumns(win, columns);
    else await laidOut(win);
    for (const end of [false, true]) {
      await scrollAll(win, end);
      const where = `${state}${end ? ', scrolled to the end' : ''}`;
      const faults = [...(await fitFaults(win, NAMES, mayCut)), ...(await smallTargets(win))];
      findings.push(...faults.map((f) => `${where}: ${f}`));
      if (faults.length > 0)
        await test.info().attach(`simple-day-playlist-${where}`, {
          body: await win.screenshot(),
          contentType: 'image/png',
        });
      if (await dayNameStrictly(win, row, name, where)) cutIn.push(where);
    }
  }
  console.log(
    `simple, the day's playlist “${name}”, 1024 × 645: ${String(findings.length)} findings; its name ends in “…” ${cutIn.length > 0 ? cutIn.join('; ') : 'nowhere'}\n${findings.join('\n')}`,
  );
  expect(findings).toEqual([]);
  // The owner's case itself is met: with the columns at their least the left column cuts the name, so it ends in "…".
  expect(cutIn, 'the left column cuts the day’s name with the columns at their least').toContain(
    'both columns at their least',
  );
  await app.close();
});

/** Five refused files told by the main process, as a watched folder's automatic import tells them, and a notice. */
const REFUSED = Array.from({ length: 5 }, (_, i) => ({
  name: `Placeholder refused file ${String(i + 1)} with a long name.odt`,
  reason: 'Drashti doesn’t read .odt files.',
}));

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode, the notices at their most (four import notices, one more and a notice): Back and Next stay in sight in CI's 1024 × 645, and every Dismiss can be reached whole, there and in Drashti's shortest window`, async () => {
    test.setTimeout(120_000);
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    if (mode === 'simple') {
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      await expect(win.getByTestId('simple-mode')).toBeVisible();
    }
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await app.evaluate(
      ({ BrowserWindow }, { refused, text }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.webContents.getURL().includes('index.html')) continue;
          w.webContents.send('library:automatic-import-notice', { refused });
          w.webContents.send('app:notice', { text });
        }
      },
      { refused: REFUSED, text: LONG.notice },
    );
    const place = win.getByTestId('live-column').getByTestId('notice-place');
    await expect(place.getByTestId('import-notice')).toHaveCount(4);
    await expect(place.getByText('1 more import notice', { exact: true })).toBeVisible();
    await expect(place.getByTestId('operator-notice')).toBeVisible();
    const live = win.getByRole('complementary', { name: 'Live', exact: true });
    // Drashti's shortest window: 540 px high (the window's least, App.tsx).
    for (const size of [CI_WINDOW, { width: 1024, height: 540 }]) {
      const where = `${String(size.width)} × ${String(size.height)}`;
      await sizeOperatorWindow(app, win, size);
      await liveColumnToTop(live);
      if (size === CI_WINDOW)
        for (const id of ['show-back', 'show-next'])
          await expect(win.getByTestId(id), `${id} in sight at ${where}`).toBeInViewport({ ratio: 1 });
      // Every Dismiss (the four lines', Dismiss all and the notice's), reached as a person does, whole.
      const dismisses = place.getByRole('button', { name: /^Dismiss/u });
      await expect(dismisses).toHaveCount(6);
      for (const dismiss of await dismisses.all()) {
        await dismiss.scrollIntoViewIfNeeded();
        await expect(dismiss, `a Dismiss whole at ${where}`).toBeInViewport({ ratio: 1 });
      }
      // Reaching them moved nothing of LIVE: Back and Next still in sight.
      if (size === CI_WINDOW)
        for (const id of ['show-back', 'show-next'])
          await expect(win.getByTestId(id), `${id} still in sight at ${where}`).toBeInViewport({ ratio: 1 });
    }
    await app.close();
  });
