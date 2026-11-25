import type { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium, devices, expect, test, webkit } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callBody, placeholderComputer, readAnswer } from '../access-core';
import { type AccessStandIn, accessStandIn } from '../access-standin';
import type { Engine } from './devices';
import { CHAT_API } from '../../src/shared/chat';
import { apiCall, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken, PHONE } from './devices';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { longPress } from './phone-gestures';
import { setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage } from './test-media';

/*
 * The whole-app fit pass, part 3 (alpha.21, the owner's "dont like the design here. frontend issue." and "all good fit
 * in 21", 22 Nov 2026): what people open on a phone or another browser. Each page at 360 × 740, 390 × 844 and
 * 430 × 932, upright and held sideways, and on a 768 × 1024 tablet, in Safari's engine and Chrome's, with long
 * placeholder names: the phone remote on each of its tabs and in each of its sheets, its viewer, a row's menu and the
 * Picture editor, files from phones (Add from this Phone… and Shared from Drashti), the Chat (alpha.23: its messages with
 * long names, Change name and a new message's banner), the pairing page (as a QR code opens it, a wrong code, a device
 * removed), the announcements page with what it sent, the chat page (/chat), the stage display, and the access
 * list's pages an emailed Approve or Reject link opens (the link page on GitHub Pages, and the one a link sent before
 * x38 opens on the web app). On each, nothing is cut, lies over another, is under another, or is off the screen with no way to it; nothing
 * scrolls sideways; every target is 44 px (docs/design.md §5, §16); no box a phone types in has words under 16 px (a
 * phone zooms in on one); and on Drashti's own phone pages no words are under 16 px (§16, its two small kinds
 * aside). The remote is one screen: Back and Next wholly on it, only its middle scrolling. Placeholder names and
 * generated media only; codes and tokens are made at run time and never printed.
 */

// An action that cannot be done says so in 20 s, what it waited for, rather than using up the whole test.
test.use({ actionTimeout: 20_000 });

/** Phones upright and held sideways, and a tablet. */
const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 768, height: 1024 },
] as const;

type Size = (typeof SIZES)[number];

const sized = (s: Size) => `${String(s.width)} × ${String(s.height)}`;

const LONG = {
  device: 'Placeholder Phone of the Volunteer at the Back of the Hall',
  playlist: 'Placeholder Sunday Evening Sabha with a Long Name for the Phones',
  header: 'Placeholder Opening Part of the Evening with a Long Header',
  presentation: 'Placeholder Opening Words with a Long Name for the Phones',
  picture: 'Placeholder Wide Picture of the Stage with a Long Name',
  message: 'Placeholder Car Parking Message with a Long Name',
  timer: 'Placeholder Sabha Starts In with a Long Name for Phones',
  music: 'Placeholder Music Before the Sabha with a Long Name',
  announcement:
    'Placeholder announcement: the car with the long placeholder number plate in the front row of the car park, please move it now',
  from: 'Placeholder Volunteer at the Car Park Gate with a Long Name',
  gmail: 'placeholder.volunteer.at.the.back.of.the.hall.with.a.long.address@example.com',
  name: 'Placeholder Volunteer with a Long Name Typed in Drashti',
  computer: 'Placeholder Mac in the Sabha Hall Office with a Long Name',
  photo: 'Placeholder Photo from the Volunteer Phone with a Long Name',
  chat: 'Placeholder chat message from the car park gate, long enough to wrap over several lines on a phone 🙏',
  reply: 'Placeholder answer from this phone, long enough to wrap over two or three lines on a small phone',
} as const;

/** What a page is checked for, by the kind of page it is. */
interface Rules {
  width: number;
  height: number;
  /** The smallest target, each way (44: docs/design.md §5, every phone page; the link pages' buttons are 48). */
  target: number;
  /** No words under 16 px (Drashti's own phone pages, §16: a tab's small word and a badge aside). */
  textFloor: boolean;
  /** The remote: Back and Next wholly on the screen and only its middle scrolling. */
  remote: boolean;
  /** Left out: a picture of the screens (the stage display's own screen, a slide's picture), never fitted words. */
  ignore: string;
}

/**
 * Everything on the page that does not fit, each in words: a control or heading cut (its words run past it), cut off
 * by what holds it, off the side of the screen, off its top or bottom with no way to scroll to it, under something
 * else (what a tap there reaches), lying over another, words over a control, Drashti's own words cut short with an
 * ellipsis (a name someone typed, placeholder here, may be); anything scrolling sideways; a target too small; a box
 * to type in under 16 px; words under 16 px where the page has none. The open sheet, dialog or viewer is checked
 * alone (what is under it is not there for the moment). What a scroller has scrolled out of sight is not looked at,
 * nor what is hidden from people.
 */
