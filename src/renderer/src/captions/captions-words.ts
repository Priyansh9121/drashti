import type { CaptionsStatus } from '../../../shared/captions';

/* The Live captions dialog's words (Session 55, Part 10). */

export const megabytes = (bytes: number): string => `${String(Math.round(bytes / 1_000_000))} MB`;

/** What the listening is doing now, and what to do about it. */
export function captionsStateText(view: CaptionsStatus): string {
  if (!view.engine) return view.engineProblem ?? 'This copy of Drashti has no captions engine.';
  if (!view.on) return 'Off on this computer.';
  const s = view.speech;
  switch (s.phase) {
    case 'off':
      return 'On: captions start when the screens are ready.';
    case 'starting':
      return 'Starting…';
    case 'listening':
      return 'Listening to the stream’s sound input.';
    case 'held':
      if (s.reason === 'busy')
        return 'Resting: this computer is busy, and the show comes first. Captions try again by themselves in a minute.';
      if (s.reason === 'no-sound-input')
        return 'No sound input is chosen for the stream: choose one in the stream’s settings, and captions start.';
      return 'Waiting for the model.';
    case 'failed':
      return s.message;
  }
}

/** How the model stands on this computer. */
export function downloadText(view: CaptionsStatus): string {
  const d = view.download;
  switch (d.phase) {
    case 'missing':
      return d.message ?? `The model (${megabytes(d.total)}) downloads once, when captions are turned on.`;
    case 'downloading':
      return `Downloading the model: ${String(Math.round(d.done / 1_000_000))} of ${megabytes(d.total)}.`;
    case 'ready':
      return 'The model is on this computer.';
    case 'failed':
      return d.message ?? 'The model could not be downloaded.';
  }
}
