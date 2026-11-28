/*
 * The focus keeper (alpha.24, lead 2's focus piece; alpha.25 list items 18 and 35, the joined-tree access hands-on's
 * S2 BASE). When the control that has the keyboard goes away (taken off the page, or no longer pressable: a Pro Mode
 * clear once its layer is clear, Close the playlist, the status bar's Turn on Stage, the screens line's X, the
 * Simple/Pro switch), the keyboard fell to the window's body: a screen reader said nothing, and the next Tab began again
 * from the top of the window. Now it stays in the part of the window it was in: the nearest landmark or group around
 * the control (the show controls' Clear one layer, the status bar, the middle, the header), or, where that went too
 * (the Simple/Pro switch), the one like it that came in its place. Never on another show control or a field: Enter
 * there presses nothing, and Space and the arrows still run the show, as on the window's body (useKeymap). The next Tab
 * goes on from there. A control made again in its place (the same test id, alone in the window) takes it back.
 *
 * Last of all: the window's own code puts the keyboard back first where it knows better (a menu to what opened it, the
 * Library sheet to Library, the open playlist's rows after a move, ui/Dialog.tsx to what opened a dialog), so the keeper
 * looks two frames later for removals, and only while the keyboard is still nowhere. Disabled controls recover at
 * the mutation checkpoint after local handlers, without waiting for a paint. This leaves usable focus restored by a
 * list's own handler alone (the open playlist's items and slide rows after a move). A focusable list remaining on the
 * page does not mean its handler restored focus: rename and removal still need the regional fallback when it did not.
 *
 * The operator window installs it (operator/main.tsx); a dialog there (ui/Dialog.tsx) closing after what opened it went
 * gives the keyboard to where that was, the same way (item 18: Set up Stage screen… goes as Screens opens). Other
 * windows keep their dialogs' old ways (the keeper is not installed there).
 */

/** The parts of the window the keyboard may be kept in: landmarks and named groups. Never a list or a menu. */
const PLACES =
  'header, footer, main, aside, nav, section[aria-label], section[aria-labelledby], [role="region"], [role="group"], [role="search"], [role="dialog"], [role="alertdialog"], [role="banner"], [role="contentinfo"], [role="main"], [role="complementary"], [role="navigation"]';

/** What can take the keyboard (Dialog.tsx's FOCUSABLE, with tabindex -1 too: made again, it took it then). */
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]';

/** A place the control sat in, as it was when it had the keyboard. */
interface Place {
  readonly el: HTMLElement;
  readonly tag: string;
  readonly role: string | null;
  readonly label: string | null;
}

/** Where a control was, read while it had the keyboard (once it has gone, its parents are gone from it too). */
interface Trail {
  /** Its places, the nearest first. */
  readonly places: readonly Place[];
  readonly testid: string | null;
}

const trails = new WeakMap<HTMLElement, Trail>();
/** The first focus outside each modal: React autoFocus may run before Dialog's trap effect reads it. */
const dialogOrigins = new WeakMap<HTMLElement, HTMLElement | null>();

let installed = false;
/** What has the keyboard now, or had it last; and what had it before that (a menu's opener). */
let held: HTMLElement | null = null;
let prior: HTMLElement | null = null;

/** Read where `el` is, for when it goes. */
export function rememberPlace(el: HTMLElement): void {
  if (!el.isConnected) return;
  const places: Place[] = [];
  // From itself (a place the keeper gave the keyboard to, that goes in its turn: one like it in its place).
  for (let at: HTMLElement | null = el; at && at !== document.body; at = at.parentElement)
    if (at.matches(PLACES))
      places.push({
        el: at,
        tag: at.tagName,
        role: at.getAttribute('role'),
        label: at.getAttribute('aria-label'),
      });
  // A portal may have no landmark of its own (a help card, a menu). Keep its originating region through every
  // control inside it, even when the last control and its predecessor both go away together.
  if (places.length === 0) {
    const from = trails.get(el) ?? (prior ? trails.get(prior) : undefined);
    if (from) places.push(...from.places);
  }
  trails.set(el, {
    places,
    testid: el.dataset['testid'] ?? null,
  });
}

/** In sight and reachable: on the page, drawn, not inert or hidden from screen readers, not behind an open dialog. */
function usable(el: HTMLElement): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  if (el.closest('[inert], [aria-hidden="true"]') !== null) return false;
  const dialogs = document.querySelectorAll('[aria-modal="true"]');
  const top = dialogs[dialogs.length - 1];
  return top === undefined || top.contains(el);
}

/**
 * It can no longer have the keyboard: taken off the page, not pressable, not drawn, or made inert. (Behind a dialog
 * opened over it is not gone: it has the keyboard back as the dialog closes.)
 */
function gone(el: HTMLElement): boolean {
  return (
    !el.isConnected ||
    el.matches(':disabled') ||
    el.getClientRects().length === 0 ||
    el.closest('[inert]') !== null
  );
}

/** The keyboard is nowhere: on the window's body, or still on `el` that can no longer have it. */
function nowhere(el: HTMLElement | null): boolean {
  const now = document.activeElement;
  return now === null || now === document.body || (el !== null && now === el && gone(el));
}

