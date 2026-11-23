import type { StreamStatus } from './stream';
export function pdfOffAir(_status: Pick<StreamStatus, 'live' | 'recording'> | null): boolean {
  throw new Error('PDF off-air policy is not yet implemented.');
}
