import { describe, expect, it } from 'vitest';
import { pdfOffAir } from './pdf-work';
import type { StreamStatus, LiveState, RecordingState } from './stream';
describe('PDF work off-air admission', () => {
  it('fails closed without a status and refuses every live or recording transition', () => {
    expect(pdfOffAir(null)).toBe(false);
    for (const live of ['off', 'starting', 'live', 'reconnecting', 'ending'] satisfies LiveState[]) {
      for (const recording of ['off', 'starting', 'recording'] satisfies RecordingState[]) {
        const status = { live: { state: live }, recording: { state: recording } } as StreamStatus;
        expect(pdfOffAir(status), `${live}/${recording}`).toBe(live === 'off' && recording === 'off');
      }
    }
  });
});
