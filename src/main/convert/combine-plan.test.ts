import { describe, expect, it } from 'vitest';
import { combinedName, combineJoins, combinePlan, frameFacts, type CombineInput } from './combine-plan';
import type { MediaInfo } from './plan';

/** What FFmpeg says reading a placeholder video (its first stream lines, as `ffmpeg -i` prints them). */
function words(size: string, rate: string, extra = ''): string {
  return [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'placeholder.mp4':",
    '  Duration: 00:00:03.00, start: 0.000000, bitrate: 83 kb/s',
    `  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), ${size}, 4 kb/s, ${rate} fps, ${rate} tbr, 12800 tbn (default)`,
    extra,
  ].join('\n');
}
function input(
  file: string,
  { width = 320, height = 180, durationMs = 3000, audio = true, pixFmt = 'yuv420p', still = false } = {},
  text = words(`${String(width)}x${String(height)} [SAR 1:1 DAR 16:9]`, '25'),
): CombineInput {
  const info: MediaInfo = {
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    durationMs,
    video: { codec: 'h264', pixFmt, width, height, still },
    audio: audio ? { codec: 'aac' } : null,
  };
  return { file, info, words: text };
}
const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1] ?? '';

describe('combinePlan', () => {
  it('makes one FFmpeg command that opens only the chosen files, joined end to end by the concat filter', () => {
    const plan = combinePlan([input('/media/a.mp4'), input('/media/b.mp4')]);
    const args = plan.args('/work/out.mp4');
    const opened = args.flatMap((arg, i) => (arg === '-i' ? [args[i + 1]] : []));
    expect(opened).toEqual(['/media/a.mp4', '/media/b.mp4']);
    // Each input's options cover only the -i after them (a22-review-combine MUST-1): every chosen file opens with
    // files only and one decoding thread, and the filter graph runs on one thread too.
    const each = args.flatMap((arg, i) => (arg === '-i' ? [args.slice(i - 4, i)] : []));
    expect(each).toEqual([
      ['-threads', '1', '-protocol_whitelist', 'file'],
      ['-threads', '1', '-protocol_whitelist', 'file'],
    ]);
    expect(
      args.slice(args.indexOf('-filter_complex_threads'), args.indexOf('-filter_complex_threads') + 2),
    ).toEqual(['-filter_complex_threads', '1']);
    // Never the concat protocol or a list naming other places: only the filter, over the two inputs.
    expect(args.some((arg) => arg.includes('concat:'))).toBe(false);
    expect(args).not.toContain('concat');
    expect(filterOf(args)).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]');
    expect(args.slice(args.indexOf('[v]') - 1, args.indexOf('[v]') + 3)).toEqual([
      '-map',
      '[v]',
      '-map',
      '[a]',
    ]);
    expect(args.at(-1)).toBe('/work/out.mp4');
    expect(args.slice(-3, -1)).toEqual(['-f', 'mp4']);
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p']));
    expect(plan.lengthMs).toBe(6000);
  });

  it('fits a video of another size and rate into the first one’s picture, letterboxed, at the first one’s rate', () => {
    const plan = combinePlan([
      input('/media/a.mp4'),
      input('/media/b.mp4', { width: 360, height: 640 }, words('360x640 [SAR 1:1 DAR 9:16]', '30')),
    ]);
    expect(plan).toMatchObject({ width: 320, height: 180, rate: '25' });
    const branches = filterOf(plan.args('/work/out.mp4')).split(';');
    const first = branches.find((b) => b.startsWith('[0:V:0]')) ?? '';
    const second = branches.find((b) => b.startsWith('[1:V:0]')) ?? '';
    for (const branch of [first, second]) {
      expect(branch).toContain('scale=320:180:force_original_aspect_ratio=decrease');
      expect(branch).toContain('pad=320:180:(ow-iw)/2:(oh-ih)/2:black');
      expect(branch).toContain('fps=25');
      expect(branch).toContain('format=yuv420p');
    }
    expect(first).toContain('trim=duration=3.000[v0]');
  });

  it('gives a video with no sound silence for its whole length, and resamples the sound of the others', () => {
    const plan = combinePlan([
      input('/media/a.mp4'),
      input('/media/b.mp4', { durationMs: 2000, audio: false }),
    ]);
    const filter = filterOf(plan.args('/work/out.mp4'));
    expect(filter).toContain(
      '[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=3.000[a0]',
    );
    expect(filter).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=2.000[a1]');
    expect(filter).not.toContain('[1:a:0]');
    expect(plan.lengthMs).toBe(5000);
  });

  it('takes more than two, in the order given', () => {
    const plan = combinePlan([input('/media/c.mp4'), input('/media/a.mp4'), input('/media/b.mp4')]);
    const args = plan.args('/work/out.mp4');
    expect(args.flatMap((arg, i) => (arg === '-i' ? [args[i + 1]] : []))).toEqual([
      '/media/c.mp4',
      '/media/a.mp4',
      '/media/b.mp4',
    ]);
    expect(filterOf(args)).toContain('[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]');
    for (const [i, arg] of args.entries())
      if (arg === '-i')
        expect(args.slice(i - 4, i)).toEqual(['-threads', '1', '-protocol_whitelist', 'file']);
    expect(plan.lengthMs).toBe(9000);
  });

  it('refuses what it cannot join: one video, eleven, a picture, transparency, no length, no picture', () => {
    expect(() => combinePlan([input('/media/a.mp4')])).toThrow('Choose two or more videos');
    expect(() => combinePlan(Array.from({ length: 11 }, (_, i) => input(`/media/${String(i)}.mp4`)))).toThrow(
      'at most 10',
    );
    expect(() => combinePlan([input('/media/a.mp4'), input('/media/b.png', { still: true })])).toThrow(
      'is not a video',
    );
    expect(() =>
      combinePlan([input('/media/a.mp4'), input('/media/b.webm', { pixFmt: 'yuva420p' })]),
    ).toThrow('transparency');
    expect(() =>
      combinePlan([
        input('/media/a.mp4'),
        { ...input('/media/b.mp4'), info: { ...input('').info, durationMs: null } },
      ]),
    ).toThrow('length');
    expect(() =>
      combinePlan([
        input('/media/a.mp4'),
        { ...input('/media/b.mp4'), info: { durationMs: 1000, video: null, audio: null } },
      ]),
    ).toThrow('is not a video');
  });

  it('keeps a turned phone video upright, widens non-square pixels, and keeps 29.97 exactly', () => {
    const turned = input(
      '/media/phone.mp4',
      { width: 1920, height: 1080 },
      words('1920x1080 [SAR 1:1 DAR 16:9]', '29.97', '      displaymatrix: rotation of -90.00 degrees'),
    );
    expect(combinePlan([turned, input('/media/b.mp4')])).toMatchObject({
      width: 1080,
      height: 1920,
      rate: '30000/1001',
    });
    const wide = input(
      '/media/dv.mp4',
      { width: 720, height: 576 },
      words('720x576 [SAR 16:15 DAR 4:3]', '25'),
    );
    expect(combinePlan([wide, input('/media/b.mp4')])).toMatchObject({ width: 768, height: 576 });
    // Larger than the H.264 Drashti draws everywhere: made no larger than it, the same shape.
    const huge = input(
      '/media/8k.mp4',
      { width: 7680, height: 4320 },
      words('7680x4320 [SAR 1:1 DAR 16:9]', '60'),
    );
    expect(combinePlan([huge, input('/media/b.mp4')])).toMatchObject({
      width: 4096,
      height: 2304,
      rate: '60',
    });
    const fast = input('/media/fast.mp4', {}, words('320x180 [SAR 1:1 DAR 16:9]', '120'));
    expect(combinePlan([fast, input('/media/b.mp4')]).rate).toBe('60');
  });
});

