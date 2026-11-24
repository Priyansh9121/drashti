import { describe, expect, it } from 'vitest';
import { liveAnswer, PREVIEW_LIVE, revealPreview, stagePreviewOptions } from './stage-preview';

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

  // alpha.23 (lead 2's QA23-STAGE8-1, its rule "If you can't prove it, name the camera too (C)"): on CI the hall's
  // frames paused ~2 s each time the preview's camera joined, so the preview has none of this computer's live
  // pictures: no camera, no inputs' list, never a report, never a window's capture; it names them, as a tablet does.
  it('has no camera, no video inputs’ list, never says how an input stands, never captures a window', () => {
    expect(PREVIEW_LIVE).toEqual({ camera: false, list: false, report: false, window: false });
  });

  // a22-review-stage8 S4: the answers Main's handlers give (index.ts: cameraPage, videoInputs.list,
  // videoInputs.report, liveWindow.ask and .ended), so a wrong one fails here, not only on a show.
  it('Main refuses the preview every ask, even were it counted a screen', () => {
    for (const ask of ['camera', 'list', 'report', 'window'] as const) {
      expect(liveAnswer(ask, { preview: true, screen: false })).toBe('refused');
      // Judged as the preview first: never let through as a screen's page.
      expect(liveAnswer(ask, { preview: true, screen: true })).toBe('refused');
    }
  });

  it('Main answers a screen’s page yes to all, and any other page no', () => {
    for (const ask of ['camera', 'list', 'report', 'window'] as const) {
      expect(liveAnswer(ask, { preview: false, screen: true })).toBe('yes');
      expect(liveAnswer(ask, { preview: false, screen: false })).toBe('no');
    }
  });
});
