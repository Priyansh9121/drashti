import type { StreamStatus } from './stream';
export function pdfOffAir(status: Pick<StreamStatus, 'live' | 'recording'> | null): boolean {
  return status !== null && status.live.state === 'off' && status.recording.state === 'off';
}

/** IPC refusals must never become permission through JavaScript truthiness. */
export function pdfAcknowledged(value: unknown): boolean {
  return value === true;
}