describe('frameFacts', () => {
  it('reads the first picture’s rate, pixel shape and turn from FFmpeg’s words', () => {
    expect(frameFacts(words('320x180 [SAR 1:1 DAR 16:9]', '25'))).toEqual({
      rate: '25',
      sar: 1,
      turned: false,
    });
    expect(frameFacts(words('720x480 [SAR 8:9 DAR 4:3]', '23.98'))).toEqual({
      rate: '24000/1001',
      sar: 8 / 9,
      turned: false,
    });
    expect(
      frameFacts(`${words('320x180', '59.94')}\n      displaymatrix: rotation of 90.00 degrees`),
    ).toEqual({
      rate: '60000/1001',
      sar: 1,
      turned: true,
    });
    expect(frameFacts('no stream at all')).toEqual({ rate: null, sar: 1, turned: false });
  });
});

describe('combinedName', () => {
  it('names the new video after the ones it joins, in their order', () => {
    expect(combinedName(['Opening.mp4', 'Talk.mov'])).toBe('Opening + Talk.mp4');
    expect(combinedName(['A.mp4', 'B.mp4', 'C.mp4'])).toBe('A + B + C.mp4');
    const long = 'L'.repeat(70);
    expect(combinedName([`${long}.mp4`, 'Second.mp4', 'Third.mp4'])).toBe(`${long} + 2 more.mp4`);
  });
});

