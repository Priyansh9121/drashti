import type { StreamStatus } from './stream';
export function pdfOffAir(status: Pick<StreamStatus, 'live' | 'recording'> | null): boolean {
  return status !== null && status.live.state === 'off' && status.recording.state === 'off';
}
