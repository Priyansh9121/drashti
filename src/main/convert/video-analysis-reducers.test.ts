import { describe, expect, it } from 'vitest';
import { WAVEFORM_BUCKETS } from '../../shared/video-analysis';
import { SceneReducer, WaveformReducer } from './video-analysis-reducers';

function pcm(samples: number[]): Buffer {
  const result = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => result.writeInt16LE(value, i * 2));
  return result;
}
describe('bounded streaming video analysis', () => {
  it('preserves min/max source-time peaks even when PCM splits inside a sample', () => {
    const r = new WaveformReducer(4);
    const bytes = pcm([-32768, 16384, -8192, 32767]);
    r.push(bytes.subarray(0, 3));
    r.push(bytes.subarray(3));
    expect(r.finish()).toEqual({
      durationMs: 4,
      peaks: [
        [-1, -1],
        [0.5, 0.5],
        [-0.25, -0.25],
        [32767 / 32768, 32767 / 32768],
      ],
    });
  });
  it('bounds an hours-long source and consumes excess decoder samples without growing storage', () => {
    const r = new WaveformReducer(3_600_000);
    const chunk = pcm(Array<number>(1000).fill(16384));
    for (let i = 0; i < 3602; i++) r.push(chunk);
    const data = r.finish();
    expect(data.peaks).toHaveLength(WAVEFORM_BUCKETS);
    expect(data.peaks[0]).toEqual([0.5, 0.5]);
    expect(data.peaks.at(-1)).toEqual([0.5, 0.5]);
    expect(JSON.stringify(data).length).toBeLessThan(70_000);
  });
  it('extracts only valid cuts, across split lines, ignores metadata and caps suggestions', () => {
    const r = new SceneReducer(8000);
    r.push(Buffer.from('frame:0 pts:512 pts_ti'));
    r.push(
      Buffer.from(
        'me:2.5\nlavfi.scene_score=0.9\nframe:1 pts:1024 pts_time:4\nframe:2 pts:1025 pts_time:4\nframe:3 pts:99999 pts_time:99\n',
      ),
    );
    expect(r.finish()).toEqual([2500, 4000]);
    const bounded = new SceneReducer(86_400_000);
    bounded.push(
      Buffer.from(
        Array.from({ length: 5000 }, (_, i) => `frame:${String(i)} pts:0 pts_time:${String(i + 1)}\n`).join(
          '',
        ),
      ),
    );
    expect(bounded.finish()).toHaveLength(50);
  });
});
