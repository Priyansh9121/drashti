// Addresses only, never another retained copy of the pixels. This page's preloaders and slide waits fill it.
const decoded = new Set<string>();

/** A successful decode in this page; the sync paint guard still covers a copy discarded since then. */
export const slideImageDecoded = (img: HTMLImageElement): boolean => {
  // The usual absolute src attribute already is a decoded key; avoid resolving and serializing it on every Next.
  const address = img.getAttribute('src');
  return (address !== null && decoded.has(address)) || decoded.has(img.src);
};

/** Decode away from the paint, recording only the actual address that completed, never a source changed meanwhile. */
export function decodeSlideImage(img: HTMLImageElement): Promise<void> {
  const src = img.src;
  return img.decode().then(() => {
    if (img.src === src && (img.currentSrc || img.src) === src) decoded.add(src);
  });
}
