import { describe, expect, it } from 'vitest';
import { checkStreamLink, streamLinkName } from './live-link';

/*
 * Made-up links only: no real stream, channel or video is named here (example.org and placeholder video ids).
 */

const message = (r: ReturnType<typeof checkStreamLink>) => (r.ok ? '' : r.message);

describe('checking a pasted stream link (Show a Stream Link…)', () => {
  it('takes an https or http link to an HLS playlist, as it is, and names it by its host', () => {
    const https = checkStreamLink('  https://Media.Example.org/live/placeholder/index.m3u8?token=abc  \n');
    expect(https).toEqual({
      ok: true,
      kind: 'hls',
      url: 'https://media.example.org/live/placeholder/index.m3u8?token=abc',
      host: 'media.example.org',
    });
    // An encoder on the mandir's own network often gives a plain http link (its address and a port).
    const local = checkStreamLink('http://192.168.1.20:8080/hls/stream.M3U8');
    expect(local).toMatchObject({ ok: true, kind: 'hls', host: '192.168.1.20' });
    if (local.ok) expect(streamLinkName(local)).toBe('192.168.1.20');
  });

  it('takes a YouTube video’s link in the shapes its Share button gives, as the video’s own page', () => {
    for (const link of [
      'https://youtu.be/AAAAAAAAAAA?si=placeholder',
      'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=30',
      'https://www.youtube.com/live/AAAAAAAAAAA?feature=share',
      'https://m.youtube.com/watch?v=AAAAAAAAAAA',
    ]) {
      const r = checkStreamLink(link);
      expect(r, link).toEqual({
        ok: true,
        kind: 'youtube',
        url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
        host: 'youtube.com',
      });
      if (r.ok) expect(streamLinkName(r)).toBe('YouTube live');
    }
  });

  it('refuses what is not a stream link, saying what to paste', () => {
    expect(message(checkStreamLink(''))).toBe('Paste a link first.');
    expect(message(checkStreamLink('   '))).toBe('Paste a link first.');
    expect(message(checkStreamLink('not a link'))).toContain('That is not a link.');
    expect(message(checkStreamLink('https://example.org/video.mp4'))).toContain('does not end in .m3u8');
    expect(message(checkStreamLink('https://example.org/watch'))).toContain('.m3u8');
    expect(message(checkStreamLink(`https://example.org/${'a'.repeat(2100)}.m3u8`))).toContain('too long');
    // A YouTube page that is not one video is refused in YouTube's own words.
    expect(message(checkStreamLink('https://www.youtube.com/playlist?list=PLplaceholder'))).toContain(
      'That is a playlist.',
    );
    expect(message(checkStreamLink('https://www.youtube.com/@placeholder'))).toContain('not a video');
  });

  it('refuses every address but a web one, and a link with a name and password in it', () => {
    for (const link of [
      'rtmp://example.org/live/placeholder.m3u8',
      'srt://example.org:9000/placeholder.m3u8',
      'file:///Users/placeholder/stream.m3u8',
      'ftp://example.org/stream.m3u8',
      'data:application/vnd.apple.mpegurl,#EXTM3U',
    ])
      expect(message(checkStreamLink(link)), link).toContain('starts with https:// or http://');
    expect(message(checkStreamLink('https://someone:secret@example.org/live.m3u8'))).toContain(
      'name and password',
    );
  });
});
