import { describe, expect, it, vi } from 'vitest';
import type { RenderErrorReport } from '../../../shared/render-errors';
import { reportRenderError } from '../ui/render-errors';
import { SceneBoundary } from './SceneBoundary';
import { WarmUpBoundary } from './WarmUpBoundary';

/*
 * Around the GPU warm-up's drawing (render/WarmUp.tsx; Session 57, the review of h-maskperf's MEDIUM-1): a scene that
 * fails as it draws ends the warm-up there, with the hand-over of a warm-up drawn to its end, and the page draws the
 * show. Before, the warm-up sat outside the show's boundary on the hall's screens and the stream's page, and a throw
 * in any of its scenes left the page black for good (Main reloaded it, and it failed again). Its error still goes to
 * the page's root, as every caught one does, reported as the warm-up's so that Main reloads nothing for it.
 * tests/e2e/warm-up.spec.ts sees it all on a hall screen, the LIVE picture and the stream's page (a test switch).
 */

describe('the warm-up’s error boundary', () => {
  it('draws nothing in place of the warm-up once a scene fails, and ends the warm-up', () => {
    let ended = 0;
    const boundary = new WarmUpBoundary({
      onError: () => {
        ended += 1;
      },
      children: 'the scenes',
    });
    expect(boundary.render()).toBe('the scenes');
    expect(ended).toBe(0);
    boundary.state = WarmUpBoundary.getDerivedStateFromError();
    expect(boundary.render()).toBeNull();
    boundary.componentDidCatch();
    expect(ended).toBe(1);
  });

  it('the error it caught is reported as the warm-up’s; any other boundary’s as caught, and one none caught as uncaught, as before', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sent: RenderErrorReport[] = [];
    const send = (r: RenderErrorReport) => {
      sent.push(r);
      return Promise.resolve(null);
    };
    const error = new Error('A test asked this warm-up scene to fail as it drew');
    const componentStack = '\n    at FailForTests (output.js:1:1)';
    const caught = reportRenderError('output', 'caught', send);
    caught(error, {
      componentStack,
      errorBoundary: new WarmUpBoundary({ onError: () => undefined, children: null }),
    });
    caught(error, { componentStack, errorBoundary: new SceneBoundary({ resetKey: 1, children: null }) });
    caught(error, { componentStack });
    reportRenderError('output', 'uncaught', send)(error, { componentStack });
    expect(sent.map((r) => r.kind)).toEqual(['warm-up', 'caught', 'caught', 'uncaught']);
    expect(sent[0]?.message).toBe('Error: A test asked this warm-up scene to fail as it drew');
    expect(quiet).toHaveBeenCalledTimes(4);
    quiet.mockRestore();
  });
});
