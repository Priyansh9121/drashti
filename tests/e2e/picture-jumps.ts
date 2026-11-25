/*
 * The cost spec's picture-jump watch (lead 2's QF-1, a22-fade-picture), run in each page by `page.evaluate`: each
 * background picture's jumps on the hall, LIVE and the stream's picture page. A jumping picture is frozen until it
 * lands; one sent again as it lands stays frozen (its 'seeked' comes with it seeking again), and one let go of before
 * it landed was frozen until then. Self-contained (Playwright sends its source to the page), so no imports.
 * Unit tests: src/main/testing/picture-jumps.test.ts.
 */

/** One jump: its picture's slot key, from when it began, until when it landed (null: still open). */
export interface PictureJump {
  key: string;
  from: number;
  to: number | null;
  /** When its element left the page while the jump was open (lead 2's QFP-11 B, a record), or null. */
  left: number | null;
}

/** Installs the watch on this page: its jumps in `globalThis.s5PictureJumps`. */
export function watchPictureJumps(): void {
  const jumps: PictureJump[] = [];
  (globalThis as { s5PictureJumps?: PictureJump[] }).s5PictureJumps = jumps;
  const open = new Map<EventTarget, PictureJump>();
  // Lead 2's QFP-11 B, a record only: when the element of a jump still open left the page. Its 'emptied' then fires
  // on a detached element and never reaches this page's listeners, so the jump stays open.
  new MutationObserver(() => {
    for (const [el, jump] of open)
      if (jump.left === null && el instanceof Node && !el.isConnected) jump.left = Date.now();
  }).observe(document, { subtree: true, childList: true });
  const land = (e: Event) => {
    const el = e.target;
    if (!(el instanceof HTMLVideoElement) || (e.type === 'seeked' && el.seeking)) return;
    const jump = open.get(el);
    if (!jump) return;
    jump.to = Date.now();
    open.delete(el);
  };
  document.addEventListener(
    'seeking',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLVideoElement) || open.has(el)) return;
      const key = el.dataset['bgSlot'];
      if (key === undefined || jumps.length >= 5000) return;
      const jump: PictureJump = { key, from: Date.now(), to: null, left: null };
      open.set(el, jump);
      jumps.push(jump);
    },
    true,
  );
  document.addEventListener('seeked', land, true);
  document.addEventListener('emptied', land, true);
}
