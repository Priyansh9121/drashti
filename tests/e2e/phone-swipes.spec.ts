import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { device, type Engine, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { holdStill, launchApp, letTimePass, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';

/*
 * Swipes on the phone's live picture (Session 55, Part 9): the finger moving left is Next and moving right is Back,
 * like turning a page; two fingers (zooming) never count as a swipe, nor a drag up or down (the page scrolls); the
 * Back and Next buttons stay. In Chrome's engine the fingers are a touch screen's own (Chromium's input, so the page's
 * touch-action is as a phone's); in Safari's, the pointer events a phone's touches make (Playwright has no second
 * finger of its own there). Placeholder content only.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

const slideNow = async (win: Page) => (await snapshot(win)).layers.slide?.slideIndex ?? null;

/** The middle of the live picture, in the page's pixels. */
async function middle(p: Page): Promise<{ x: number; y: number; width: number }> {
  const box = await p.getByTestId('remote-live').boundingBox();
  if (!box) throw new Error('no live picture');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
}

/**
 * Fingers on the live picture, each from its start by (dx, dy) in eight moves over about 200 ms: a touch screen's own
 * in Chrome's engine, the pointer events a phone's touches make in Safari's.
 */
async function fingers(
  p: Page,
  engine: Engine,
  starts: { x: number; y: number }[],
  dx: number[],
  dy: number[],
): Promise<void> {
  const STEPS = 8;
  const at = (i: number, step: number) => ({
    x: (starts[i]?.x ?? 0) + ((dx[i] ?? 0) * step) / STEPS,
    y: (starts[i]?.y ?? 0) + ((dy[i] ?? 0) * step) / STEPS,
  });
  if (engine === 'chromium') {
    const cdp = await p.context().newCDPSession(p);
    const points = (step: number) => starts.map((_, i) => ({ ...at(i, step), id: i }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
    for (let step = 1; step <= STEPS; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
      await letTimePass(p, 25, 'a finger moves through its 200 ms swipe');
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  const fire = (type: string, step: number) =>
    p.getByTestId('remote-live').evaluate(
      (el, { starts, dx, dy, steps, step, type }) => {
        starts.forEach((start, id) => {
          const clientX = start.x + ((dx[id] ?? 0) * step) / steps;
          const clientY = start.y + ((dy[id] ?? 0) * step) / steps;
          const target = document.elementFromPoint(clientX, clientY) ?? el;
          target.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 100 + id,
              pointerType: 'touch',
              isPrimary: id === 0,
              clientX,
              clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      },
      { starts, dx, dy, steps: STEPS, step, type },
    );
  await fire('pointerdown', 0);
  for (let step = 1; step <= STEPS; step++) {
    await fire('pointermove', step);
    await letTimePass(p, 25, 'a finger moves through its 200 ms swipe');
  }
  await fire('pointerup', STEPS);
}

/** Passive, bounded source-of-input evidence; it never changes the gesture or opens the viewer. */
async function observeFinalTap(p: Page) {
  return p.evaluateHandle(() => {
    type Category =
      | 'remote-live-look'
      | 'remote-live'
      | 'remote-next-button'
      | 'remote-back'
      | 'viewer-close'
      | 'viewer'
      | 'other';
    interface InputRecord {
      sequence: number;
      phase: 'capture' | 'bubble';
      type: string;
      timeStamp: number;
      observedAt: number;
      clientX: number | null;
      clientY: number | null;
      pointerType: 'touch' | 'pen' | 'mouse' | 'other' | 'none';
      target: Category;
      trusted: boolean;
      defaultPrevented: boolean;
      touches: number | null;
      finalTap: boolean;
    }
    const categories: readonly Category[] = [
      'remote-live-look',
      'remote-live',
      'remote-next-button',
      'remote-back',
      'viewer-close',
      'viewer',
    ];
    const category = (target: EventTarget | null): Category => {
      if (!(target instanceof Element)) return 'other';
      return categories.find((name) => target.closest(`[data-testid="${name}"]`)) ?? 'other';
    };
    const events: InputRecord[] = [];
    const scrolls: { at: number; x: number; y: number }[] = [];
    const viewerChanges: { at: number; present: boolean }[] = [];
    const swipeMarkers: { at: number; way: 'next' | 'back'; pointerUpTimeStamp: number | null }[] = [];
    let droppedEvents = 0;
    let droppedScrolls = 0;
    let sequence = 0;
    let finalTap = false;
    let lastPointerUpTimeStamp: number | null = null;
    let lastSwipeTimeStamp: number | null = null;
    let marker: string | null = null;
    const presentInitially = document.querySelector('[data-testid="viewer"]') !== null;
    let viewerPresent = presentInitially;
    let viewerEverMounted = presentInitially;
    let viewerEverUnmounted = false;
    const snapshot = () => {
      const live = document.querySelector('[data-testid="remote-live"]')?.getBoundingClientRect();
      const viewport = window.visualViewport;
      return {
        at: performance.now(),
        scroll: { x: window.scrollX, y: window.scrollY },
        viewport: {
          innerWidth,
          innerHeight,
          width: viewport?.width ?? null,
          height: viewport?.height ?? null,
          offsetLeft: viewport?.offsetLeft ?? null,
          offsetTop: viewport?.offsetTop ?? null,
          scale: viewport?.scale ?? null,
        },
        live: live ? { x: live.x, y: live.y, width: live.width, height: live.height } : null,
        viewerPresent: document.querySelector('[data-testid="viewer"]') !== null,
      };
    };
    const snapshots = {
      beforeGestures: snapshot(),
      beforeFinalTap: null as ReturnType<typeof snapshot> | null,
    };
    const note = (phase: 'capture' | 'bubble') => (event: Event) => {
      const target = category(event.target);
      if (target === 'other' && !finalTap) return;
      const point =
        event instanceof MouseEvent
          ? event
          : 'changedTouches' in event
            ? (event as TouchEvent).changedTouches.item(0)
            : null;
      const rawType = 'pointerType' in event ? event.pointerType : null;
      const pointerType =
        rawType === 'touch' || rawType === 'pen' || rawType === 'mouse'
          ? rawType
          : rawType === null
            ? 'none'
            : 'other';
      events.push({
        sequence: sequence++,
        phase,
        type: event.type,
        timeStamp: event.timeStamp,
        observedAt: performance.now(),
        clientX: point?.clientX ?? null,
        clientY: point?.clientY ?? null,
        pointerType,
        target,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        touches: 'touches' in event ? (event as TouchEvent).touches.length : null,
        finalTap,
      });
      if (events.length > 160) {
        events.shift();
        droppedEvents += 1;
      }
      if (phase === 'capture' && event.type === 'pointerup' && target.startsWith('remote-live'))
        lastPointerUpTimeStamp = event.timeStamp;
    };
    const capture = note('capture');
    const bubble = note('bubble');
    const kinds = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'touchstart',
      'touchend',
      'touchcancel',
      'click',
    ];
    for (const kind of kinds) {
      document.addEventListener(kind, capture, { capture: true, passive: true });
      document.addEventListener(kind, bubble, { passive: true });
    }
    const onScroll = () => {
      scrolls.push({ at: performance.now(), x: window.scrollX, y: window.scrollY });
      if (scrolls.length > 24) {
        scrolls.shift();
        droppedScrolls += 1;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const noteViewer = (present: boolean) => {
      if (present !== viewerPresent) {
        if (viewerChanges.length < 16) viewerChanges.push({ at: performance.now(), present });
        viewerEverMounted ||= present;
        viewerEverUnmounted ||= !present;
        viewerPresent = present;
      }
    };
    const observe = () => {
      noteViewer(document.querySelector('[data-testid="viewer"]') !== null);
      const way = document.querySelector('[data-testid="remote-swiped"]')?.getAttribute('data-way') ?? null;
      if ((way === 'next' || way === 'back') && way !== marker) {
        lastSwipeTimeStamp = lastPointerUpTimeStamp;
        if (swipeMarkers.length < 16)
          swipeMarkers.push({ at: performance.now(), way, pointerUpTimeStamp: lastPointerUpTimeStamp });
      }
      marker = way;
    };
    const containsViewer = (node: Node) =>
      node instanceof Element &&
      (node.matches('[data-testid="viewer"]') || node.querySelector('[data-testid="viewer"]') !== null);
    const observer = new MutationObserver((records) => {
      // Added/removed nodes catch a viewer that mounts and unmounts within one observer turn too.
      for (const record of records) {
        for (const node of record.addedNodes) if (containsViewer(node)) noteViewer(true);
        for (const node of record.removedNodes) if (containsViewer(node)) noteViewer(false);
      }
      observe();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-way'],
    });
    return {
      markFinalTap: () => {
        observe();
        snapshots.beforeFinalTap = snapshot();
        finalTap = true;
      },
      finish: () => {
        observe();
        observer.disconnect();
        for (const kind of kinds) {
          document.removeEventListener(kind, capture, true);
          document.removeEventListener(kind, bubble);
        }
        window.removeEventListener('scroll', onScroll);
        const finalEvents = events.filter((event) => event.finalTap);
        const clicks = finalEvents.filter((event) => event.type === 'click');
        const lastClick = clicks.findLast((event) => event.phase === 'bubble') ?? clicks.at(-1);
        const delta =
          lastClick && lastSwipeTimeStamp !== null ? lastClick.timeStamp - lastSwipeTimeStamp : null;
        const after = snapshot();
        const classification = after.viewerPresent
          ? 'viewer-present'
          : viewerEverMounted && viewerEverUnmounted
            ? 'viewer-mounted-then-removed'
            : !lastClick
              ? 'no-final-tap-click-observed'
              : lastClick.target !== 'remote-live-look'
                ? 'click-routed-away-from-look-overlay'
                : delta === null
                  ? 'overlay-click-without-viewer-guard-timing-unknown'
                  : delta < 500
                    ? 'overlay-click-matches-observed-guard-window'
                    : 'overlay-click-without-viewer-outside-known-guard-window';
        return {
          classification,
          classificationLimit:
            'DOM events and badge-derived timing only; no app handlers/state were changed or inspected.',
          events,
          droppedEvents,
          scrolls,
          droppedScrolls,
          snapshots: { ...snapshots, after },
          viewer: {
            presentInitially,
            presentAtFinish: after.viewerPresent,
            everMounted: viewerEverMounted,
            everUnmounted: viewerEverUnmounted,
            changes: viewerChanges,
          },
          swipeMarkers,
          finalClickObserved: clicks.length > 0,
          finalClickCaptured: clicks.some((event) => event.phase === 'capture'),
          finalClickBubbled: clicks.some((event) => event.phase === 'bubble'),
          finalClickMinusLastAnnouncedSwipeMs: delta,
          clickTimeStampEarlierThanAnnouncedSwipe: delta !== null && delta < 0,
        };
      },
    };
  });
}

for (const engine of ['chromium', 'webkit'] as const satisfies readonly Engine[])
  test(`a swipe on the phone’s live picture turns the page (${engine === 'webkit' ? 'Safari’s' : 'Chrome’s'} engine): to the left is Next, to the right is Back; two fingers never, nor a drag up or down; the buttons stay`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const show = await setUpPlaceholderShow(win);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    let finalTapDiagnostic: Awaited<ReturnType<typeof observeFinalTap>> | null = null;
    try {
      await p.setViewportSize({ width: 375, height: 812 });
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      // The kirtan up at its second slide, from its row.
      await win.evaluate(
        async ({ kirtanId, playlistId }) => {
          const d = (globalThis as PageGlobals).drashti;
          const item = (await d.playlists.items(playlistId)).find(
            (i) => i.kind === 'presentation' && i.presentationId === kirtanId,
          );
          await d.engine.dispatch({
            type: 'goLive',
            presentationId: kirtanId,
            slideIndex: 1,
            playlist: item ? { playlistId, itemId: item.id } : null,
          });
        },
        { kirtanId: show.kirtanId, playlistId: show.playlistId },
      );
      await expect.poll(() => slideNow(win)).toBe(1);
      finalTapDiagnostic = await observeFinalTap(p);
      const m = await middle(p);
      const reach = Math.round(m.width * 0.4);

      // The finger moving left: Next.
      await fingers(p, engine, [{ x: m.x + reach / 2, y: m.y }], [-reach], [0]);
      await expect.poll(() => slideNow(win)).toBe(2);
      // Moving right: Back.
      await fingers(p, engine, [{ x: m.x - reach / 2, y: m.y }], [reach], [0]);
      await expect.poll(() => slideNow(win)).toBe(1);

      // Two fingers coming together (zooming out, which a page already whole leaves as it is), the second moving well
      // to the left: never a swipe.
      await fingers(
        p,
        engine,
        [
          { x: m.x - 60, y: m.y },
          { x: m.x + 60, y: m.y },
        ],
        [0, -100],
        [0, 0],
      );
      // A drag mostly up or down: the page's own scroll, never a swipe.
      await fingers(p, engine, [{ x: m.x, y: m.y + 40 }], [-30], [-120]);
      // A moment for anything that would have gone through.
      await holdStill(
        async () => (await slideNow(win)) === 1,
        700,
        'two fingers and vertical gestures never turn the page',
      );
      expect(await slideNow(win)).toBe(1);

      // The buttons stay, and still turn it.
      await expect(p.getByTestId('remote-back')).toBeVisible();
      await expect(p.getByTestId('remote-next-button')).toBeVisible();
      await p.getByTestId('remote-next-button').click();
      await expect.poll(() => slideNow(win)).toBe(2);
      // And a tap on the picture still looks closer.
      await finalTapDiagnostic.evaluate((monitor) => monitor.markFinalTap());
      await p.getByTestId('remote-live').tap();
      await expect(p.getByTestId('viewer')).toBeVisible();
    } finally {
      try {
        if (finalTapDiagnostic && !p.isClosed()) {
          const report = await finalTapDiagnostic.evaluate((monitor) => monitor.finish()).catch(() => null);
          console.log(
            'Phone final-tap diagnostic',
            JSON.stringify(report ? { engine, ...report } : { engine, unavailable: 'collection-failed' }),
          );
        } else if (finalTapDiagnostic) {
          console.log('Phone final-tap diagnostic', JSON.stringify({ engine, unavailable: 'page-closed' }));
        }
      } finally {
        try {
          await finalTapDiagnostic?.dispose().catch(() => {
            console.log(
              'Phone final-tap diagnostic',
              JSON.stringify({ engine, unavailable: 'handle-disposal-failed' }),
            );
          });
        } finally {
          await phone.close();
        }
      }
    }
    await app.close();
  });
