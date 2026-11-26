import { describe, expect, it } from 'vitest';
import type { MediaInfo } from './plan';
import { clipExportArgs } from './clip-export-plan';
const picture = { codec: 'h264', pixFmt: 'yuv420p', width: 1920, height: 1080, still: false };
const info: MediaInfo = {
  durationMs: 4000,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: picture,
  audio: { codec: 'aac' },
};
describe('frame-exact clip exports', () => {
  it('accurately decodes a non-keyframe range into a new fast-start MP4 and selects the requested audio', () => {
    const args = clipExportArgs(
      { source: 'placeholder source.mp4', startMs: 350, endMs: 1750, shape: 'source', info, audioTrack: 1 },
      'placeholder clip.mp4',
    );
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6)).toEqual([
      '-ss',
      '0.350',
      '-i',
      'placeholder source.mp4',
      '-t',
      '1.400',
    ]);
    expect(args).toContain('libx264');
    expect(args).toContain('0:a:1');
    expect(args).toContain('+faststart');
    expect(args).not.toContain('copy');
    expect(args.at(-1)).toBe('placeholder clip.mp4');
  });
  it('makes a central 9:16 crop without stretching or touching the original', () => {
    const args = clipExportArgs(
      { source: 'placeholder source.mp4', startMs: 0, endMs: 1000, shape: 'vertical', info },
      'placeholder vertical.mp4',
    );
    expect(args[args.indexOf('-vf') + 1]).toContain('crop=');
    expect(args[args.indexOf('-vf') + 1]).toContain('9/16');
    expect(args[args.indexOf('-vf') + 1]).toContain('setsar=1');
  });
  it('rejects out-of-range or reversed intervals before any output is queued', () => {
    for (const [startMs, endMs] of [
      [-1, 1000],
      [3000, 2000],
      [0, 4500],
    ])
      expect(() =>
        clipExportArgs(
          { source: 'placeholder.mp4', startMs: startMs ?? 0, endMs: endMs ?? 0, shape: 'source', info },
          'clip.mp4',
        ),
      ).toThrow();
  });
  it('retains alpha and a source without sound, and normalizes its pixel shape', () => {
    const args = clipExportArgs(
      {
        source: 'placeholder.webm',
        startMs: 0,
        endMs: 1000,
        shape: 'vertical',
        info: { ...info, video: { ...picture, codec: 'vp9', pixFmt: 'yuva420p' }, audio: null },
      },
      'clip.webm',
    );
    expect(args).toContain('libvpx-vp9');
    expect(args).toContain('yuva420p');
    expect(args).not.toContain('0:a:0');
  });
});

/*
 * Parts of one video joined into one clip (alpha.24; the owner, 27 Nov 2026: "one video can be cut in 2 parts and
 * merged, for example a 30 minute video, i want from 0 to 10 and 20 to 30 but in 1 video").
 */