const faultsIn = (o: Rules) => {
  const out = new Set<string>();
  const vw = o.width;
  const vh = o.height;
  const CONTROLS =
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="spinbutton"]';
  const TARGETS =
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]';
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
  const px = (n: number) => String(Math.round(n));
  const named = (el: Element): string => {
    const id = el.getAttribute('data-testid');
    const label = el.getAttribute('aria-label');
    const words = el.textContent.replace(/\s+/gu, ' ').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()} “${id ?? label ?? words}”`;
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
  /** Not there for people (unseen, inert, hidden from screen readers), or a picture of the screens. */
  const hidden = (el: Element): boolean =>
    el.closest('[inert], [aria-hidden="true"]') !== null ||
    (o.ignore !== '' && el.closest(o.ignore) !== null) ||
    unseen(el);
  /** Held in place on the screen (fixed, or in something fixed): the page's own scroll never reaches past it. */
  const fixed = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = at.parentElement)
      if (getComputedStyle(at).position === 'fixed') return true;
    return false;
  };

  /**
   * What of `box` its holders let show (`within`: cut by every box around it that hides its overflow or scrolls),
   * and of that what is on the screen (`seen`); and the first holder that cut it with no way to scroll to it.
   */
  const inSight = (from: Element | null, box: Box) => {
    let within: Box | null = box;
    let cutBy: Element | null = null;
    for (let at = from; at && within; at = at.parentElement) {
      if (at === document.documentElement || at === document.body) continue;
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
      const cutX = clipX && (within.left < edge.left - 1 || within.right > edge.right + 1);
      const cutY = clipY && (within.top < edge.top - 1 || within.bottom > edge.bottom + 1);
      const scrollsX = x === 'auto' || x === 'scroll';
      const scrollsY = y === 'auto' || y === 'scroll';
      if (!cutBy && ((cutX && !scrollsX) || (cutY && !scrollsY))) cutBy = at;
      within = meet(within, edge);
    }
    const seen = within ? meet(within, { left: 0, top: 0, right: vw, bottom: vh }) : null;
    return { within, seen, cutBy };
  };

  const page = document.scrollingElement ?? document.documentElement;
  /** What reaches the page's own far edge (what makes it scroll), hidden or not: the innermost, three at most. */
  const reaching = (edge: (r: DOMRect) => number, far: number): string => {
    const all = [...document.body.querySelectorAll('*')].filter(
      (el) => edge(el.getBoundingClientRect()) >= far - 1.5,
    );
    const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
    return inner
      .slice(0, 3)
      .map((el) => `${named(el)} .${(el.getAttribute('class') ?? '').split(/\s+/u).slice(0, 5).join('.')}`)
      .join(', ');
  };
  if (innerWidth > vw + 0.5)
    out.add(`the page is laid out ${px(innerWidth)} px wide on a ${px(vw)} px screen`);
  if (page.scrollWidth > vw + 1)
    out.add(
      `the page scrolls sideways (${px(page.scrollWidth)} px on a ${px(vw)} px screen), reached by ${reaching((r) => r.right + scrollX, page.scrollWidth)}`,
    );
  const pageScrolls = page.scrollHeight > vh + 1;

  // The open sheet, dialog or viewer on top, else the page.
  const dialogs = [...document.querySelectorAll('[aria-modal="true"]')].filter((d) => !hidden(d));
  const region: Element = dialogs[dialogs.length - 1] ?? document.body;

  // Nothing in it scrolls sideways.
  for (const el of [region, ...region.querySelectorAll('*')]) {
    if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) continue;
    const x = getComputedStyle(el).overflowX;
    if ((x === 'auto' || x === 'scroll') && !hidden(el))
      out.add(`${named(el)} scrolls sideways (${px(el.scrollWidth)} > ${px(el.clientWidth)} px)`);
  }

  interface Part {
    el: Element;
    seen: Box;
    control: boolean;
  }
  const parts: Part[] = [];
  for (const el of region.querySelectorAll(`${CONTROLS}, ${LABELS}`)) {
    if (hidden(el)) continue;
    const box = boxOf(el.getBoundingClientRect());
    const { within, seen, cutBy } = inSight(el.parentElement, box);
    if (cutBy) out.add(`${named(el)} is cut off by ${named(cutBy)}`);
    if (within && (within.left < -0.5 || within.right > vw + 0.5))
      out.add(`${named(el)} is off the side of the screen (${px(within.left)} to ${px(within.right)})`);
    if (within && (within.top < -0.5 || within.bottom > vh + 0.5) && (fixed(el) || !pageScrolls))
      out.add(
        `${named(el)} is off the screen with no way to it (${px(within.top)} to ${px(within.bottom)} of ${px(vh)})`,
      );
    if (!seen) continue;
    if (el.matches(WORDS_CUT) && el instanceof HTMLElement) {
      if (el.scrollWidth > el.clientWidth + 1)
        out.add(`${named(el)} is cut (${px(el.scrollWidth)} > ${px(el.clientWidth)} px)`);
      for (const inner of el.querySelectorAll('kbd, svg'))
        if (!unseen(inner) && !meet(boxOf(inner.getBoundingClientRect()), box))
          out.add(`${named(el)}'s ${inner.tagName.toLowerCase()} is outside it`);
    }
    const control = el.matches(CONTROLS);
    // What a tap on it reaches: itself (or what it holds, or its label), never something over it.
    if (control) {
      const hit = document.elementFromPoint((seen.left + seen.right) / 2, (seen.top + seen.bottom) / 2);
      const own =
        hit === null ||
        el.contains(hit) ||
        hit.contains(el) ||
        (hit.closest('label')?.contains(el) ?? false) ||
        (el instanceof HTMLLabelElement && el.control === hit);
      if (!own) out.add(`${named(el)} is under ${named(hit)}`);
    }
    parts.push({ el, seen, control });
  }

  // Controls and headings lying over each other.
  parts.forEach((a, i) => {
    for (const b of parts.slice(i + 1)) {
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.el instanceof HTMLLabelElement && a.el.control === b.el) continue;
      if (b.el instanceof HTMLLabelElement && b.el.control === a.el) continue;
      if (meet(a.seen, b.seen)) out.add(`${named(a.el)} and ${named(b.el)} lie over each other`);
    }
  });

  // Words lying over a control that does not hold them.
  const controls = parts.filter((p) => p.control);
  const walk = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim() || hidden(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      const { seen } = inSight(parent, boxOf(rect));
      if (!seen) continue;
      for (const c of controls)
        if (!c.el.contains(parent) && !parent.contains(c.el) && meet(seen, c.seen))
          out.add(`“${node.textContent.trim().slice(0, 40)}” lies over ${named(c.el)}`);
    }
  }

  // Words of Drashti's own cut short with an ellipsis (a placeholder name may be).
  for (const el of region.querySelectorAll('.truncate, .text-ellipsis, [class*="line-clamp"]')) {
    if (!(el instanceof HTMLElement) || hidden(el)) continue;
    const short = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    const words = el.textContent.replace(/\s+/gu, ' ').trim();
    if (
      short &&
      words !== '' &&
      !/placeholder/iu.test(words) &&
      inSight(el.parentElement, boxOf(el.getBoundingClientRect())).seen
    )
      out.add(`“${words.slice(0, 60)}” is cut short`);
  }

  // Never seen whole: a control, or the remote's live picture, taller than what scrolls it (the page, or a scroller).
  for (const el of region.querySelectorAll(`${CONTROLS}, [data-testid="remote-live"]`)) {
    if (unseen(el) || el.closest('[inert]') || (!el.matches('[data-testid="remote-live"]') && hidden(el)))
      continue;
    const tall = el.getBoundingClientRect().height;
    for (let at = el.parentElement; at; at = at.parentElement) {
      const y = at === document.body ? 'auto' : getComputedStyle(at).overflowY;
      if (y !== 'auto' && y !== 'scroll') continue;
      const room = at === document.body ? vh : at.clientHeight;
      if (tall > room + 1)
        out.add(
          `${named(el)} is taller than what scrolls it (${px(tall)} > ${px(room)} px): it is never seen whole`,
        );
      break;
    }
  }

  // Targets (a tick box or radio counts with its label, which takes the tap too).
  for (const el of region.querySelectorAll(TARGETS)) {
    if (hidden(el)) continue;
    const choice = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
    const r = ((choice ? el.closest('label') : null) ?? el).getBoundingClientRect();
    if (r.width < o.target - 0.5 || r.height < o.target - 0.5)
      out.add(`${named(el)} is a ${px(r.width)} × ${px(r.height)} px target (${String(o.target)} at least)`);
  }

  // A box to type in: 16 px words at least, or a phone zooms in on it.
  for (const el of region.querySelectorAll('input, textarea, select')) {
    if (el instanceof HTMLInputElement && ['hidden', 'checkbox', 'radio', 'range', 'file'].includes(el.type))
      continue;
    if (hidden(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 15.99)
      out.add(`${named(el)}: its words are ${String(size)} px (16 at least, or a phone zooms in)`);
  }

  // Words under 16 px (a tab bar's word under its icon and a state badge are small on purpose).
  if (o.textFloor)
    for (const el of region.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || hidden(el)) continue;
      if (el.closest('[data-small-label], [data-badge]')) continue;
      if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 15.99)
        out.add(
          `“${el.textContent.replace(/\s+/gu, ' ').trim().slice(0, 40)}” is ${String(size)} px (16 at least)`,
        );
    }

  // The remote is one screen: Back and Next wholly on it, and only its middle scrolls.
  if (o.remote && region === document.body) {
    for (const id of ['remote-back', 'remote-next-button']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        out.add(`there is no ${id}`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5)
        out.add(`${named(el)} is not wholly on the screen (${px(r.top)} to ${px(r.bottom)} of ${px(vh)})`);
    }
    if (pageScrolls)
      out.add(
        `the remote's page scrolls (${px(page.scrollHeight)} px on a ${px(vh)} px screen): only its middle should; reached by ${reaching((r) => r.bottom + scrollY, page.scrollHeight)}`,
      );
  }
  return [...out];
};

