import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { parseMarkdown, passagesOf } from '../../../shared/markdown';
import type { PanelHelp, PanelHelpId } from '../../../shared/panel-help';
import { PANEL_HELP } from '../../../shared/panel-help';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Tooltip } from '../ui/Tooltip';
import type { Box, CardPlace, CardRoom } from './card-place';
import { placeCard } from './card-place';
import { useHelp } from './help-store';
import { showManual } from './manual-store';

/*
 * "What is this?" (Session 25): a small ? on a panel's heading opens two or three plain sentences, and it never takes
 * the show's keys (it is a button, a paragraph, Open the manual and Got it). The words are in shared/panel-help.ts.
 * Open the manual (x37, Session 60: the owner's "Yes, A" to Q60-25; Read more, which opened Help › Guides, until then)
 * opens the Drashti Manual at the panel's chapter, its feature marked; Esc closes the manual, and the show's keys work
 * again at once. Since alpha.24 (help-store.ts, the owner's "non-congusted UI") every ? is drawn only while the status
 * bar's Help switch is on: off, there is none at all, so none is a Tab stop either.
 *
 * The card is drawn over the window, not in its flow (alpha.24, helpcards; lead 2's a25 list, items 20, 22 and 26):
 * in the flow it pushed Back, Next, Oops and the live picture down 110 to 362 px, or lifted the bottom bar and the
 * quick bar's pins, as it opened. It opens in the middle column, beside its ?'s column or under its ?, whole in sight
 * between the top bar and the bottom bar (card-place.ts), so nothing moves, and LIVE's column and the show controls
 * along the bottom are never under it. Its buttons come straight after its ? for the keyboard, both ways, as they did
 * in the flow; Got it, Esc in it, its ? again, or a click anywhere else in the window closes it.
 */

/** Open the manual at the chapter a card names, at its feature (or the chapter's start, if the feature is gone). */
async function openManual(help: PanelHelp): Promise<void> {
  const read = await window.drashti.manual.read();
  const text = read.ok ? read.chapters.find((c) => c.id === help.chapter)?.text : undefined;
  const passage =
    text === undefined
      ? null
      : (passagesOf(parseMarkdown(text)).find((p) => p.heading && p.text === help.feature)?.id ?? null);
  showManual({ chapter: help.chapter, passage });
}

/**
 * The ?'s room: the header's and the sabha flow's smaller (`compact`, 20 px), every other 24 px; held with Help off
 * (`keepRoom`) at the same size.
 */
const askSize = (compact: boolean) => (compact ? 'h-5 w-5' : 'h-6 w-6');

/**
 * The ? itself, always a 24 px target (WCAG 2.5.8; qtargets, alpha.24; 20 px in a compact room until then): in a
 * compact room its margin gives 2 px back on each side, so it takes the 20 px it took and no bar grows, and it reaches
 * into the gaps beside it, over no other target.
 */
const targetSize = (compact: boolean) => (compact ? '-m-0.5 h-6 w-6' : 'h-6 w-6');

/** The window's columns, as operator/Layout.tsx marks them. */
const ZONES = ['left', 'middle', 'right'] as const;

/** Activating any ? closes the previous card before the new card receives the keyboard. */
const CARD_OPEN = 'drashti:what-is-this-open';

