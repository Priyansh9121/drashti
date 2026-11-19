import { describe, expect, it } from 'vitest';
import { MAX_CAPTION_CHARS, captionAt, captionFileInfo, readVideoCaptions } from './video-captions';

const srt = (start: string, end: string, text: string) => `1\n${start} --> ${end}\n${text}\n`;

describe('video caption reader', () => {
  it('reads SRT with a BOM, CRLF, source timestamps and plain text', () => {
    const result = readVideoCaptions(
      '\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\nFirst placeholder\r\nSecond line\r\n',
    );
    expect(result.cues).toEqual([{ startMs: 1250, endMs: 3000, text: 'First placeholder\nSecond line' }]);
    expect(result.problem).toBeNull();
  });

  it('reads WebVTT identifiers, settings and short timestamps, leaving out headers and notes', () => {
    const result = readVideoCaptions(
      'WEBVTT\nKind: captions\n\nNOTE a note\nignored\n\nSTYLE\n::cue { color: red; }\n\nintro\n00:01.500 --> 00:03.000 align:start position:20%\n<b>Sample</b> &amp; <i>words</i>\n',
    );
    expect(result.cues).toEqual([{ startMs: 1500, endMs: 3000, text: 'Sample & words' }]);
  });

  it('removes styling, voices, inline clocks and unsafe markup, with Unicode entities preserved', () => {
    const result = readVideoCaptions(
      srt(
        '00:00:00,000',
        '00:00:01,000',
        '<v Speaker><c.green>A<00:00:00.500> &#x0A95; &lt;word&gt;</c></v>',
      ),
    );
    expect(result.cues[0]?.text).toBe('A ક <word>');
  });

  it('keeps Gujarati, Hindi and Sanskrit as Unicode without transliteration', () => {
    for (const text of ['નમૂનો એક', 'नमूना एक', 'उदाहरणम्']) {
      expect(readVideoCaptions(srt('00:00:00,000', '00:00:01,000', text)).cues[0]?.text).toBe(text);
    }
  });

  it('sorts overlapping cues into deterministic intervals, with at most two distinct lines', () => {
    const result = readVideoCaptions(
      '2\n00:00:02,000 --> 00:00:04,000\nSecond placeholder\n\n1\n00:00:01,000 --> 00:00:03,000\nFirst placeholder\n',
    );
    expect(result.cues).toEqual([
      { startMs: 1000, endMs: 2000, text: 'First placeholder' },
      { startMs: 2000, endMs: 3000, text: 'First placeholder\nSecond placeholder' },
      { startMs: 3000, endMs: 4000, text: 'Second placeholder' },
    ]);
  });

  it('cleans YouTube rolling automatic captions without doubling repeated words', () => {
    const result = readVideoCaptions(
      'WEBVTT\n\n00:00.000 --> 00:02.000\n<c>First placeholder</c>\n\n00:01.000 --> 00:03.000\nFirst placeholder\nSecond placeholder\n\n00:02.000 --> 00:04.000\nSecond placeholder\nThird placeholder\n',
    );
    expect(captionAt(result.cues, 1500)?.text).toBe('First placeholder\nSecond placeholder');
    expect(captionAt(result.cues, 2500)?.text).toBe('Second placeholder\nThird placeholder');
  });

  it('replaces a rolling phrase with its longer version rather than repeating the prefix', () => {
    const result = readVideoCaptions(
      '1\n00:00:00,000 --> 00:00:03,000\nFirst\n\n2\n00:00:01,000 --> 00:00:04,000\nFirst placeholder\n',
    );
    expect(captionAt(result.cues, 1500)?.text).toBe('First placeholder');
  });

  it('skips a damaged cue and reports it while retaining usable cues', () => {
    const result = readVideoCaptions(
      '1\n00:00:02,000 --> 00:00:01,000\nWrong\n\n' +
        srt('00:00:04,000', '00:00:05,000', 'Usable placeholder'),
    );
    expect(result.cues).toEqual([{ startMs: 4000, endMs: 5000, text: 'Usable placeholder' }]);
    expect(result.problem).toBeTruthy();
  });

  it.each([
    '',
    'not a caption file',
    'WEBVTT\n\nNOTE no cues',
    srt('00:99:00,000', '01:00:00,000', 'Invalid'),
  ])('reports an unreadable file without throwing (%s)', (text) => {
    const result = readVideoCaptions(text);
    expect(result.cues).toEqual([]);
    expect(result.problem).toBeTruthy();
  });

  it('rejects a huge file before parsing and bounds cue counts', () => {
    expect(readVideoCaptions('x'.repeat(MAX_CAPTION_CHARS + 1)).cues).toEqual([]);
    expect(readVideoCaptions('x'.repeat(MAX_CAPTION_CHARS + 1)).problem).toMatch(/too (big|large)/i);
    const dense = Array.from({ length: 20_001 }, (_, i) => `${i}\n00:00:00,000 --> 00:00:01,000\nx`).join(
      '\n\n',
    );
    expect(readVideoCaptions(dense).problem).toBeTruthy();
  });
});