/** A phone of this engine's (Chrome on an Android phone, Safari on an iPhone), at the first size. */
async function phoneOf(engine: Engine): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  const context = await browser.newContext({
    ...devices[PHONE[engine]],
    viewport: { width: SIZES[0].width, height: SIZES[0].height },
    bypassCSP: true,
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/** Laid out, and every animation that is running and ends, ended (one paused moves nothing). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/**
 * The region's outermost scrollers (the open sheet's, else the page's), each marked `data-fit-scroller`, and how far
 * each scrolls; and the page itself, as -1, where it scrolls.
 */
const markScrollers = () => {
  const dialogs = [...document.querySelectorAll('[aria-modal="true"]')].filter(
    (d) => d.getClientRects().length > 0,
  );
  const region = dialogs[dialogs.length - 1] ?? document.body;
  const scrolls = (el: Element) => {
    const y = getComputedStyle(el).overflowY;
    return (y === 'auto' || y === 'scroll') && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
  };
  const all = [...region.querySelectorAll('*')].filter(scrolls);
  const outer = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  outer.forEach((el, i) => {
    el.setAttribute('data-fit-scroller', String(i));
  });
  const page = document.scrollingElement ?? document.documentElement;
  return [
    ...outer.map((el, i) => ({ i, height: el.clientHeight, full: el.scrollHeight })),
    ...(region === document.body && page.scrollHeight > innerHeight + 1
      ? [{ i: -1, height: innerHeight, full: page.scrollHeight }]
      : []),
  ];
};

/** One scroller (-1: the page) scrolled to `top`, at once. */
const scrollTo = ({ i, top }: { i: number; top: number }) => {
  const el = i === -1 ? null : document.querySelector(`[data-fit-scroller="${String(i)}"]`);
  if (el) el.scrollTo({ top, behavior: 'instant' });
  else if (i === -1) window.scrollTo({ top, behavior: 'instant' });
};

/** Findings of every look, and a picture of each look that has any. */
class Sweep {
  readonly findings: string[] = [];
  /** How tall the remote's middle is at each size (what scrolls between the header and Back and Next): a record. */
  readonly middles = new Map<string, number>();
  constructor(
    private readonly page: Page,
    private readonly rules: Omit<Rules, 'width' | 'height'>,
  ) {}

  /**
   * The page as it is now, at `size`, laid out and settled: at the top, then scrolled down a screen at a time through
   * each of its scrollers (and the page, where it scrolls), so what is further down is looked at too.
   */
  async look(size: Size, what: string, rules: Partial<Omit<Rules, 'width' | 'height'>> = {}): Promise<void> {
    await settle(this.page);
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined));
    const given = { ...this.rules, ...rules, width: size.width, height: size.height };
    const seen = new Set(await this.page.evaluate(faultsIn, given));
    const scrollers = await this.page.evaluate(markScrollers);
    for (const { i, height, full } of scrollers) {
      const step = Math.max(100, Math.floor(height * 0.8));
      for (let top = step; top < full - height + step; top += step) {
        await this.page.evaluate(scrollTo, { i, top: Math.min(top, full - height) });
        await settle(this.page);
        for (const f of await this.page.evaluate(faultsIn, given)) seen.add(f);
      }
      await this.page.evaluate(scrollTo, { i, top: 0 });
    }
    await settle(this.page);
    const faults = [...seen];
    this.findings.push(...faults.map((f) => `${sized(size)}, ${what}: ${f}`));
    if (this.rules.remote)
      this.middles.set(
        sized(size),
        await this.page.evaluate(() =>
          Math.round(
            document.querySelector('[data-testid="remote"] main')?.getBoundingClientRect().height ?? 0,
          ),
        ),
      );
    if (faults.length > 0)
      await test.info().attach(`${sized(size)} ${what}`, {
        body: await this.page.screenshot(),
        contentType: 'image/png',
      });
  }

  /** Every finding said and kept with the test, then none expected. */
  finish(name: string): void {
    const middles = [...this.middles].map(([size, height]) => `${size}: ${String(height)} px`).join(', ');
    const said = `${name}: ${String(this.findings.length)} findings${middles ? ` (the middle: ${middles})` : ''}\n${this.findings.join('\n')}`;
    console.log(said);
    writeFileSync(test.info().outputPath('phone-fit-findings.txt'), `${said}\n`);
    expect(this.findings, name).toEqual([]);
  }
}