/*
 * The owner, 24 Nov 2026: "transition between 2 merged videos". Dissolve (the default), Fade through black or Cut, of
 * 0.5 to 3 s: the length is the sum less each overlap; a video too short for it is joined with a plain cut.
 */
describe('combinePlan with a transition', () => {
  const opened = (args: string[]) => args.flatMap((arg, i) => (arg === '-i' ? [args[i + 1]] : []));
  it('dissolves picture and sound across the join: xfade and acrossfade over only the chosen files', () => {
    const plan = combinePlan([input('/media/a.mp4'), input('/media/b.mp4')], {
      transition: 'dissolve',
      transitionMs: 1000,
    });
    const args = plan.args('/work/out.mp4');
    expect(opened(args)).toEqual(['/media/a.mp4', '/media/b.mp4']);
    expect(args.some((arg) => arg.includes('concat:'))).toBe(false);
    const filter = filterOf(args);
    expect(filter).toContain('[v0][v1]xfade=transition=fade:duration=1.000:offset=2.000[v]');
    expect(filter).toContain('[a0][a1]acrossfade=d=1.000:c1=tri:c2=tri[a]');
    expect(filter).not.toContain('concat=');
    // Both brought to one size, rate and sound first, as xfade needs.
    for (const n of ['0', '1']) {
      const branch = filter.split(';').find((b) => b.startsWith(`[${n}:V:0]`)) ?? '';
      expect(branch).toContain('scale=320:180:force_original_aspect_ratio=decrease');
      expect(branch).toContain('fps=25');
    }
    expect(plan.lengthMs).toBe(5000);
    expect(plan.joins).toEqual(['transition']);
    expect(plan.short).toEqual([]);
  });

  it('fades through black, the sound dipping between them', () => {
    const plan = combinePlan([input('/media/a.mp4'), input('/media/b.mp4')], {
      transition: 'fade-black',
      transitionMs: 2500,
    });
    const filter = filterOf(plan.args('/work/out.mp4'));
    expect(filter).toContain('[v0][v1]xfade=transition=fadeblack:duration=2.500:offset=0.500[v]');
    expect(filter).toContain('[a0][a1]acrossfade=d=2.500:c1=exp:c2=exp[a]');
    expect(plan.lengthMs).toBe(3500);
  });

  it('puts the same transition at every join of three, each offset by the length so far', () => {
    const plan = combinePlan([input('/media/a.mp4'), input('/media/b.mp4'), input('/media/c.mp4')], {
      transition: 'dissolve',
      transitionMs: 1000,
    });
    const filter = filterOf(plan.args('/work/out.mp4'));
    expect(filter).toContain('[v0][v1]xfade=transition=fade:duration=1.000:offset=2.000[x1]');
    expect(filter).toContain('[a0][a1]acrossfade=d=1.000:c1=tri:c2=tri[y1]');
    expect(filter).toContain('[x1][v2]xfade=transition=fade:duration=1.000:offset=4.000[v]');
    expect(filter).toContain('[y1][a2]acrossfade=d=1.000:c1=tri:c2=tri[a]');
    expect(plan.lengthMs).toBe(7000);
  });

  it('joins a video shorter than the transition with a plain cut, and says which', () => {
    const plan = combinePlan([input('/media/a.mp4'), input('/media/b.mp4', { durationMs: 1000 })], {
      transition: 'dissolve',
      transitionMs: 1500,
    });
    const filter = filterOf(plan.args('/work/out.mp4'));
    expect(filter).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]');
    expect(filter).not.toContain('xfade');
    expect(plan).toMatchObject({ lengthMs: 4000, joins: ['cut'], short: [1] });
    // In the middle of three, too short for a transition at both its ends: the second join is a cut.
    const three = combinePlan(
      [input('/media/a.mp4'), input('/media/b.mp4', { durationMs: 1200 }), input('/media/c.mp4')],
      { transition: 'dissolve', transitionMs: 1000 },
    );
    const chain = filterOf(three.args('/work/out.mp4'));
    expect(chain).toContain('[v0][v1]xfade=transition=fade:duration=1.000:offset=2.000[x1]');
    expect(chain).toContain('[x1][y1][v2][a2]concat=n=2:v=1:a=1[v][a]');
    expect(three).toMatchObject({ lengthMs: 6200, joins: ['transition', 'cut'], short: [1] });
    // A cut, then a transition (a22-review-combine MUST-2): concat's pictures come out on another time base, which
    // xfade refuses, so they are given the first one's rate again before the next join.
    const cutFirst = combinePlan(
      [input('/media/a.mp4', { durationMs: 800 }), input('/media/b.mp4'), input('/media/c.mp4')],
      { transition: 'dissolve', transitionMs: 1000 },
    );
    const mixed = filterOf(cutFirst.args('/work/out.mp4'));
    expect(mixed).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[c1][y1];[c1]fps=25[x1]');
    expect(mixed).toContain('[x1][v2]xfade=transition=fade:duration=1.000:offset=2.800[v]');
    expect(mixed).toContain('[y1][a2]acrossfade=d=1.000:c1=tri:c2=tri[a]');
    expect(cutFirst).toMatchObject({ lengthMs: 5800, joins: ['cut', 'transition'], short: [0] });
  });

  it('cuts with no transition at all, the length the sum; refuses a transition outside 0.5 to 3 s', () => {
    const plan = combinePlan([input('/media/a.mp4'), input('/media/b.mp4')], {
      transition: 'cut',
      transitionMs: 1000,
    });
    expect(filterOf(plan.args('/work/out.mp4'))).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]');
    expect(plan).toMatchObject({ lengthMs: 6000, joins: ['cut'], short: [] });
    for (const transitionMs of [400, 3100])
      expect(() =>
        combinePlan([input('/media/a.mp4'), input('/media/b.mp4')], { transition: 'dissolve', transitionMs }),
      ).toThrow('0.5 to 3 seconds');
  });
});

describe('combineJoins', () => {
  it('says each join’s transition or cut, the new length and the videos too short, from their lengths', () => {
    const dissolve = { transition: 'dissolve' as const, transitionMs: 1000 };
    expect(combineJoins([3000, 2000], dissolve)).toEqual({
      joins: ['transition'],
      lengthMs: 4000,
      short: [],
    });
    expect(combineJoins([3000, 800, 3000], dissolve)).toEqual({
      joins: ['cut', 'cut'],
      lengthMs: 6800,
      short: [1],
    });
    expect(combineJoins([3000, 2000], { transition: 'cut', transitionMs: 1000 })).toEqual({
      joins: ['cut'],
      lengthMs: 5000,
      short: [],
    });
  });
});