describe('source video clock', () => {
  const cues = readVideoCaptions(
    '1\n00:00:01,000 --> 00:00:03,000\nFirst placeholder\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond placeholder',
  ).cues;

  it('uses inclusive starts, exclusive ends and leaves gaps empty', () => {
    expect(captionAt(cues, 999)).toBeNull();
    expect(captionAt(cues, 1000)?.text).toBe('First placeholder');
    expect(captionAt(cues, 3000)).toBeNull();
    expect(captionAt(cues, 4000)?.text).toBe('Second placeholder');
    expect(captionAt(cues, 6000)).toBeNull();
  });

  it('keeps the source clock through trim, pause, seek and a loop back', () => {
    const clip = { startMs: 2000, endMs: 5000 };
    expect(captionAt(cues, 1999, clip)).toBeNull();
    expect(captionAt(cues, 2000, clip)?.text).toBe('First placeholder');
    expect(captionAt(cues, 4500, clip)?.text).toBe('Second placeholder');
    expect(captionAt(cues, 4500, clip)?.text).toBe('Second placeholder');
    expect(captionAt(cues, 2000, clip)?.text).toBe('First placeholder');
    expect(captionAt(cues, 5000, clip)).toBeNull();
    expect(captionAt(cues, NaN)).toBeNull();
  });
});

describe('caption file names', () => {
  it('accepts the link worker’s exact naming contract, with no dependency on its files', () => {
    expect(captionFileInfo('Sample.mp4', 'Sample.en.srt')).toEqual({ language: 'en', automatic: false });
    expect(captionFileInfo('Sample.mp4', 'Sample.gu.auto.srt')).toEqual({ language: 'gu', automatic: true });
    expect(captionFileInfo('Sample.mp4', 'Sample.hi.vtt')).toEqual({ language: 'hi', automatic: false });
    expect(captionFileInfo('Sample.mp4', 'Sample.srt')).toEqual({ language: 'und', automatic: false });
    expect(captionFileInfo('Sample.mp4', 'Other.en.srt')).toBeNull();
    expect(captionFileInfo('Sample.mp4', 'Sample.en.srt.exe')).toBeNull();
  });
});

it('bounds the normalized timeline when many long cues overlap, before it travels to output nodes', () => {
  const stamp = (ms: number) =>
    `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  const source = Array.from(
    { length: 200 },
    (_, i) =>
      `${String(i)}\n${stamp(i * 100)} --> ${stamp((i + 32) * 100)}\nline-${String(i)} ${'x'.repeat(4000)}`,
  ).join('\n\n');
  expect(source.length).toBeLessThan(MAX_CAPTION_CHARS);
  const read = readVideoCaptions(source);
  expect(read.cues).toEqual([]);
  expect(read.problem).toBeTruthy();
});