const DRASHTI_PAGE = { target: 44, textFloor: true, remote: false, ignore: '[data-a11y-picture]' } as const;

/** A show with long placeholder names: a playlist of them, live, a message, a timer and Audio's playlist. */
async function longShow(win: Page): Promise<{ playlistId: string; presentationId: string }> {
  const show = await setUpPlaceholderShow(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-fit-'));
  const words = join(dir, `${LONG.presentation}.txt`);
  writeFileSync(
    words,
    [
      '[Verse 1]',
      'Placeholder first line of the opening words, long enough to wrap on a phone',
      'નમૂના પહેલી પંક્તિ',
      '',
      '[Verse 2]',
      'Placeholder second line of the opening words',
      '',
    ].join('\n'),
  );
  const picture = await makeTestImage(win, join(dir, `${LONG.picture}.png`), { width: 320, height: 180 });
  await importAndGetIds(win, [words, picture]);
  return win.evaluate(
    async ({ names, show }) => {
      const d = (globalThis as PageGlobals).drashti;
      const presentationId = (await d.library.listPresentations()).find(
        (p) => p.name === names.presentation,
      )?.id;
      const pictureId = (await d.library.listMedia()).find((m) => m.name.startsWith(names.picture))?.id;
      if (!presentationId || !pictureId) throw new Error('The long-named placeholders did not import');
      const made = await d.playlists.create(names.playlist, null, false);
      if (!made.ok) throw new Error(made.message);
      const playlistId = made.ids[0] ?? '';
      const added = await d.playlists.addItems(playlistId, null, [
        { kind: 'header', label: names.header },
        { kind: 'presentation', presentationId },
        { kind: 'presentation', presentationId: show.kirtanId },
        { kind: 'media', mediaId: pictureId },
        { kind: 'media', mediaId: show.pictureMediaId },
      ]);
      if (!added.ok) throw new Error(added.message);
      const message = await d.messages.create({
        name: names.message,
        template: 'Placeholder car {plate} please move it from the front row of the car park',
        fields: {},
      });
      if (!message.ok) throw new Error(message.message);
      const timer = await d.timers.create({
        name: names.timer,
        kind: 'countdown',
        durationMs: 2 * 3600_000,
        targetTime: null,
        allowsOverrun: false,
      });
      if (!timer.ok) throw new Error(timer.message);
      const music = await d.music.create(names.music);
      if (!music.ok) throw new Error('Could not make an audio playlist');
      const shared = await d.playlists.share(playlistId, true);
      if (!shared.ok) throw new Error(shared.message);
      await d.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 0 } as never);
      return { playlistId, presentationId };
    },
    { names: LONG, show },
  );
}

