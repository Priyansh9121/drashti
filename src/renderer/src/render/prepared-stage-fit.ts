/** Fit original stage words first; secondary words may use only the space left below that anchor. */
export function fitStageTranslations(root: HTMLElement, box: HTMLElement, fitOriginal: () => void): boolean {
  const translations = [...root.querySelectorAll<HTMLElement>('[data-prepared-translation="true"]')];
  if (!translations.length) {
    fitOriginal();
    return true;
  }
  root.style.top = '0px';
  for (const el of translations) el.style.display = 'none';
  fitOriginal();
  const originalTop = root.getBoundingClientRect().top;
  for (const el of translations) el.style.display = '';
  // A middle/bottom-aligned box must not recenter its source around the added words.
  root.style.position = 'relative';
  root.style.top = `${originalTop - root.getBoundingClientRect().top}px`;
  const words = root.getBoundingClientRect();
  const area = box.getBoundingClientRect();
  if (
    words.top >= area.top - 0.5 &&
    words.bottom <= area.bottom + 0.5 &&
    root.scrollWidth <= box.clientWidth + 0.5 &&
    translations.every((el) => Number.parseFloat(getComputedStyle(el).fontSize) >= 36)
  )
    return true;
  for (const el of translations) el.style.display = 'none';
  root.style.top = '0px';
  return false;
}
