/** Sizes supplied by the browser's layout pass; observing never flushes style/layout from a show commit. */
export function observeTextSizes(
  box: HTMLElement,
  words: HTMLElement,
  measured: (size: { width: number; height: number; wordsHeight: number }) => void,
): () => void {
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
  observer.observe(words, { box: 'border-box' });
  return () => observer.disconnect();
}