/** One way the remote can look, and how to get there from any other (and back out of it). */
interface View {
  name: string;
  open(p: Page): Promise<void>;
  close?(p: Page): Promise<void>;
}

const chosen = async (p: Page, testId: string) => {
  await p.getByTestId(testId).click();
  await expect(p.getByTestId(testId)).toHaveAttribute('aria-selected', 'true');
};

/** A sheet over the remote, opened from its button (on More's tab on a phone), closed by its Close. */
const sheet = (name: string, button: string, testId: string, from: (p: Page) => Promise<void>): View => ({
  name,
  open: async (p) => {
    await from(p);
    await p.getByTestId(button).click();
    await expect(p.getByTestId(testId)).toBeVisible();
  },
  close: async (p) => {
    await p.getByTestId(`${testId}-close`).click();
    await expect(p.getByTestId(testId)).toHaveCount(0);
  },
});

/**
 * The remote's views on a phone (tabs) or a tablet (the playlist or the library beside the show). `say`: someone else
 * writes in the chat (a new message's banner shows while the chat is not in view).
 */
function remoteViews(layout: 'phone' | 'wide', playlistId: string, say: () => Promise<void>): View[] {
  const phone = layout === 'phone';
  const show = phone ? (p: Page) => chosen(p, 'remote-tab-show') : () => Promise.resolve();
  const more = phone ? (p: Page) => chosen(p, 'remote-tab-more') : () => Promise.resolve();
  const playlist = (p: Page) => chosen(p, phone ? 'remote-tab-playlist' : 'remote-side-playlist');
  const library = (p: Page) => chosen(p, phone ? 'remote-tab-library' : 'remote-side-library');
  const chat = (p: Page) => chosen(p, phone ? 'remote-tab-chat' : 'remote-side-chat');
  const openPlaylist = async (p: Page) => {
    await playlist(p);
    await p.getByTestId('remote-playlist').selectOption(playlistId);
    await expect(p.getByTestId('remote-items')).toContainText(LONG.presentation);
  };
  /** The long-named picture's row in the playlist. */
  const pictureRow = (p: Page) =>
    p.getByTestId('remote-items').locator('[data-testid="remote-item"][data-kind="media"]').filter({
      hasText: LONG.picture,
    });
  return [
    { name: phone ? 'the Show tab' : 'the show beside the playlist', open: show },
    { name: 'the playlist', open: openPlaylist },
    {
      name: "a picture's menu in the playlist (a long press)",
      open: async (p) => {
        await openPlaylist(p);
        await longPress(pictureRow(p));
      },
      close: async (p) => {
        await p.getByTestId('remote-row-menu-close').click();
        await expect(p.getByTestId('remote-row-menu')).toHaveCount(0);
      },
    },
    {
      name: 'the Picture editor, from the menu',
      open: async (p) => {
        await openPlaylist(p);
        await longPress(pictureRow(p));
        await p.getByTestId('remote-row-menu').getByTestId('remote-menu-edit').click();
        await expect(p.getByTestId('remote-picture-editor').getByTestId('remote-pe-frame')).toBeVisible();
      },
      close: async (p) => {
        await p.getByTestId('remote-pe-cancel').click();
        await expect(p.getByTestId('remote-picture-editor')).toHaveCount(0);
      },
    },
    {
      name: "the library's presentations",
      open: async (p) => {
        await library(p);
        await chosen(p, 'remote-library-presentations');
        await expect(p.getByTestId('remote-library')).toContainText(LONG.presentation);
      },
    },
    {
      name: "the library's media, with Add from this Phone… and a file it sent",
      open: async (p) => {
        await library(p);
        await chosen(p, 'remote-library-media');
        await expect(p.getByTestId('remote-add-button')).toBeVisible();
        await expect(p.getByTestId('remote-sending-list')).toContainText(LONG.photo);
        await expect(p.getByTestId('remote-media')).toContainText(LONG.picture);
      },
    },
    {
      name: 'Shared from Drashti, the playlist open',
      open: async (p) => {
        await library(p);
        await chosen(p, 'remote-library-shared');
        const shared = p.getByTestId('remote-shared');
        // The list of what is shared, or (from an earlier look) the playlist already open.
        const list = shared.getByTestId('remote-shared-playlist');
        await expect(list.or(shared.getByTestId('remote-shared-item')).first()).toBeVisible();
        if (await list.isVisible()) await list.click();
        await expect(shared.getByTestId('remote-shared-item').first()).toBeVisible();
      },
    },
    ...(phone ? [{ name: 'the More tab', open: more }] : []),
    {
      name: 'the Chat, with long names and messages',
      open: async (p) => {
        await chat(p);
        await expect(p.getByTestId('chat-message').filter({ hasText: LONG.reply })).toBeVisible();
      },
    },
    {
      name: 'Change name on the Chat',
      open: async (p) => {
        await chat(p);
        await p.getByTestId('chat-rename').click();
        await expect(p.getByTestId('chat-name')).toHaveValue(LONG.name);
      },
      close: async (p) => {
        await p.getByTestId('chat-name-cancel').click();
        await expect(p.getByTestId('chat-text-box')).toBeVisible();
      },
    },
    {
      name: 'a new chat message’s banner over the show',
      open: async (p) => {
        // The chat out of view (a tablet's side shows the playlist), then someone else writes.
        await (phone ? show(p) : playlist(p));
        await say();
        await expect(p.getByTestId('chat-banner')).toContainText(LONG.from);
      },
      close: async (p) => {
        // It goes by itself after a few seconds: closed here if it is still up.
        const banner = p.getByTestId('chat-banner');
        if (await banner.isVisible()) await p.getByTestId('chat-banner-close').click();
        await expect(banner).toHaveCount(0);
      },
    },
    {
      name: 'the viewer (Look closer)',
      open: async (p) => {
        await show(p);
        await p.getByTestId('remote-look-closer').click();
        await expect(p.getByTestId('viewer')).toBeVisible();
      },
      close: async (p) => {
        await p.getByTestId('viewer-close').click();
        await expect(p.getByTestId('viewer')).toHaveCount(0);
      },
    },
    sheet('Manage playlists…', 'remote-open-playlists', 'remote-library-sheet', playlist),
    sheet('Set Up Screens…', 'remote-open-screens', 'remote-screens', more),
    sheet('Video inputs and windows…', 'remote-open-inputs', 'remote-inputs-sheet', more),
    sheet('Picture in picture…', 'remote-open-pip', 'remote-pip-sheet', more),
    sheet('Change the library…', 'remote-open-library', 'remote-library-sheet', more),
    sheet('MIDI…', 'remote-open-midi', 'remote-midi-sheet', more),
    sheet('Announcements…', 'remote-open-queue', 'remote-queue-sheet', more),
  ];
}

