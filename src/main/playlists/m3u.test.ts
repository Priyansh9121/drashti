import { describe, expect, it } from 'vitest';
import { parseM3u, writeM3u } from './m3u';

describe('M3U local files only', () => {
  it('reads a BOM, CRLF, comments, EXTINF, relative paths and file URLs, in order', () => {
    expect(
      parseM3u(
        '\uFEFF#EXTM3U\r\n# a comment\r\n#EXTINF:10.5,Placeholder one\r\none.mp4\r\nfile:///tmp/Placeholder%20two.wav\r\n/tmp/three.png\r\n',
        '/tmp/list.m3u',
      ),
    ).toEqual({
      entries: [
        { path: '/tmp/one.mp4', title: 'Placeholder one', durationMs: 10500 },
        { path: '/tmp/Placeholder two.wav', title: null, durationMs: null },
        { path: '/tmp/three.png', title: null, durationMs: null },
      ],
      notTaken: [],
    });
  });
  it('uses the playlist’s Windows path form on either computer, including drive paths and UNC', () => {
    const result = parseM3u(
      'one.mp3\nC:\\Clips\\two.mp4\nfile:///C:/Clips/Placeholder%20three.wav\n\\\\host\\share\\four.wav',
      'C:\\Lists\\set.m3u8',
    );
    expect(result.entries.map((i) => i.path)).toEqual([
      'C:\\Lists\\one.mp3',
      'C:\\Clips\\two.mp4',
      'C:\\Clips\\Placeholder three.wav',
      '\\\\host\\share\\four.wav',
    ]);
  });
  it('lists web addresses and other protocols as not taken, never as import paths', () => {
    const result = parseM3u(
      '#EXTINF:5,Placeholder web\nhttps://example.invalid/live.m3u8\nhttp://example.invalid/a.mp3\nrtsp://example.invalid/a\ndata:audio/wav,abc\nlocal.wav',
      '/tmp/list.m3u',
    );
    expect(result.entries.map((i) => i.path)).toEqual(['/tmp/local.wav']);
    expect(result.entries[0]?.title).toBeNull();
    expect(result.notTaken.map((i) => i.entry)).toEqual([
      'https://example.invalid/live.m3u8',
      'http://example.invalid/a.mp3',
      'rtsp://example.invalid/a',
      'data:audio/wav,abc',
    ]);
  });
  it('accepts exactly 2,000 entries and refuses any more, counting web entries too', () => {
    expect(
      parseM3u(Array.from({ length: 2000 }, () => 'a.wav').join('\n'), '/tmp/list.m3u').entries,
    ).toHaveLength(2000);
    expect(() =>
      parseM3u(Array.from({ length: 2001 }, () => 'https://example.invalid/a').join('\n'), '/tmp/list.m3u'),
    ).toThrow(/2,000/u);
  });
  it('refuses more than 1 MB of UTF-8, including multibyte words', () => {
    expect(() => parseM3u('#' + 'a'.repeat(1024 * 1024), '/tmp/list.m3u')).toThrow(/1 MB/u);
    expect(() => parseM3u('#' + 'é'.repeat(524288), '/tmp/list.m3u')).toThrow(/1 MB/u);
  });
  it('writes names and lengths and full library paths, and presentations as comments', () => {
    expect(
      writeM3u([
        { path: '/Library/Media/a.mp4', label: 'Placeholder video', durationMs: 10500 },
        { label: 'Placeholder presentation' },
        { path: 'C:\\Media\\b.wav', label: 'Placeholder sound' },
      ]),
    ).toBe(
      '#EXTM3U\n#EXTINF:10.5,Placeholder video\n/Library/Media/a.mp4\n# Presentation: Placeholder presentation\n#EXTINF:-1,Placeholder sound\nC:\\Media\\b.wav\n',
    );
  });
});
