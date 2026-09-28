import { create } from 'zustand';
import type { EngineCommand } from '../../../shared/engine/commands';
import { useEngine } from '../engine/engine-store';
import { requestRemoval, undoRemoval } from '../library/import-store';
import { useLibrary } from '../library/library-store';
import type { OperatorAction } from '../../../shared/keymap';

/** The last problem to show the operator (for example "Slide 4 of 3 does not exist"). */
export const useNotice = create<{ text: string | null }>(() => ({ text: null }));

export async function dispatch(command: EngineCommand): Promise<void> {
  const result = await window.drashti.engine.dispatch(command);
  useNotice.setState({ text: result.ok ? null : result.message });
}

export function goLive(presentationId: string, slideIndex: number): Promise<void> {
  return dispatch({ type: 'goLive', presentationId, slideIndex });
}

/**
 * What a shortcut or button does. The arrow keys work on the selected
 * presentation: if it is not live yet, Next starts it at its first slide.
 */
export async function runAction(action: OperatorAction, ui: { openScreens: () => void }): Promise<void> {
  const live = useEngine.getState().state?.live;
  const { selectedId, doc } = useLibrary.getState();
  const selectedIsLive = live?.presentationId != null && live.presentationId === selectedId;
  switch (action) {
    case 'next':
      if (selectedIsLive) return dispatch({ type: 'next' });
      if (selectedId && doc?.id === selectedId && doc.groups.some((g) => g.slides.length > 0))
        return goLive(selectedId, 0);
      if (live?.presentationId) return dispatch({ type: 'next' });
      return;
    case 'previous':
      if (selectedIsLive || (!selectedId && live?.presentationId)) return dispatch({ type: 'previous' });
      return;
    case 'clearAll':
      return dispatch({ type: 'clearAll' });
    case 'clearSlide':
      return dispatch({ type: 'clearLayer', layer: 'slide' });
    case 'clearBackground':
      return dispatch({ type: 'clearLayer', layer: 'background' });
    case 'clearProps':
      return dispatch({ type: 'clearLayer', layer: 'props' });
    case 'clearMessages':
      return dispatch({ type: 'clearLayer', layer: 'messages' });
    case 'clearAudio':
      return dispatch({ type: 'clearLayer', layer: 'audio' });
    case 'clearMasks':
      return dispatch({ type: 'clearLayer', layer: 'masks' });
    case 'toggleBlackout':
      return dispatch({ type: 'toggleBlackout' });
    case 'openScreens':
      ui.openScreens();
      return;
    case 'uncoverControls':
      await window.drashti.screens.uncoverOperator();
      return;
    case 'removeSelected':
      requestRemoval();
      return;
    case 'undo':
      await undoRemoval();
      return;
  }
}