const ENGINES = ['webkit', 'chromium'] as const satisfies readonly Engine[];
const engineName = (engine: Engine) => (engine === 'webkit' ? 'Safari’s' : 'Chrome’s');

for (const engine of ENGINES)
  test(`the remote fits on phones upright and sideways and on a tablet, in ${engineName(engine)} engine: each tab, sheet and the viewer, with long names; Back and Next always on the screen`, async () => {
    test.setTimeout(480_000);
    const { app } = await launchApp(NETWORK_ENV);
    const phone = await phoneOf(engine);
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const { playlistId } = await longShow(win);
      const { port, base } = await networkOn(win);
      // Files from phones on: Add from this Phone… at the top of the library's media.
      await win.evaluate(async () => {
        const on = await (globalThis as PageGlobals).drashti.network.setAddFiles(true);
        if (!on.ok) throw new Error(on.message);
      });
      // One announcement waiting, from a long-named sender, for the queue's sheet.
      const poster = await pairToken(win, port, 'announcements', 'Placeholder poster');
      const sent = await apiCall(port, '/api/v1/announcements', {
        method: 'POST',
        token: poster,
        body: { text: LONG.announcement, from: LONG.from, minutes: 10 },
      });
      expect(sent.status).toBe(202);
      // Someone else in the chat with a long name (a script's Remote), who wrote a long message.
      const chatter = await pairToken(win, port, 'remote', 'Placeholder chat script');
      const named = await apiCall(port, CHAT_API.name, {
        method: 'POST',
        token: chatter,
        body: { name: LONG.from },
      });
      expect(named.status).toBe(200);
      const say = async () => {
        const said = await apiCall(port, CHAT_API.send, {
          method: 'POST',
          token: chatter,
          body: { text: LONG.chat },
        });
        expect(said.status).toBe(200);
      };
      await say();
      const p = phone.page;
      await pairByQr(p, base, await pairingCode(win, 'remote', LONG.device), '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      await expect(p.getByTestId('remote-live')).toBeVisible();
      // A file added from this phone, its row in the list of what it sent (files from phones).
      const photo = await makeTestImage(
        win,
        join(mkdtempSync(join(tmpdir(), 'drashti-phone-fit-')), `${LONG.photo}.png`),
        {
          width: 64,
          height: 48,
        },
      );
      await chosen(p, 'remote-tab-library');
      await chosen(p, 'remote-library-media');
      const [chooser] = await Promise.all([
        p.waitForEvent('filechooser'),
        p.getByTestId('remote-add-button').click(),
      ]);
      await chooser.setFiles(photo);
      await expect(p.getByTestId('remote-sending').filter({ hasText: LONG.photo })).toHaveAttribute(
        'data-state',
        'added',
        { timeout: 60_000 },
      );
      // In the chat with a long name, and a long message of its own.
      await chosen(p, 'remote-tab-chat');
      await p.getByTestId('chat-name').fill(LONG.name);
      await p.getByTestId('chat-name-save').click();
      await p.getByTestId('chat-text-box').fill(LONG.reply);
      await p.getByTestId('chat-send').click();
      await expect(p.getByTestId('chat-message').filter({ hasText: LONG.reply })).toHaveAttribute(
        'data-own',
        'true',
      );
      const sweep = new Sweep(p, { ...DRASHTI_PAGE, remote: true });
      for (const size of SIZES) {
        await p.setViewportSize(size);
        // Laid out again for the new size (its media queries answer as the size changes).
        await p.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
        );
        // A tablet upright has the playlist or the library beside the show; a phone, upright or sideways, tabs.
        const layout = size.width >= 768 && size.height > 500 ? 'wide' : 'phone';
        await expect(p.getByTestId('remote')).toHaveAttribute(
          'data-layout',
          layout === 'wide' ? 'wide' : /^(phone|sideways)$/u,
        );
        for (const view of remoteViews(layout, playlistId, say)) {
          await view.open(p);
          await sweep.look(size, view.name);
          await view.close?.(p);
        }
      }
      sweep.finish(`the remote in ${engine}`);
    } finally {
      await phone.context.close();
      await phone.browser.close();
      await app.close();
    }
  });

