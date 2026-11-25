import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DisplayInfo, ScreenConfig, ScreenState } from '../../../shared/screens';
import { DisplayCard } from './ScreensDashboard';

/* The screens dashboard's card for one display: what it says of the screen on it (a23-heartbeat, review M1). */

const display: DisplayInfo = {
  id: 2,
  label: 'Placeholder display',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  pixelWidth: 1920,
  pixelHeight: 1080,
  refreshHz: 60,
  rotation: 0,
  internal: false,
  primary: false,
  key: {
    id: 2,
    label: 'Placeholder display',
    pixelWidth: 1920,
    pixelHeight: 1080,
    x: 0,
    y: 0,
    internal: false,
  },
};
const screen: ScreenConfig = {
  id: 'placeholder-hall',
  groupId: 'placeholder-group',
  name: 'Placeholder hall',
  nodeId: null,
  displayKey: display.key,
  enabled: true,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  feed: null,
};

/** The card's state badge: its words and whether it is in the danger tone. */
function badge(state: ScreenState, restarts?: number): { words: string; danger: boolean; success: boolean } {
  const html = renderToStaticMarkup(
    createElement(DisplayCard, {
      display,
      number: 1,
      screen,
      state,
      output: null,
      thumb: null,
      nodeId: null,
      simple: false,
      ...(restarts === undefined ? {} : { restarts }),
    }),
  );
  const tag = /<[^>]*data-testid="dashboard-state"[^>]*>([^<]*)</u.exec(html);
  return {
    words: tag?.[1] ?? '',
    danger: tag?.[0].includes('bg-danger-bg') ?? false,
    success: tag?.[0].includes('bg-success-bg') ?? false,
  };
}

describe('the screens dashboard’s card', () => {
  it('says a showing screen is showing, in green, and a stopped one stopped, in red, as before', () => {
    expect(badge('showing')).toEqual({ words: 'Showing', danger: false, success: true });
    expect(badge('stopped')).toEqual({ words: 'Stopped', danger: true, success: false });
  });

  it('says a screen the heartbeat restarted again and again keeps restarting, in red, never Showing (a23-heartbeat)', () => {
    expect(badge('showing', 4)).toEqual({ words: 'Keeps restarting', danger: true, success: false });
  });
});
