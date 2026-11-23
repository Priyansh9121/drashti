import { describe, expect, it, vi } from 'vitest';
import { fitStageTranslations } from './prepared-stage-fit';

function layout(sourceLines: number, translatedLines: number, fontSize = 100) {
  let sourceSize = fontSize;
  let fits = 0;
  const target = { style: { display: '' } };
  let attached = true;
  const style = { top: '0px', position: '' };
  const height = () =>
    (sourceLines + (!attached || target.style.display === 'none' ? 0 : translatedLines)) * sourceSize;
  const top = () => (500 - height()) / 2 + Number.parseFloat(style.top);
  const root = {
    style,
    querySelectorAll: () => (attached ? [target] : []),
    getBoundingClientRect: () => ({ top: top(), bottom: top() + height() }),
    scrollWidth: 400,
  } as unknown as HTMLElement;
  const box = {
    clientWidth: 500,
    getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
  } as unknown as HTMLElement;
  const fitOriginal = () => {
    fits += 1;
    sourceSize = Math.min(
      fontSize,
      500 / (sourceLines + (!attached || target.style.display === 'none' ? 0 : translatedLines)),
    );
  };
  return {
    removeTranslation: () => {
      attached = false;
    },
    root,
    box,
    fitOriginal,
    target,
    top,
    sourceSize: () => sourceSize,
    fits: () => fits,
  };
}

describe('prepared stage words preserve the original fit and anchor', () => {
  it('holds a whole translation rather than shrinking or moving the original in a centred box', () => {
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '100px' }));
    try {
      const value = layout(4, 2);
      expect(fitStageTranslations(value.root, value.box, value.fitOriginal)).toBe(false);
      expect(value.sourceSize()).toBe(100);
      expect(value.top()).toBe(50);
      expect(value.target.style.display).toBe('none');
      expect(value.fits()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('shows a fitting target below the original without recentering it, and reconsiders a previously held target', () => {
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '100px' }));
    try {
      const value = layout(2, 1);
      value.target.style.display = 'none';
      expect(fitStageTranslations(value.root, value.box, value.fitOriginal)).toBe(true);
      expect(value.sourceSize()).toBe(100);
      expect(value.top()).toBe(150);
      expect(value.target.style.display).toBe('');
      expect(value.fits()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('removes a previous centring correction when Hide removes the translated element', () => {
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '100px' }));
    try {
      const value = layout(2, 1);
      expect(fitStageTranslations(value.root, value.box, value.fitOriginal)).toBe(true);
      value.removeTranslation();
      expect(fitStageTranslations(value.root, value.box, value.fitOriginal)).toBe(true);
      expect(value.top()).toBe(150);
      expect(value.sourceSize()).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does not add unreadably small secondary words even when the original itself uses small type', () => {
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '32px' }));
    try {
      const value = layout(2, 1, 32);
      expect(fitStageTranslations(value.root, value.box, value.fitOriginal)).toBe(false);
      expect(value.sourceSize()).toBe(32);
      expect(value.target.style.display).toBe('none');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
