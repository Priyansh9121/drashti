import { describe, expect, it } from 'vitest';
import { GPU_STOPPED_TWICE, GPU_STOPS_WITHIN_MS, GpuStops } from './gpu-stops';

describe('the GPU process stopping (Sessions 31–36, ROB-5)', () => {
  it('tells the second stop within 10 minutes, once', () => {
    const stops = new GpuStops();
    expect(stops.stopped(0)).toBe(false);
    expect(stops.stopped(GPU_STOPS_WITHIN_MS - 1)).toBe(true);
    // A third close by: already told.
    expect(stops.stopped(GPU_STOPS_WITHIN_MS)).toBe(false);
  });

  it('says nothing of stops further apart', () => {
    const stops = new GpuStops();
    expect(stops.stopped(0)).toBe(false);
    expect(stops.stopped(GPU_STOPS_WITHIN_MS + 1)).toBe(false);
    expect(stops.stopped(3 * GPU_STOPS_WITHIN_MS)).toBe(false);
    expect(GPU_STOPPED_TWICE).toMatch(/^The screens’ graphics stopped twice in 10 minutes/u);
  });
});
