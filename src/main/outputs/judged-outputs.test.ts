import { describe, expect, it } from 'vitest';
import type { ScreenStatus } from '../../shared/screens';
import { judgedOutputs, type JudgedWindow } from './judged-outputs';

/* The outputs the heartbeat judges, on Main and on a node alike (a23-heartbeat, review MA1). */

const win = (
  over: Partial<{ destroyed: boolean; visible: boolean; minimized: boolean; crashed: boolean }> = {},
) => {
  const w = { destroyed: false, visible: true, minimized: false, crashed: false, ...over };
  const judged: JudgedWindow = {
    isDestroyed: () => w.destroyed,
    isVisible: () => w.visible,
    isMinimized: () => w.minimized,
    webContents: { isCrashed: () => w.crashed },
  };
  return judged;
};
const st = (screenId: string, state: ScreenStatus['state']): ScreenStatus => ({
  screenId,
  state,
  displayId: 2,
});

describe('the outputs the heartbeat judges', () => {
  it('showing, and stopped too (a retry that hangs is noticed, and a kept page is tried again for good)', () => {
    const windows = new Map([
      ['showing', win()],
      ['stopped', win()],
      ['missing', win()],
    ]);
    expect(
      judgedOutputs(
        [st('showing', 'showing'), st('stopped', 'stopped'), st('missing', 'missing-display')],
        (id) => windows.get(id),
      ),
    ).toEqual(['showing', 'stopped']);
  });

  it('never a page that has crashed and waits for the watchdog, one closed, hidden or minimized, or one with no window', () => {
    const windows = new Map([
      ['crashed', win({ crashed: true })],
      ['closed', win({ destroyed: true })],
      ['hidden', win({ visible: false })],
      ['minimized', win({ minimized: true })],
    ]);
    const all = ['crashed', 'closed', 'hidden', 'minimized', 'none'].map((id) => st(id, 'stopped'));
    expect(judgedOutputs(all, (id) => windows.get(id))).toEqual([]);
  });
});
