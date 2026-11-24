import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NETWORK_ENV, networkOn } from './devices';
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

/**
 * Everything that does not fit in the operator window as it is laid out now, each in words: a control, a heading or a
 * key hint cut (its contents run past it), cut off by what holds it, running out of its column, lying over another, or
 * under a notice; words lying over a control; words of Drashti's own cut short with an ellipsis (a name the operator
 * gave, placeholder here, may be); anything scrolling sideways. What a scroller has scrolled out of sight is not
 * looked at, nor what is hidden from people (aria-hidden, unseen).
 */
const fitFaults = (win: Page) =>
  win.evaluate((names) => {
    const out = new Set<string>();
    const REGIONS: [string, string][] = [
      ['the header', '[data-header]'],
      ['the left column', '[data-testid="column-left"]'],
      ['the middle', '[data-testid="column-middle"]'],
      ['the live column', '[data-testid="column-right"]'],
      ['the quick bar', '[data-testid="quick-bar"]'],
      ['the bar of clears', '[data-testid="layer-bar"], [data-testid="simple-buttons"]'],
      ['the status bar', 'footer[aria-label="Status"]'],
    ];
    const NOTICES = '[data-testid="operator-notice"], [data-testid="import-notice"]';
    const CONTROLS =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"], [data-show-control], [data-testid="next-up"]';
    const LABELS = 'h1, h2, h3, h4, [role="heading"], label, legend, kbd';
    const WORDS_CUT =
      'button, a, [role="button"], [role="tab"], kbd, h1, h2, h3, h4, [role="heading"], label, legend';

    interface Box {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    const boxOf = (r: DOMRect | Box): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    const meet = (a: Box, b: Box): Box | null => {
      const m = {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
      };
      return m.right - m.left > 0.5 && m.bottom - m.top > 0.5 ? m : null;
    };
    const named = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      const label = el.getAttribute('aria-label');
      const words = el.textContent.replace(/\s+/gu, ' ').trim().slice(0, 40);
      const what = el.tagName.toLowerCase();
      return `${what} “${id ?? label ?? words}”`;
    };

    /** Not drawn, or drawn unseen (a screen reader's words alone, hidden, see-through). */
    const unseen = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return true;
      for (let at: Element | null = el; at; at = at.parentElement) {
        const s = getComputedStyle(at);
        if (s.visibility === 'hidden' || Number(s.opacity) < 0.05) return true;
      }
      return false;
    };
    /** Not there for people: unseen, inert, or hidden from screen readers (the live picture excepted). */
    const hidden = (el: Element): boolean => {
      if (el.closest('[inert]')) return true;
      const quiet = el.closest('[aria-hidden="true"]');
      if (quiet && el.closest('[data-testid="live-preview"]') !== el) return true;
      return unseen(el);
    };

    /**
     * What of `box` is in sight: cut by every box around it that hides its overflow, scrolls, or is the window. Says
     * too whether something that does not scroll (overflow hidden) cut it, and where.
     */
    const inSight = (from: Element | null, box: Box): { seen: Box | null; cutBy: Element | null } => {
      let seen: Box | null = meet(box, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
      let cutBy: Element | null = null;
      for (let at = from; at && seen; at = at.parentElement) {
        const s = getComputedStyle(at);
        const x = s.overflowX;
        const y = s.overflowY;
        if (x === 'visible' && y === 'visible') continue;
        const a = at.getBoundingClientRect();
        const clipX = x !== 'visible';
        const clipY = y !== 'visible';
        const edge = {
          left: clipX ? a.left : -Infinity,
          right: clipX ? a.right : Infinity,
          top: clipY ? a.top : -Infinity,
          bottom: clipY ? a.bottom : Infinity,
        };
        // What is still in sight of it, past the boxes inside this one (one that scrolls has its own room).
        const cutX = clipX && (seen.left < edge.left - 1 || seen.right > edge.right + 1);
        const cutY = clipY && (seen.top < edge.top - 1 || seen.bottom > edge.bottom + 1);
        // Cut by a box that cannot scroll to it: out of reach (a scroller's own cut is scrolling, said below if sideways).
        const scrollsX = x === 'auto' || x === 'scroll';
        const scrollsY = y === 'auto' || y === 'scroll';
        if (!cutBy && ((cutX && !scrollsX) || (cutY && !scrollsY))) cutBy = at;
        seen = meet(seen, edge);
      }
      return { seen, cutBy };
    };

    const notices = [...document.querySelectorAll(NOTICES)].filter((n) => !hidden(n));
    // What of each is in sight (the notices scroll in their own place when there are many: one scrolled away covers
    // nothing).
    const noticeBoxes = notices.map((n) => inSight(n.parentElement, boxOf(n.getBoundingClientRect())).seen);

    interface Part {
      el: Element;
      region: string;
      seen: Box;
      control: boolean;
    }
    const parts: Part[] = [];
    const regions = REGIONS.flatMap(([name, selector]) =>
      [...document.querySelectorAll(selector)].filter((r) => !hidden(r)).map((r) => ({ name, r })),
    );
    for (const { name, r } of regions) {
      const edge = r.getBoundingClientRect();
      // Nothing in it scrolls sideways.
      for (const el of [r, ...r.querySelectorAll('*')]) {
        if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) continue;
        const x = getComputedStyle(el).overflowX;
        if ((x === 'auto' || x === 'scroll') && !hidden(el))
          out.add(`${name}: ${named(el)} scrolls sideways`);
      }
      for (const el of r.querySelectorAll(`${CONTROLS}, ${LABELS}`)) {
        if (hidden(el) || el.closest(NOTICES)) continue;
        const box = boxOf(el.getBoundingClientRect());
        const { seen, cutBy } = inSight(el.parentElement, box);
        if (cutBy) out.add(`${name}: ${named(el)} is cut off by ${named(cutBy)}`);
        if (!seen) continue;
        if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5)
          out.add(`${name}: ${named(el)} runs out of it`);
        if (el.matches(WORDS_CUT) && el instanceof HTMLElement) {
          // Cut with an ellipsis is the next check's (a name the operator gave may be).
          const style = getComputedStyle(el);
          const ellipsis = style.textOverflow === 'ellipsis' && style.overflowX !== 'visible';
          if (!ellipsis && el.scrollWidth > el.clientWidth + 1)
            out.add(
              `${name}: ${named(el)} is cut (${String(el.scrollWidth)} > ${String(el.clientWidth)} px)`,
            );
          // Its key and icon inside it.
          for (const inner of el.querySelectorAll('kbd, svg'))
            if (!unseen(inner) && !meet(boxOf(inner.getBoundingClientRect()), box))
              out.add(`${name}: ${named(el)}'s ${inner.tagName.toLowerCase()} is outside it`);
        }
        parts.push({ el, region: name, seen, control: el.matches(CONTROLS) });
      }
      // Words of Drashti's own cut short with an ellipsis (a name the operator gave may be: NAMES).
      for (const el of r.querySelectorAll('*')) {
        if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) continue;
        const style = getComputedStyle(el);
        if (style.textOverflow !== 'ellipsis' || style.overflowX === 'visible' || hidden(el)) continue;
        const words = el.textContent.replace(/\s+/gu, ' ').trim();
        if (
          words !== '' &&
          !names.some((n) => words.includes(n)) &&
          inSight(el.parentElement, boxOf(el.getBoundingClientRect())).seen
        )
          out.add(`${name}: “${words.slice(0, 60)}” is cut short`);
      }
    }

    // Controls and headings lying over each other, and controls under a notice. A control wholly in another's box is
    // an action in a row's own room (Rename and Delete at its end): the row's words and icons must not be under it.
    const within = (a: Box, b: Box) =>
      a.left >= b.left - 0.5 &&
      a.right <= b.right + 0.5 &&
      a.top >= b.top - 0.5 &&
      a.bottom <= b.bottom + 0.5;
    const icons = (el: Element) =>
      [...el.querySelectorAll('svg, img')]
        .filter((g) => !unseen(g))
        .map((g) => boxOf(g.getBoundingClientRect()));
    parts.forEach((a, i) => {
      for (const b of parts.slice(i + 1)) {
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (a.el instanceof HTMLLabelElement && a.el.control === b.el) continue;
        if (b.el instanceof HTMLLabelElement && b.el.control === a.el) continue;
        if (!meet(a.seen, b.seen)) continue;
        const outer = within(b.seen, a.seen) ? a : within(a.seen, b.seen) ? b : null;
        const inner = outer === a ? b : a;
        if (outer?.control && inner.control) {
          if (icons(outer.el).some((g) => meet(g, inner.seen)))
            out.add(`${outer.region}: an icon of ${named(outer.el)} lies under ${named(inner.el)}`);
          continue;
        }
        out.add(`${a.region}: ${named(a.el)} and ${named(b.el)} lie over each other`);
      }
      if (a.control)
        noticeBoxes.forEach((n, k) => {
          if (n && meet(a.seen, n))
            out.add(`${a.region}: ${named(a.el)} is under ${named(notices[k] ?? a.el)}`);
        });
    });

    // Words lying over a control that does not hold them.
    const controls = parts.filter((p) => p.control);
    for (const { name, r } of regions) {
      const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim() || hidden(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          // Its own box's cut counts (an ellipsis's words).
          const { seen } = inSight(parent, boxOf(rect));
          if (!seen) continue;
          for (const c of controls)
            if (!c.el.contains(parent) && !parent.contains(c.el) && meet(seen, c.seen))
              out.add(`${name}: “${node.textContent.trim().slice(0, 40)}” lies over ${named(c.el)}`);
        }
      }
    }
    return [...out];
  }, NAMES);

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
  // Laid out, and what a size change starts (a container query, the LIVE block's choice) done.
  await win.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }),
  );
  await win.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
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

for (const mode of ['pro', 'simple'] as const)
  for (const size of SIZES)
    test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}: with the columns at their least and at their most, nothing is cut, over another, out of its column or under the notice, and every target is 24 px`, async () => {
      test.setTimeout(180_000);
      const { app } = await launchApp(NETWORK_ENV);
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, size);
      await fill(app, win, mode);
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
            const faults = [...(await fitFaults(win)), ...(await smallTargets(win))];
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
        `${mode} ${String(size.width)} × ${String(size.height)}: ${String(findings.length)} findings\n${findings.join('\n')}`,
      );
      expect(findings).toEqual([]);
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