/** An element's box, or null when it is not drawn. */
function boxOf(el: Element | null | undefined): Box | null {
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Where `card` may open for its ? `ask` in this window (null: the ? is not drawn, so its card goes with it). */
function roomFor(ask: HTMLElement, card: HTMLElement): CardRoom | null {
  const a = boxOf(ask);
  if (!ask.isConnected || a === null) return null;
  const doc = ask.ownerDocument;
  const zones = ZONES.map(
    (z) =>
      [...doc.querySelectorAll(`[data-zone="${z}"]`)].map((el) => boxOf(el)).find((b) => b !== null) ?? null,
  );
  const seen = zones.filter((b) => b !== null);
  const screen = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  // The columns' area: under the top bar, over the bars along the bottom (the window, in a window without columns).
  const area =
    seen.length === 0
      ? screen
      : {
          left: Math.max(screen.left, Math.min(...seen.map((b) => b.left))),
          top: Math.max(screen.top, Math.min(...seen.map((b) => b.top))),
          right: Math.min(screen.right, Math.max(...seen.map((b) => b.right))),
          bottom: Math.min(screen.bottom, Math.max(...seen.map((b) => b.bottom))),
        };
  const zone = ask.closest('[data-zone]')?.getAttribute('data-zone');
  return {
    ask: a,
    zone: zone === 'left' || zone === 'middle' || zone === 'right' ? zone : null,
    area,
    middle: zones[1] ?? null,
    // Its words whole, even while it is held shorter (and scrolls) in a short window.
    card: { width: card.offsetWidth, height: card.scrollHeight + card.offsetHeight - card.clientHeight },
  };
}

/**
 * The keyboard to the status bar's Help switch (a25 item 23): the ? and its card go with Help, and focus left on
 * nothing is lost to the keyboard. The switch says Help is off, and turns it on again.
 */
function toHelpSwitch(): void {
  document.querySelector<HTMLElement>('[data-testid="help-toggle"]')?.focus();
}

/** The topmost part of the window `el` is in (the app's own, under the page's body): dialogs and menus are beside it. */
function windowPartOf(el: Element): Element {
  let at = el;
  while (at.parentElement && at.parentElement !== el.ownerDocument.body) at = at.parentElement;
  return at;
}

/**
 * The ? for a heading, and the words it opens (both null without a topic, in Simple Mode or with Help off).
 * `keepRoom` (a panel's heading, ui/Panel.tsx): with Help off, an empty box of the ?'s size holds its place, never a
 * button or a Tab stop and hidden from screen readers, so a heading that wraps with the ? wraps the same without it,
 * and turning Help on or off moves nothing under it (the release lead's decision after lead 2's helpmenu hands-on:
 * the Timers heading's ? sent Calendar and New timer to a second row, and every section below moved).
 * `card` is always null since helpcards: the card is drawn over the window with the ? (in `button`), so the places
 * that held it in the flow hold nothing, and nothing moves; they may let it go.
 */
export function useWhatIsThis(
  topic: PanelHelpId | null,
  {
    compact = false,
    keepRoom = false,
  }: {
    /** A smaller room for the ? (the header's and the sabha flow's, where room is short). */
    compact?: boolean;
    /** Hold the ?'s room while Help is off (Pro Mode only, as the ? is). */
    keepRoom?: boolean;
  } = {},
): { button: ReactNode; card: ReactNode } {
  // Open in the turning on of Help it was opened in (its count, help-store.ts): Help off and on again finds it shut.
  const [openIn, setOpenIn] = useState<number | null>(null);
  // Where it is drawn, once measured (it is drawn out of sight until then, before the window's next drawing).
  const [place, setPlace] = useState<CardPlace | null>(null);
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  // Pro Mode's: Simple Mode (Pro Mode's window with less in it, Session 55, Part 18) has no ? of its own.
  const simple = useMode((s) => s.mode === 'simple');
  const on = useHelp((s) => s.on);
  const round = useHelp((s) => s.round);
  const asking = topic !== null && !simple && on;
  const shown = asking && openIn === round;

  // Help off from elsewhere (Help › Show Help in the menu bar) with the keyboard on this ? or in its card: on the Help
  // switch, before the ? and its card go (a25 item 23; the store tells its listeners before the window draws again).
  useEffect(() => {
    if (!asking) return;
    return useHelp.subscribe((now, was) => {
      if (now.on || !was.on) return;
      const at = document.activeElement;
      if (at !== null && (opener.current?.contains(at) === true || cardEl.current?.contains(at) === true))
        toHelpSwitch();
    });
  }, [asking]);

  // Open: placed by its ?, and kept there as the window or a column moves; the keyboard on Got it.
  useLayoutEffect(() => {
    const ask = opener.current;
    const card = cardEl.current;
    if (!shown || !ask || !card) return;
    const put = () => {
      const room = roomFor(ask, card);
      if (room !== null) {
        setPlace(placeCard(room));
        return;
      }
      // Its ? is no longer drawn (a narrower window hides it): the card goes with it.
      if (card.contains(document.activeElement)) toHelpSwitch();
      setOpenIn(null);
    };
    put();
    card.querySelector<HTMLElement>('[data-got-it]')?.focus({ preventScroll: true });
    const buttons = () => [...card.querySelectorAll<HTMLElement>('button')];
    // A Shift+Tab from outside the card, in progress: if it lands on the ?, it came from just after it.
    let backIn = false;
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
      const at = document.activeElement;
      const own = buttons();
      if (!e.shiftKey && at === ask) {
        // Its buttons come straight after its ?.
        e.preventDefault();
        own[0]?.focus();
      } else if (own.some((button) => button === at)) {
        // Portal actions have no native Tab entry at the end of the body. Walk them here, at their ?'s position.
        const index = own.findIndex((button) => button === at);
        const next = own[index + (e.shiftKey ? -1 : 1)];
        if (next) {
          e.preventDefault();
          next.focus();
        } else if (e.shiftKey) {
          e.preventDefault();
          ask.focus();
        } else {
          // On from its ?: native Tab goes to the next ordinary control in this column.
          ask.focus({ preventScroll: true });
        }
      } else if (e.shiftKey && !card.contains(at)) {
        backIn = true;
        setTimeout(() => {
          backIn = false;
        }, 0);
      }
    };
    const landed = (e: FocusEvent) => {
      if (!backIn || e.target !== ask) return;
      backIn = false;
      buttons().at(-1)?.focus();
    };
    // A click elsewhere in the window closes it (not in a dialog or a menu over it: Open the manual's, say).
    const pointer = (e: PointerEvent) => {
      const at = e.target;
      if (!(at instanceof Node) || card.contains(at) || ask.contains(at)) return;
      if (windowPartOf(ask).contains(at)) setOpenIn(null);
    };
    // Columns can apply their new widths after the native resize event. Follow the laid-out sizes too, including
    // a hidden ? or words wrapping in the card, so an open card stays clear of LIVE as the window changes.
    const resize = new ResizeObserver(put);
    resize.observe(ask);
    resize.observe(card);
    const middle = ask.ownerDocument.querySelector('[data-zone="middle"]');
    if (middle) resize.observe(middle);
    const stop = new AbortController();
    const { signal } = stop;
    window.addEventListener('resize', put, { signal });
    window.addEventListener('scroll', put, { capture: true, passive: true, signal });
    document.addEventListener('keydown', keys, { capture: true, signal });
    document.addEventListener('focusin', landed, { capture: true, signal });
    document.addEventListener('pointerdown', pointer, { capture: true, signal });
    document.addEventListener(CARD_OPEN, () => setOpenIn(null), { signal });
    return () => {
      stop.abort();
      resize.disconnect();
    };
  }, [shown]);

  if (!asking)
    return {
      button:
        topic !== null && !simple && keepRoom ? (
          <span
            aria-hidden="true"
            data-what-is-this-room=""
            className={cx('inline-block shrink-0', askSize(compact))}
          />
        ) : null,
      card: null,
    };
  const help = PANEL_HELP[topic];
  const close = () => {
    setOpenIn(null);
    opener.current?.focus();
  };
  const drawn =
    shown &&
    createPortal(
      <div
        ref={cardEl}
        id={id}
        role="note"
        aria-label={`What is this? ${help.title}`}
        data-testid="what-is-this"
        // Opened by a click, so always arriving (the window has settled by then: ui/motion.ts).
        data-motion="pop"
        style={{
          left: place?.left ?? -9999,
          top: place?.top ?? -9999,
          maxHeight: place?.maxHeight ?? undefined,
        }}
        // Over the window's parts and its sheets (z-30), under its dialogs, menus and tooltips (z-40 and up).
        className="fixed z-[35] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border border-line-strong bg-panel-2 px-3 py-2 text-sm text-fg"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          close();
        }}
      >
        <p id={`${id}-text`}>{help.text}</p>
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            data-testid="what-is-this-manual"
            tabIndex={-1}
            onClick={() => {
              void openManual(help);
            }}
          >
            Open the manual
          </Button>
          <Button size="sm" tabIndex={-1} data-got-it="" aria-describedby={`${id}-text`} onClick={close}>
            Got it
          </Button>
        </div>
      </div>,
      document.body,
    );
  const button = (
    <>
      {/* Its tip says its name, as an icon button's does: not linked, so its name is said once (a25 item 37). */}
      <Tooltip content={`What is this? ${help.title}`} describes={false}>
        <button
          ref={opener}
          type="button"
          aria-label={`What is this? ${help.title}`}
          aria-expanded={shown}
          aria-controls={shown ? id : undefined}
          data-testid={`what-is-this-${topic}`}
          data-what-is-this=""
          onClick={() => {
            if (!shown) document.dispatchEvent(new Event(CARD_OPEN));
            setOpenIn(shown ? null : round);
          }}
          className={cx(
            'inline-flex shrink-0 items-center justify-center rounded-full border border-field font-bold text-muted hover:border-muted hover:text-fg',
            targetSize(compact),
            compact ? 'text-[11px]' : 'text-xs',
          )}
        >
          ?
        </button>
      </Tooltip>
      {drawn}
    </>
  );
  return { button, card: null };
}
