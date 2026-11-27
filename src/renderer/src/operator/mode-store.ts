import { create } from 'zustand';
import { flushSync } from 'react-dom';
import { fadeInterface, stopInterfaceFade } from '../../../shared/interface-fade';
import { sinceShowChanged } from '../engine/show-changed';
import type { OperatorMode } from '../../../shared/mode';

/** Simple Mode or Pro Mode, as the main process keeps it (null until it has said). */
export const useMode = create<{ mode: OperatorMode | null }>(() => ({
  mode: null,
}));

// The event and the reply can name the same mode before Chromium takes its old snapshot.
let pendingMode: OperatorMode | null = null;

/** One synchronous commit inside a safe fade; a repeated IPC answer never cancels the same pending change. */
function drawMode(mode: OperatorMode): void {
  if ((pendingMode ?? useMode.getState().mode) === mode) return;
  stopInterfaceFade();
  const before = useMode.getState().mode;
  pendingMode = mode;
  fadeInterface(
    () => {
      pendingMode = null;
      flushSync(() => {
        useMode.setState({ mode });
      });
    },
    'mode',
    before !== null && sinceShowChanged() > 800,
  );
}

let connected = false;

export function connectMode(): void {
  if (connected) return;
  connected = true;
  window.drashti.app.onModeChanged((mode) => {
    drawMode(mode);
  });
  // The window shows nothing until it knows (App), so it must always come to know (Session 38): when the
  // request fails, Simple Mode, the safe side (only the show's controls, each of which works in either mode),
  // until the main process says otherwise.
  void window.drashti.app.getMode().then(
    (mode) => {
      drawMode(mode);
    },
    (error: unknown) => {
      console.warn('The mode could not be asked, so the window shows Simple Mode', error);
      if (useMode.getState().mode === null) drawMode('simple');
    },
  );
}

export async function enterSimpleMode(): Promise<void> {
  const result = await window.drashti.app.setMode('simple');
  if (result.ok) drawMode(result.mode);
}

/**
 * Back to Pro Mode (Session 55, Part 18: a double-click on Simple Mode's Pro Mode, nothing typed): the problem in
 * words (Simple access refuses it), or null when it worked.
 */
export async function leaveSimpleMode(): Promise<string | null> {
  const result = await window.drashti.app.setMode('pro');
  if (!result.ok) return result.message;
  drawMode(result.mode);
  return null;
}
