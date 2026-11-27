/** The safe interface pictures that can fade; a show control and an output never take part. */
export type InterfaceFade = 'look' | 'mode' | 'help';

// Structural DOM types: this module also runs in the isolated preload, whose TypeScript has no DOM library.
interface FadeStyle {
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): unknown;
}
interface FadeElement {
  style: FadeStyle;
  closest(selector: string): unknown;
  querySelector(selector: string): unknown;
  contains(other: FadeElement): boolean;
  getBoundingClientRect(): { width: number; height: number };
}
interface FadeRoot {
  style: FadeStyle;
  dataset: Record<string, string | undefined>;
}
interface Events {
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
}
interface FadeDocument extends Events {
  documentElement: FadeRoot | null;
  visibilityState: string;
  querySelectorAll(selector: string): Iterable<FadeElement>;
  dispatchEvent?(event: unknown): unknown;
  startViewTransition?: (change: () => void) => {
    skipTransition(): void;
    finished: Promise<void>;
    ready?: Promise<void>;
  };
}
interface FadeMedia extends Events {
  matches: boolean;
}
interface FadeEnvironment {
  document?: FadeDocument;
  matchMedia?: (query: string) => FadeMedia;
  Event?: new (name: string) => unknown;
  MutationObserver?: new (changed: () => void) => {
    observe(target: FadeRoot, options: { attributes: boolean; attributeFilter: string[] }): void;
    disconnect(): void;
  };
}

const STOP = 'drashti-interface-stop';
const BLOCKED = [
  '[data-show-control]',
  '[data-testid="live-preview"]',
  '[data-testid="slide-thumb"]',
  '[data-testid="playlist-item"]',
  '[data-render-view]',
  'canvas',
  'video',
  'iframe',
  'body.output',
  'body.web',
].join(', ');
const PICTURES = '[data-variant], [data-what-is-this], [data-band]';
const names = new WeakMap<FadeElement, string>();
let serial = 0;
let running: { stop(): void } | null = null;
const environment = () => globalThis as unknown as FadeEnvironment;

/** End both worlds' interface fades before the show changes; a pending update still runs exactly once. */
export function stopInterfaceFade(): void {
  running?.stop();
  const win = environment();
  if (win.Event && win.document?.documentElement?.dataset['interfaceFade'] !== undefined)
    win.document.dispatchEvent?.(new win.Event(STOP));
}

/**
 * Fade safe interface pictures around a synchronous change. There is deliberately no root snapshot: the show's
 * controls and all output pictures remain live, take input and change at once. Only named, non-nested pictures enter
 * Chromium's transition overlay. CSS fixes each group's geometry and fades opacity alone. No canvas, GPU device,
 * renderer, cloned controls, delayed Tab stops or show-state subscription is created here.
 */
export function fadeInterface(change: () => void, kind: InterfaceFade, allowed = true): void {
  stopInterfaceFade();
  const win = environment();
  const doc = win.document;
  const root = doc?.documentElement;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const forced = win.matchMedia?.('(forced-colors: active)');
  const canFade = () =>
    allowed &&
    root?.dataset['opened'] !== undefined &&
    root.dataset['chip'] === 'yes' &&
    (root.dataset['interfaceMotion'] === 'calm' || root.dataset['interfaceMotion'] === 'lively') &&
    doc?.visibilityState !== 'hidden' &&
    reduced?.matches !== true &&
    forced?.matches !== true;
  if (!doc || !root || !doc.startViewTransition || !canFade()) {
    change();
    return;
  }

  let applied = false;
  const phase = { stopped: false };
  let transition: ReturnType<NonNullable<FadeDocument['startViewTransition']>> | undefined;
  const restore = new Map<FadeStyle, { value: string; priority: string }>();
  const setName = (style: FadeStyle, name: string) => {
    if (!restore.has(style))
      restore.set(style, {
        value: style.getPropertyValue('view-transition-name'),
        priority: style.getPropertyPriority('view-transition-name'),
      });
    style.setProperty('view-transition-name', name);
  };
  const markPictures = () => {
    const marked: FadeElement[] = [];
    for (const el of doc.querySelectorAll(kind === 'help' ? '[data-what-is-this]' : PICTURES)) {
      if (el.closest(BLOCKED) || el.querySelector(BLOCKED) || marked.some((parent) => parent.contains(el)))
        continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      let name = names.get(el);
      if (!name) {
        name = `motionlooks-${String(++serial)}`;
        names.set(el, name);
      }
      setName(el.style, name);
      marked.push(el);
    }
  };
  const apply = () => {
    if (applied) return;
    applied = true;
    change();
  };
  const held = () => {
    if (!canFade()) handle.stop();
  };
  const observer = win.MutationObserver ? new win.MutationObserver(held) : undefined;
  const clean = () => {
    for (const [style, before] of restore) {
      if (before.value) style.setProperty('view-transition-name', before.value, before.priority);
      else style.removeProperty('view-transition-name');
    }
    restore.clear();
    if (running === handle) {
      running = null;
      delete root.dataset['interfaceFade'];
    }
    reduced?.removeEventListener('change', held);
    forced?.removeEventListener('change', held);
    doc.removeEventListener('visibilitychange', held);
    doc.removeEventListener(STOP, handle.stop);
    observer?.disconnect();
  };
  const handle = {
    stop: () => {
      if (phase.stopped) return;
      phase.stopped = true;
      try {
        apply();
      } finally {
        transition?.skipTransition();
        clean();
      }
    },
  };
  running = handle;
  root.dataset['interfaceFade'] = kind;
  setName(root.style, 'none');
  reduced?.addEventListener('change', held);
  forced?.addEventListener('change', held);
  doc.addEventListener('visibilitychange', held);
  doc.addEventListener(STOP, handle.stop);
  observer?.observe(root, { attributes: true, attributeFilter: ['data-interface-motion', 'data-chip'] });
  try {
    markPictures();
    transition = doc.startViewTransition(() => {
      apply();
      if (!phase.stopped) {
        markPictures();
        held();
      }
    });
    // skipTransition can be needed inside a synchronous test callback, before startViewTransition returns its handle.
    if (phase.stopped) transition.skipTransition();
    // A skipped native transition rejects ready; skipping is normal when the show or a motion preference changes.
    void transition.ready?.catch(() => undefined);
    void transition.finished.then(clean, clean);
  } catch {
    handle.stop();
  }
}
