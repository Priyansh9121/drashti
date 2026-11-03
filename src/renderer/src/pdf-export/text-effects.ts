/** Chromium prints CSS text shadows as extra searchable glyphs. Capture only
 * that decoration onto transparent pixels, leaving the real words native. */
export async function rasterizeTextEffects(
  mount: HTMLElement,
  size: { width: number; height: number },
  capture: () => Promise<Uint8Array | null>,
): Promise<() => void> {
  const elements = [...mount.querySelectorAll<HTMLElement | SVGElement>('[data-element]')];
  const boxes = elements.filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      !!element.textContent.trim() &&
      [element, ...element.querySelectorAll<HTMLElement>('*')].some(
        (part) => getComputedStyle(part).textShadow !== 'none',
      ),
  );
  if (!boxes.length) return () => undefined;
  const backgrounds = [
    document.documentElement,
    document.body,
    mount,
    ...mount.querySelectorAll<HTMLElement>('[data-slide]'),
  ];
  const styles = new Map<HTMLElement | SVGElement, string | null>();
  const remember = (element: HTMLElement | SVGElement) => {
    if (!styles.has(element)) styles.set(element, element.getAttribute('style'));
  };
  const restore = (element: HTMLElement | SVGElement) => {
    const style = styles.get(element);
    if (style == null) element.removeAttribute('style');
    else element.setAttribute('style', style);
  };
  for (const element of [...elements, ...backgrounds]) remember(element);
  const rasters: { box: HTMLElement; data: Uint8Array }[] = [];
  try {
    for (const element of backgrounds) element.style.setProperty('background', 'transparent', 'important');
    for (const element of elements) element.style.visibility = 'hidden';
    for (const box of boxes) {
      const parts = [box, ...box.querySelectorAll<HTMLElement>('*')];
      for (const part of parts) {
        remember(part);
        part.style.setProperty('color', 'transparent', 'important');
        part.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
        part.style.setProperty('-webkit-text-stroke', '0 transparent', 'important');
      }
      box.style.visibility = 'visible';
      const data = await capture();
      if (!data) throw new Error('A PDF text effect could not be retained safely.');
      rasters.push({ box, data });
      for (const part of parts) restore(part);
      box.style.visibility = 'hidden';
    }
  } finally {
    for (const element of styles.keys()) restore(element);
  }
  const images: HTMLImageElement[] = [];
  const urls: string[] = [];
  const cleanup = () => {
    for (const image of images) image.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    for (const element of styles.keys()) restore(element);
  };
  try {
    for (const { box, data } of rasters) {
      const image = document.createElement('img');
      images.push(image);
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.setAttribute('data-pdf-text-effects', '');
      // The final fractional CSS pixel is clipped by the paper; never rescale it.
      Object.assign(image.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${(Math.ceil((size.width * 4) / 3) * 3) / 4}px`,
        height: `${(Math.ceil((size.height * 4) / 3) * 3) / 4}px`,
        maxWidth: 'none',
        pointerEvents: 'none',
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type: 'image/png' }));
      urls.push(url);
      image.src = url;
      await image.decode();
      box.before(image);
      for (const part of [box, ...box.querySelectorAll<HTMLElement>('*')])
        part.style.setProperty('text-shadow', 'none', 'important');
    }
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
