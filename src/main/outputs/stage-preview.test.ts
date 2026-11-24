import { describe, expect, it } from 'vitest';
import { PREVIEW_LIVE, revealPreview, stagePreviewOptions } from './stage-preview';

/*
 * The Stage preview's window (alpha.22, a22-review-stage S1 and S4): a normal window that never takes the keyboard
 * from the operator (the show's keys stay in the operator window), and on Windows no menu bar of its own.
 */

describe('the Stage preview window', () => {
  it('is a normal window, hidden until drawn, with no menu bar on Windows, over the controls’ display', () => {
    const o = stagePreviewOptions({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(o).toMatchObject({
      width: 960,
      height: 540,
      show: false,
      autoHideMenuBar: true,
      title: 'Drashti – Stage preview',
      backgroundColor: '#000000',
    });
    expect(o.x).toBe(480);
    expect(o.y).toBe(180);
    // No display known: the system places it.
    expect(stagePreviewOptions(null)).not.toHaveProperty('x');
  });

  it('comes forward without taking the keyboard: shown inactive, on top of the others, never focused', () => {
    const calls: string[] = [];
    const win = {
      isMinimized: () => calls.length === 0,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      showInactive: () => calls.push('showInactive'),
      focus: () => calls.push('focus'),
      moveTop: () => calls.push('moveTop'),
    };
    revealPreview(win);
    expect(calls).toEqual(['restore', 'showInactive', 'moveTop']);
  });

  // alpha.23 (lead 2's QA23-STAGE8-1): the video input live, as on a stage screen; never a say in how it stands, and
  // never another app's window (named on it instead).
  it('gets a camera as an output does and the video inputs’ list; never says how an input stands, never captures a window', () => {
    expect(PREVIEW_LIVE).toEqual({ camera: 'output', list: true, report: false, window: false });
  });
});
