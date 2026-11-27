import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Choose whole words or their compact form inside a slot whose width never depends on the current status. */
export function useStatusPriority(words: string, present = true) {
  const slot = useRef<HTMLElement | null>(null);
  const wordsRef = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(true);
  const slotRef = useCallback((element: HTMLElement | null) => {
    slot.current = element;
  }, []);
  useLayoutEffect(() => {
    const room = slot.current;
    const label = wordsRef.current;
    if (!room || !label || !present) return;
    const measure = () => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const style = getComputedStyle(room);
      const available =
        room.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight) -
        Number.parseFloat(style.columnGap) -
        13;
      setCompact(Math.ceil(range.getBoundingClientRect().width) > Math.floor(available));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(room);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [words, present]);
  return { slotRef, wordsRef, compact };
}
