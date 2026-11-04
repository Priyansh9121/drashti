import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Size } from '../../../shared/scaling';

/** The element's content-box size, kept current with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>, fractional = false): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (entry?: ResizeObserverEntry) => {
      // Unpadded thumbnail viewports need their fractional layout size for exact fitting.
      const measured = fractional
        ? (entry?.contentRect ?? el.getBoundingClientRect())
        : { width: el.clientWidth, height: el.clientHeight };
      const { width, height } = measured;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    update();
    const observer = new ResizeObserver((entries) => update(entries[0]));
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, fractional]);
  return size;
}