for (const engine of ENGINES)
  test(`the pairing page, the announcements page, the chat page and the stage display fit on phones upright and sideways and on a tablet, in ${engineName(engine)} engine, with long names`, async () => {
    test.setTimeout(300_000);
    const { app } = await launchApp(NETWORK_ENV);
    const phone = await phoneOf(engine);
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await setUpPlaceholderShow(win);
      const { base } = await networkOn(win);
      const p = phone.page;
      const sweep = new Sweep(p, DRASHTI_PAGE);
      const everySize = async (what: string, rules: Partial<Omit<Rules, 'width' | 'height'>> = {}) => {
        for (const size of SIZES) {
          await p.setViewportSize(size);
          await sweep.look(size, what, rules);
        }
      };

      // The pairing page as typed into, with a wrong code; and as a removed device comes back to it.
      await p.goto(`${base}/pair`);
      await expect(p.getByTestId('pair-code')).toBeVisible();
      await everySize('the pairing page');
      await p.getByTestId('pair-code').fill('000000');
      await p.getByRole('button', { name: 'Pair' }).click();
      await expect(p.getByRole('alert')).toBeVisible();
      await everySize('the pairing page with a wrong code');
      await p.goto(`${base}/pair?why=stopped`);
      await expect(p.getByTestId('pair-page')).toContainText('Drashti has stopped on its computer');
      await everySize('the pairing page as a stopped Drashti sends a device back');

      // The announcements page, as its QR code opens it, with one long announcement sent.
      await p.goto('about:blank');
      await pairByQr(p, base, await pairingCode(win, 'announcements', LONG.device), '/announce');
      await expect(p.getByTestId('announce-text')).toBeVisible();
      await everySize('the announcements page');
      await p.getByTestId('announce-text').fill(LONG.announcement);
      await p.getByTestId('announce-from').fill(LONG.from);
      await p.getByTestId('announce-send').click();
      await expect(p.getByTestId('announce-sent').first()).toContainText('Waiting for the operator');
      await everySize('the announcements page with what it sent');

      // The chat page (alpha.23), as this Announcements phone (in the chat) opens it: its name asked, then messages.
      await p.goto(`${base}/chat`);
      await expect(p.getByTestId('chat-name')).toBeVisible();
      await everySize('the chat page, asking the name');
      await p.getByTestId('chat-name').fill(LONG.name);
      await p.getByTestId('chat-name-save').click();
      for (const text of [LONG.chat, LONG.reply]) {
        await p.getByTestId('chat-text-box').fill(text);
        await p.getByTestId('chat-send').click();
        await expect(p.getByTestId('chat-message').filter({ hasText: text })).toBeVisible();
      }
      await everySize('the chat page with its messages');

      // The stage display: a screen, its own picture left out; its Full screen button and the page fit.
      await p.goto('about:blank');
      await pairByQr(p, base, await pairingCode(win, 'stage', LONG.device), '/stage');
      await expect(p.getByTestId('stage-view')).toBeVisible();
      await everySize('the stage display', {
        textFloor: false,
        ignore: '[data-a11y-picture], [data-testid="stage-view"]',
      });
      sweep.finish(`the pairing, announcements, chat and stage pages in ${engine}`);
    } finally {
      await phone.context.close();
      await phone.browser.close();
      await app.close();
    }
  });