/** One like `place` in the window now: the same kind of part with the same name, or the same landmark. */
function likeIt(place: Place): HTMLElement | null {
  const all =
    place.label !== null
      ? document.querySelectorAll<HTMLElement>(`${place.tag}[aria-label="${CSS.escape(place.label)}"]`)
      : ['HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV'].includes(place.tag)
        ? document.querySelectorAll<HTMLElement>(place.tag)
        : [];
  for (const el of all) if (el.getAttribute('role') === place.role && usable(el)) return el;
  return null;
}

/** Where the keyboard goes now that `lost` went: a control again, or a place (made able to take it). */
function placeFor(lost: HTMLElement): { el: HTMLElement; place: boolean } | null {
  const trail = trails.get(lost);
  if (!trail) return null;
  // The same control, made again (its test id, alone in the window).
  if (trail.testid !== null) {
    const same = [
      ...document.querySelectorAll<HTMLElement>(`[data-testid="${CSS.escape(trail.testid)}"]`),
    ].filter((el) => el !== lost && el.matches(FOCUSABLE) && !el.matches(':disabled') && usable(el));
    const [only] = same;
    if (only && same.length === 1) return { el: only, place: false };
  }
  // Its nearest place still in the window, then one like it come in its place.
  for (const p of trail.places) if (usable(p.el)) return { el: p.el, place: true };
  for (const p of trail.places) {
    const like = likeIt(p);
    if (like) return { el: like, place: true };
  }
  return null;
}

/** The window's own parts the keeper made able to take the keyboard, as it gave it to them (until they lose it). */
function focusPlace(el: HTMLElement): void {
  const addedTabIndex = !el.hasAttribute('tabindex');
  if (addedTabIndex) el.setAttribute('tabindex', '-1');
  // Already focusable landmarks need the inset ring too. Keep their original tabindex when focus moves on.
  if (!el.hasAttribute('data-focus-kept')) {
    el.setAttribute('data-focus-kept', '');
    el.addEventListener(
      'blur',
      () => {
        el.removeAttribute('data-focus-kept');
        if (addedTabIndex && el.getAttribute('tabindex') === '-1') el.removeAttribute('tabindex');
      },
      { once: true },
    );
  }
  el.focus({ preventScroll: true });
}

/** Give the keyboard to where `lost` was (it went); true when something has it now. */
function keepFrom(lost: HTMLElement): boolean {
  // Something drawn over the window in no place of its own (a menu's choice whose opener went too): where the keyboard
  // was before it.
  const from = (trails.get(lost)?.places.length ?? 0) === 0 && prior && prior !== lost ? prior : lost;
  const to = placeFor(from);
  if (!to) return false;
  if (to.place) focusPlace(to.el);
  else to.el.focus();
  return document.activeElement === to.el;
}

/**
 * What had the keyboard as a dialog opens (ui/Dialog.tsx): what has it now; or, with the keyboard nowhere, the control
 * that had it if it went just now (Set up Stage screen… goes as it opens Screens). When autoFocus already put it
 * inside the new root, the first outside control is the opener, not that new field.
 */
export function focusOrigin(root?: HTMLElement): HTMLElement | null {
  const now = document.activeElement;
  if (now instanceof HTMLElement && now !== document.body) {
    if (installed && root?.contains(now)) return dialogOrigins.get(root) ?? null;
    return now;
  }
  return installed && held !== null && gone(held) ? held : null;
}

/** A dialog closes (ui/Dialog.tsx): the keyboard back to `before`, or, where it went, to where it was. */
export function giveFocusBack(before: HTMLElement): void {
  if (before.isConnected) before.focus();
  if (!installed || document.activeElement === before || !nowhere(null)) return;
  keepFrom(before);
}

/** Look two frames on (the window's own code first) and keep the keyboard if it is still nowhere. */
let looking = false;
function lookSoon(): void {
  if (looking) return;
  looking = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      looking = false;
      const el = held;
      if (!el || !gone(el) || !nowhere(el)) return;
      keepFrom(el);
    });
  });
}

/** The operator window's keeper (operator/main.tsx): follows the keyboard from now on. */
export function installFocusKeeper(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      const dialog = el.closest<HTMLElement>('[aria-modal="true"]');
      if (dialog && !dialogOrigins.has(dialog) && (held === null || !dialog.contains(held)))
        dialogOrigins.set(dialog, held);
      if (el !== held) {
        prior = held;
        held = el;
      }
      rememberPlace(el);
    },
    true,
  );
  // Blur with no destination may mean the focused control went; judge two frames on.
  document.addEventListener(
    'focusout',
    (e) => {
      if (e.target === held && e.relatedTarget === null) lookSoon();
    },
    true,
  );
  // DOM removal need not emit focusout. Child changes only need a look when the held element is disconnected;
  // attribute changes also cover a disabled clear, or a control made inert or hidden (itself or around it).
  new MutationObserver((records) => {
    const el = held;
    if (
      !el ||
      (el.isConnected &&
        !records.some((r) => r.type === 'attributes' && (r.target === el || r.target.contains(el))))
    )
      return;
    // A Mac can leave a newly disabled button active until a later paint. Its containing region already looks
    // correct, but the keyboard is still on a show control. Recover at this mutation checkpoint (after the local
    // handlers/commit), even if animation frames are withheld. Usable focus already restored elsewhere wins.
    if (el.matches(':disabled') && nowhere(el) && keepFrom(el)) return;
    lookSoon();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'inert', 'hidden'],
  });
}
