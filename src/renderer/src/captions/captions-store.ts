import { create } from 'zustand';
import type { CaptionsStatus } from '../../../shared/captions';
import { captionsStatusLine } from './captions-words';

/*
 * Live captions in the operator window (Session 55, Part 10): the dialog, opened by File › Live Captions… (Pro Mode).
 * How captions stand is kept whole only while it is open; a window is never sent a word heard. The status bar's line
 * (cap-threads) is kept always: why captions that are on show nothing, or null.
 */

export const useCaptions = create<{ view: CaptionsStatus | null; open: boolean; line: string | null }>(
  () => ({
    view: null,
    open: false,
    line: null,
  }),
);

/** A reply that is how captions stand (a refusal, in Simple Mode, is not). */
const isStatus = (v: unknown): v is CaptionsStatus =>
  typeof v === 'object' && v !== null && 'speech' in v && 'download' in v;

/** How captions stand, as told: the dialog's whole view while it is open, the status bar's line always. */
function told(view: CaptionsStatus): void {
  const line = captionsStatusLine(view);
  if (useCaptions.getState().open) useCaptions.setState({ view, line });
  else useCaptions.setState({ line });
}

export function takeCaptions(pending: Promise<unknown>): void {
  void pending.then((view) => {
    if (isStatus(view)) told(view);
  });
}

let connected = false;

export function connectCaptions(): void {
  if (connected) return;
  connected = true;
  window.drashti.captions.onChanged(told);
  window.drashti.captions.onOpen(openCaptions);
  // The status bar's line from the start: captions left on start with Drashti (a refusal, in Simple Mode, is none).
  takeCaptions(window.drashti.captions.view());
}

export function openCaptions(): void {
  void window.drashti.captions.view().then((view) => {
    if (isStatus(view)) useCaptions.setState({ view, open: true, line: captionsStatusLine(view) });
  });
}

export function closeCaptions(): void {
  useCaptions.setState({ open: false, view: null });
}