/** Someone's Drashti asks for access, straight to the list: its Approve and Reject links, from the approver's email. */
function askedFor(s: AccessStandIn): { approve: string; reject: string } {
  const { body } = callBody('request', placeholderComputer('phone-fit-request', LONG.computer), {
    gmail: LONG.gmail,
    name: LONG.name,
  });
  const a = readAnswer(s.list.handle(JSON.stringify(body)), s.publicKey);
  if (!a.ok) throw new Error(`The stand-in refused the request: ${String(a.error)}`);
  const links = s.list.linksFor(LONG.gmail);
  if (!links) throw new Error('No Approve link was emailed');
  return links;
}

for (const engine of ENGINES)
  test(`the access list's pages an emailed link opens fit on phones upright and sideways and on a tablet, in ${engineName(engine)} engine, with a long Gmail: Approve, Reject, answered, not complete, and the web app's own`, async () => {
    test.setTimeout(240_000);
    const s = await accessStandIn();
    const phone = await phoneOf(engine);
    try {
      const p = phone.page;
      // Not Drashti's own phone pages: their words are the browser's own size, their targets 44 px.
      const sweep = new Sweep(p, { target: 44, textFloor: false, remote: false, ignore: '' });
      const everySize = async (what: string) => {
        for (const size of SIZES) {
          await p.setViewportSize(size);
          await sweep.look(size, what);
        }
      };
      const heading = p.getByRole('heading', { level: 1 });
      const links = askedFor(s);
      const open = async (url: string) => {
        await p.goto('about:blank');
        await p.goto(url);
      };

      await open(links.reject);
      await expect(heading).toHaveText(`Reject ${LONG.gmail}?`);
      await everySize('the Reject page');
      // The page a link sent before x38 opens, on the web app itself (Link.html).
      await open(s.pageUrl(links.approve));
      await expect(heading).toHaveText(`Approve ${LONG.gmail}?`);
      await everySize('the web app’s own Approve page (Link.html)');
      // The link page with nothing after its # (its address alone).
      await open(links.approve.split('#')[0] ?? '');
      await expect(heading).toHaveText('This link is not complete');
      await everySize('the link page with no link in it');
      await open(links.approve);
      await expect(heading).toHaveText(`Approve ${LONG.gmail}?`);
      await everySize('the Approve page');
      await p.getByRole('radio', { name: 'A number of days' }).check();
      await p.getByRole('spinbutton', { name: 'Number of days' }).fill('0');
      await p.getByRole('button', { name: 'Approve' }).click();
      await expect(p.locator('#wait')).toHaveText(
        'Type a whole number of days from 1 to 730, or choose another length.',
      );
      await everySize('the Approve page with days typed wrong');
      await p.getByRole('radio', { name: '30 days' }).check();
      await p.getByRole('button', { name: 'Approve' }).click();
      await expect(heading).toHaveText('Approved');
      await everySize('the Approve page answered');
      sweep.finish(`the access list's pages in ${engine}`);
    } finally {
      await phone.context.close();
      await phone.browser.close();
      await s.close();
    }
  });
