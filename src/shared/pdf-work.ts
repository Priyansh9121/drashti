import type { StreamStatus } from './stream';
export function pdfOffAir(status: Pick<StreamStatus, 'live' | 'recording'> | null): boolean {
  return status !== null && status.live.state === 'off' && status.recording.state === 'off';
}

/**
 * Extract pages…, Replace page…, Split… and Hand-out… (x85, alpha.21) wait while the stream is on air or recording, and
 * so do an extracted file's or presentation's Undo and Redo. Everything else in the PDF editor goes on during a show:
 * marks, Save, page preparation, a single Make a slide… and Save a PDF copy… (QA21-TAKEPDF-1 A).
 */
export const PDF_PAGES_ON_AIR =
  'No pages are extracted while the stream is on air or recording: extract them once it has stopped.';
/** An extraction to a new PDF stopped by the stream going on air or starting to record. */
export const PDF_PAGES_STOPPED =
  'The pages were not extracted: the stream went on air or started recording. Extract them again once it has stopped.';
/** The editor's word when one of those four is chosen and Main says the stream is on air or recording. */
export const PDF_PAGES_WAIT =
  'Extract pages, Replace page, Split and Hand-out wait while the stream is on air or recording.';
/** PDF pages' note while the editor knows the stream or a recording is starting, on or ending. */
export const PDF_PAGES_WAIT_NOTE =
  'Extract, Replace, Split and Hand-out wait until the stream and recording are off.';

/** IPC refusals must never become permission through JavaScript truthiness. */
export function pdfAcknowledged(value: unknown): boolean {
  return value === true;
}
