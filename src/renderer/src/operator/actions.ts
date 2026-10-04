import { create } from 'zustand';
import type { TaskProgress } from '../../../shared/app-info';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { PlaylistCursor } from '../../../shared/engine/state';
import { useEngine } from '../engine/engine-store';
import { requestRemoval } from '../library/import-store';
import { undoRemoval } from '../library/undo';
import { selectPresentation, useLibrary } from '../library/library-store';
import { playOrder } from '../../../shared/order';
import type { OperatorAction } from '../../../shared/keymap';
// logo-store uses dispatch from here; both only call each other when an action runs.
import { toggleLogo } from './logo-store';

/** The last problem to show the operator (for example "Slide 4 of 3 does not exist"). */
export const useNotice = create<{ text: string | null }>(() => ({ text: null }));

/** A long task's progress (a backup copying the media), or null. */
export const useTaskProgress = create<{ progress: TaskProgress | null }>(() => ({ progress: null }));

/** Wait until this window's copy of the engine state has reached `rev` (a second at most). */
function seen(rev: number, ms = 1000): Promise<void> {
  return new Promise((resolve) => {
    if (useEngine.getState().rev >= rev) {
      resolve();
      return;
    }
    const stop = useEngine.subscribe((s) => {
      if (s.rev < rev) return;
      stop();
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, ms);
  });
}

/** Settled when `promise` is, or after `ms`, whichever comes first. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

/** Every command sent from this window, settled once answered and seen in its copy of the state. */
let sent: Promise<void> = Promise.resolve();

export function dispatch(command: EngineCommand): Promise<void> {
  const done = (async () => {
    const result = await window.drashti.engine.dispatch(command);
    useNotice.setState({ text: result.ok ? null : result.message });
    if (result.ok) await seen(result.rev);
  })();
  sent = Promise.allSettled([sent, done]).then(() => undefined);
  return done;
}

/*
 * Keys and buttons take effect in turn, each once this window has seen what
 * the ones before it did (a click on a slide too). What Next does depends on
 * what is live: pressed twice quickly at the start of a playlist item, the
 * second press must see the item live and go on, not start it again. A step
 * that never ends (the main process gone) holds the keys up two seconds at
 * most.
 */
let turn: Promise<void> = Promise.resolve();

function inTurn(run: () => Promise<void>): Promise<void> {
  const mine = turn.then(() => within(sent, 1500)).then(run);
  turn = within(
    mine.catch(() => undefined),
    2000,
  );
  return mine;
}

/**
 * Go live at a position in an order (an arrangement, or null for every slide
 * in order), from a playlist item when one is given, so Next carries on into
 * the next item.
 */
export function goLive(
  presentationId: string,
  slideIndex: number,
  arrangementId: string | null,
  playlist: PlaylistCursor | null = null,
): Promise<void> {
  return dispatch({ type: 'goLive', presentationId, slideIndex, arrangementId, playlist });
}

/** Start a playlist item: a presentation at its first slide, or a picture, video or sound. */
export function playItem(playlistId: string, itemId: string): Promise<void> {
  return dispatch({ type: 'playItem', playlistId, itemId });
}

/** Choose the order a presentation plays in; the slide grid follows it. */
export async function chooseArrangement(presentationId: string, arrangementId: string | null): Promise<void> {
  const result = await window.drashti.library.setArrangement(presentationId, arrangementId);
  useNotice.setState({ text: result.ok ? null : result.message });
  if (result.ok && useLibrary.getState().selectedId === presentationId)
    await selectPresentation(presentationId);
}

/**
 * What a shortcut or button does. The arrow keys work on what the slide grid
 * shows: a playlist item or a presentation. If it is not live yet, Next
 * starts it (a presentation at its first slide); once it is live, Next and
 * Previous go along it, and on into the next or previous playlist item.
 */
export function runAction(action: OperatorAction, ui: { openScreens: () => void }): Promise<void> {
  return inTurn(() => perform(action, ui));
}

async function perform(action: OperatorAction, ui: { openScreens: () => void }): Promise<void> {
  const live = useEngine.getState().state?.live;
  const { selectedId, doc, item } = useLibrary.getState();
  const somethingLive = live?.presentationId != null || live?.playlist != null;
  const itemIsLive =
    item !== null && live?.playlist?.playlistId === item.playlistId && live.playlist.itemId === item.id;
  const selectedIsLive = item === null && live?.presentationId != null && live.presentationId === selectedId;
  switch (action) {
    case 'next':
      if (itemIsLive || selectedIsLive) return dispatch({ type: 'next' });
      if (item && (item.kind === 'media' || (item.kind === 'presentation' && item.presentationName !== null)))
        return playItem(item.playlistId, item.id);
      if (!item && selectedId && doc?.id === selectedId && doc.groups.some((g) => g.slides.length > 0))
        return goLive(selectedId, 0, playOrder(doc, doc.selectedArrangementId).arrangementId);
      if (somethingLive) return dispatch({ type: 'next' });
      return;
    case 'previous':
      if (itemIsLive || selectedIsLive || (!item && !selectedId && somethingLive))
        return dispatch({ type: 'previous' });
      return;
    case 'nextItem':
      return dispatch({ type: 'nextItem' });
    case 'previousItem':
      return dispatch({ type: 'previousItem' });
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
    case 'clearTicker':
      return dispatch({ type: 'clearLayer', layer: 'ticker' });
    case 'toggleBlackout':
      return dispatch({ type: 'toggleBlackout' });
    case 'toggleLogo':
      return toggleLogo();
    case 'openScreens':
      ui.openScreens();
      return;
    case 'uncoverControls':
      await window.drashti.screens.uncoverOperator();
      return;
    case 'removeSelected':
      requestRemoval();
      return;
    case 'findInLibrary': {
      const box = document.getElementById('library-search');
      if (box instanceof HTMLInputElement) {
        box.focus();
        box.select();
      }
      return;
    }
    case 'undo':
      await undoRemoval();
      return;
  }
}

/**
 * What a key does in Simple Mode. The arrow keys run the open playlist:
 * Next starts it when nothing is live; Back undoes the last Next exactly.
 * Undo puts back what Clear all took down. Nothing that changes the library,
 * the screens or the sound has a key here.
 */
/** Back (undo the last Next exactly, else Previous), in turn with the keys: a MIDI pad's Back in Pro Mode. */
export function runBack(): Promise<void> {
  return inTurn(() => dispatch({ type: 'back' }));
}

export function runSimpleAction(action: OperatorAction, start: () => Promise<void>): Promise<void> {
  return inTurn(() => performSimple(action, start));
}

async function performSimple(action: OperatorAction, start: () => Promise<void>): Promise<void> {
  const state = useEngine.getState().state;
  const live = state?.live;
  // Next plays what is cued (the arti), else goes on, else starts the playlist.
  const somethingLive = live?.presentationId != null || live?.playlist != null || state?.cue != null;
  switch (action) {
    case 'next':
      return somethingLive ? dispatch({ type: 'next' }) : start();
    case 'previous':
      return dispatch({ type: 'back' });
    case 'undo':
      return dispatch({ type: 'putBack' });
    case 'openScreens':
    case 'findInLibrary':
    case 'removeSelected':
      return;
    default:
      return perform(action, { openScreens: () => undefined });
  }
}
