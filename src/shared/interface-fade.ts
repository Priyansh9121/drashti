/** Only the live Help question mark can fade. Readable words and document pictures never take part. */
export type InterfaceFade = 'help';

// Structural DOM types keep the module usable by both TypeScript configurations, without top-level DOM work.
interface FadeAnimation {
  cancel(): void;
  finished: Promise<void>;
}
interface FadeElement {
  textContent: string | null;
  closest(selector: string): unknown;
  querySelector(selector: string): unknown;
  getBoundingClientRect(): { width: number; height: number };
  animate?: (
    frames: { opacity: number }[],
    options: { duration: number; easing: string; fill: 'none' },
  ) => FadeAnimation;
}
interface FadeRoot {
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
}
interface FadeMedia extends Events {
  matches: boolean;
}
interface FadeEnvironment {
  document?: FadeDocument;
  matchMedia?: (query: string) => FadeMedia;
  getComputedStyle?: (root: FadeRoot) => { getPropertyValue(name: string): string };
  MutationObserver?: new (changed: () => void) => {
    observe(target: FadeRoot, options: { attributes: boolean; attributeFilter: string[] }): void;
    disconnect(): void;
  };
}

const BLOCKED = '[data-show-control], [data-render-view], canvas, video, iframe, body.output, body.web';
let running: { stop(): void } | null = null;

/** Cancel decoration at once. The state change has already happened, so no callback can restore stale UI. */
export function stopInterfaceFade(): void {
  running?.stop();
}

/**
 * Apply Help synchronously, then fade only live '?' elements in place. Help-off unmounts them immediately; there is
 * no leaving copy, delayed state update, containing layout animation, snapshot or interception of show input.
 */
export function fadeInterface(change: () => void, _kind: InterfaceFade, allowed = true): void {
  stopInterfaceFade();
  change();
  const win = globalThis as unknown as FadeEnvironment;
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
  if (!doc || !root || !canFade()) return;
  const tokens = win.getComputedStyle?.(root);
  const time = tokens?.getPropertyValue('--dur-menu').trim() ?? '';
  const duration = Number.parseFloat(time) * (time.endsWith('ms') ? 1 : 1000);
  const easing = tokens?.getPropertyValue('--ease-out').trim() ?? '';
  if (!Number.isFinite(duration) || duration <= 0 || !easing) return;

  const animations: FadeAnimation[] = [];
  let stopped = false;
  const held = () => {
    if (!canFade()) handle.stop();
  };
  const observer = win.MutationObserver ? new win.MutationObserver(held) : undefined;
  const clean = () => {
    if (stopped) return;
    stopped = true;
    if (running === handle) running = null;
    reduced?.removeEventListener('change', held);
    forced?.removeEventListener('change', held);
    doc.removeEventListener('visibilitychange', held);
    observer?.disconnect();
  };
  const handle = {
    stop: () => {
      if (stopped) return;
      for (const animation of animations) animation.cancel();
      clean();
    },
  };
  running = handle;
  reduced?.addEventListener('change', held);
  forced?.addEventListener('change', held);
  doc.addEventListener('visibilitychange', held);
  observer?.observe(root, {
    attributes: true,
    attributeFilter: ['data-interface-motion', 'data-chip', 'data-opened'],
  });
  try {
    for (const el of doc.querySelectorAll('[data-what-is-this]')) {
      if (el.textContent?.trim() !== '?' || !el.animate || el.closest(BLOCKED) || el.querySelector(BLOCKED))
        continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const animation = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing, fill: 'none' });
      animations.push(animation);
      void animation.finished.catch(() => undefined);
    }
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(clean);
  } catch {
    handle.stop();
  }
}
