export interface TextSizes {
  width: number;
  height: number;
  wordsHeight: number;
}

/** Observe layout sizes while allowing the box's contents to change. */
export function createTextSizeObserver(box: HTMLElement, measured: (size: TextSizes) => void) {
  let words: HTMLElement | null = null;
  let frame: { width: number; height: number } | null = null;
  let wordsHeight: number | null = null;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === box) frame = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (entry.target === words) wordsHeight = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
    }
    if (frame && wordsHeight !== null) measured({ ...frame, wordsHeight });
  });
  observer.observe(box);
  return {
    /** Observe new words, or ask for a fresh size of the same words after layout. */
    observeWords(next: HTMLElement | null) {
      if (words) observer.unobserve(words);
      words = next;
      wordsHeight = null;
      if (words) observer.observe(words, { box: 'border-box' });
    },
    disconnect: () => observer.disconnect(),
  };
}

/** Sizes supplied by the browser's layout pass; observing never flushes style/layout from a show commit. */
export function observeTextSizes(
  box: HTMLElement,
  words: HTMLElement,
  measured: (size: TextSizes) => void,
): () => void {
  const observer = createTextSizeObserver(box, measured);
  observer.observeWords(words);
  return observer.disconnect;
}
