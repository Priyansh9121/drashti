import { useEffect, useState } from 'react';

/**
 * Whether an element scrolls now (its content taller than it), kept current as it or a child changes size or a
 * child comes or goes: a ref callback and the answer. A scrolling box with nothing focusable in it takes the
 * keyboard (tabIndex 0) only while it scrolls, so the text at 200% can still be scrolled with the keys and axe's
 * scrollable-region-focusable holds (the old Simple Mode window's middle first, 23 Oct 2026; Session 55, the
 * Wallpapers panel's "No wallpapers yet").
 */
export function useScrolls(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    if (!el) return;
    const check = () => {
      setScrolls(el.scrollHeight > el.clientHeight + 1);
    };
    const sizes = new ResizeObserver(check);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
      check();
    };
    const children = new MutationObserver(watch);
    children.observe(el, { childList: true });
    watch();
    return () => {
      children.disconnect();
      sizes.disconnect();
    };
  }, [el]);
  return [setEl, scrolls];
}