describe('a clip of two or more parts of one video', () => {
  const square = "scale=w='trunc(iw*if(gt(sar,0),sar,1)/2)*2':h=trunc(ih/2)*2,setsar=1";
  const long: MediaInfo = { ...info, durationMs: 1_800_000 };
  it('keeps one part’s export exactly as it was, argument for argument', () => {
    const base = {
      source: 'placeholder source.mp4',
      startMs: 350,
      endMs: 1750,
      shape: 'source' as const,
      info,
    };
    const today = [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-nostats',
      '-progress',
      'pipe:2',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-ss',
      '0.350',
      '-i',
      'placeholder source.mp4',
      '-t',
      '1.400',
      '-map',
      '0:V:0',
      '-map',
      '0:a:0',
      '-sn',
      '-dn',
      '-vf',
      `${square},format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-fps_mode',
      'passthrough',
      '-map_metadata',
      '0',
      '-metadata:s:v:0',
      'rotate=0',
      '-f',
      'mp4',
      'placeholder clip.mp4',
    ];
    expect(clipExportArgs(base, 'placeholder clip.mp4')).toEqual(today);
    expect(
      clipExportArgs({ ...base, parts: [{ startMs: 350, endMs: 1750 }] }, 'placeholder clip.mp4'),
    ).toEqual(today);
  });
  it('opens the one file once per part at the part’s start, and joins the parts with a cut, picture and sound held together', () => {
    const args = clipExportArgs(
      {
        source: 'placeholder source.mp4',
        startMs: 0,
        endMs: 1_800_000,
        shape: 'source',
        info: long,
        parts: [
          { startMs: 0, endMs: 600_000 },
          { startMs: 1_200_000, endMs: 1_800_000 },
        ],
      },
      'placeholder joined.mp4',
    );
    const part = (n: number) =>
      `[${String(n)}:V:0]${square},format=yuv420p,tpad=stop_mode=clone:stop_duration=600.000,trim=end=600.000[v${String(n)}];` +
      `[${String(n)}:a:0]apad,atrim=end=600.000[a${String(n)}]`;
    expect(args).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-nostats',
      '-progress',
      'pipe:2',
      '-filter_complex_threads',
      '1',
      '-threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-ss',
      '0.000',
      '-t',
      '600.000',
      '-i',
      'placeholder source.mp4',
      '-threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-ss',
      '1200.000',
      '-t',
      '600.000',
      '-i',
      'placeholder source.mp4',
      '-filter_complex',
      `${part(0)};${part(1)};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-sn',
      '-dn',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-fps_mode',
      'passthrough',
      '-map_metadata',
      '0',
      '-map_chapters',
      '-1',
      '-metadata:s:v:0',
      'rotate=0',
      '-f',
      'mp4',
      'placeholder joined.mp4',
    ]);
    // Only the one chosen file is opened, with files only, never the concat protocol or a list of other places.
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args.filter((_, i) => args[i - 1] === '-i')).toEqual([
      'placeholder source.mp4',
      'placeholder source.mp4',
    ]);
    expect(args.join(' ')).not.toMatch(/concat:|-f concat|-safe/u);
  });
  it('leaves out the source’s chapters, which no longer fit a joined clip’s time; one part keeps them as before', () => {
    // A joined clip has no output -t to trim them by: FFmpeg would copy part 1's input's chapters shifted only by its
    // start (a24-review-vidparts N8).
    const parts = [
      { startMs: 500, endMs: 1000 },
      { startMs: 2000, endMs: 3000 },
    ];
    const joined = clipExportArgs(
      { source: 'placeholder.mp4', startMs: 500, endMs: 3000, shape: 'source', info, parts },
      'joined.mp4',
    );
    const at = joined.indexOf('-map_chapters');
    expect(joined.slice(at, at + 2)).toEqual(['-map_chapters', '-1']);
    expect(at).toBeGreaterThan(joined.indexOf('-filter_complex'));
    expect(at).toBeLessThan(joined.indexOf('joined.mp4'));
    const one = clipExportArgs(
      { source: 'placeholder.mp4', startMs: 500, endMs: 1000, shape: 'source', info },
      'one.mp4',
    );
    expect(one).not.toContain('-map_chapters');
  });
  it('makes each part vertical, selects the chosen sound track, and keeps three parts in their order', () => {
    const args = clipExportArgs(
      {
        source: 'placeholder source.mp4',
        startMs: 500,
        endMs: 3500,
        shape: 'vertical',
        info,
        audioTrack: 1,
        parts: [
          { startMs: 500, endMs: 1000 },
          { startMs: 1500, endMs: 2250 },
          { startMs: 3000, endMs: 3500 },
        ],
      },
      'placeholder vertical.mp4',
    );
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(args.filter((_, i) => args[i - 1] === '-ss')).toEqual(['0.500', '1.500', '3.000']);
    expect(args.filter((_, i) => args[i - 1] === '-t')).toEqual(['0.500', '0.750', '0.500']);
    for (const n of ['0', '1', '2']) {
      expect(graph).toContain(`[${n}:a:1]apad`);
      expect(graph).toMatch(new RegExp(`\\[${n}:V:0\\][^;]*crop=1920\\*9/16:1920[^;]*\\[v${n}\\]`, 'u'));
    }
    expect(graph).toContain('trim=end=0.750[v1]');
    expect(graph).toContain('atrim=end=0.750[a1]');
    expect(graph).toMatch(/\[v0\]\[a0\]\[v1\]\[a1\]\[v2\]\[a2\]concat=n=3:v=1:a=1\[v\]\[a\]$/u);
    expect(args).not.toContain('-vf');
  });
  it('joins pictures alone when the video has no sound, and keeps WebM transparency with each part’s own decoder', () => {
    const args = clipExportArgs(
      {
        source: 'placeholder.webm',
        startMs: 0,
        endMs: 3000,
        shape: 'source',
        info: { ...info, video: { ...picture, codec: 'vp9', pixFmt: 'yuva420p' }, audio: null },
        container: 'webm',
        parts: [
          { startMs: 0, endMs: 1000 },
          { startMs: 2000, endMs: 3000 },
        ],
      },
      'placeholder joined.webm',
    );
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toMatch(/\[v0\]\[v1\]concat=n=2:v=1:a=0\[v\]$/u);
    expect(graph).not.toContain('apad');
    expect(args).not.toContain('[a]');
    expect(args).toContain('-an');
    expect(args.filter((_, i) => args[i - 1] === '-c:V:0')).toEqual(['libvpx-vp9', 'libvpx-vp9']);
    expect(graph).toContain('format=yuva420p');
    expect(args.slice(-3)).toEqual(['-f', 'webm', 'placeholder joined.webm']);
  });
  it('refuses parts that overlap, are empty, out of order, outside the video or not matching the clip’s start and end', () => {
    const plan = (
      parts: { startMs: number; endMs: number }[],
      startMs = parts[0]?.startMs ?? 0,
      endMs = parts.at(-1)?.endMs ?? 0,
    ) =>
      clipExportArgs({ source: 'placeholder.mp4', startMs, endMs, shape: 'source', info, parts }, 'clip.mp4');
    for (const parts of [
      [
        { startMs: 0, endMs: 1500 },
        { startMs: 1000, endMs: 2000 },
      ],
      [
        { startMs: 0, endMs: 1000 },
        { startMs: 1500, endMs: 1500 },
      ],
      [
        { startMs: 2000, endMs: 3000 },
        { startMs: 0, endMs: 1000 },
      ],
      [
        { startMs: 0, endMs: 1000 },
        { startMs: 3000, endMs: 4500 },
      ],
    ])
      expect(() => plan(parts), JSON.stringify(parts)).toThrow(
        'Choose parts inside this video, each ending before the next one starts.',
      );
    const fine = [
      { startMs: 0, endMs: 1000 },
      { startMs: 2000, endMs: 3000 },
    ];
    expect(() => plan(fine)).not.toThrow();
    expect(() => plan(fine, 500)).toThrow();
    expect(() => plan(fine, 0, 3500)).toThrow();
  });
});
