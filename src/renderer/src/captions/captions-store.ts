import { create } from 'zustand';
import type { CaptionsStatus } from '../../../shared/captions';

/*
 * Live captions in the operator window (Session 55, Part 10): the dialog, opened by File › Live Captions… (Pro Mode).
 * How captions stand is asked for only then; a window is never sent a word heard.
 */

export const useCaptions = create<{ view: CaptionsStatus | null; open: boolean }>(() => ({
  view: null,
  open: false,
}));

/** A reply that is how captions stand (a refusal, in Simple Mode, is not). */
const isStatus = (v: unknown): v is CaptionsStatus =>
  typeof v === 'object' && v !== null && 'speech' in v && 'download' in v;

export function takeCaptions(pending: Promise<unknown>): void {
  void pending.then((view) => {
    if (isStatus(view) && useCaptions.getState().open) useCaptions.setState({ view });
  });
}

let connected = false;

export function connectCaptions(): void {
  if (connected) return;
  connected = true;
  window.drashti.captions.onChanged((view) => {
    if (useCaptions.getState().open) useCaptions.setState({ view });
  });
  window.drashti.captions.onOpen(openCaptions);
}

export function openCaptions(): void {
  void window.drashti.captions.view().then((view) => {
    if (isStatus(view)) useCaptions.setState({ view, open: true });
  });
}

export function closeCaptions(): void {
  useCaptions.setState({ open: false, view: null });
}
