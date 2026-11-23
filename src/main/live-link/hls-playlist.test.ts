import { describe, expect, it } from 'vitest';
import { chooseVariant, playableCodecs, readPlaylist } from './hls-playlist';

/*
 * Made-up playlists only (example.org): what a stream link's playlist says before Drashti's FFmpeg receives it.
 */

const BASE = 'https://media.example.org/live/placeholder/master.m3u8';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"',
  '360p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2"',
  '2160p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  'https://cdn.example.org/1080p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="hvc1.2.4.L123.B0,mp4a.40.2"',
  '1080p-hevc/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  '720p/index.m3u8',
  '',
].join('\n');

const LIVE = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-TARGETDURATION:2',
  '#EXT-X-MEDIA-SEQUENCE:120',
  '#EXTINF:2.000,',
  'seg-120.ts',
  '#EXTINF:2.000,',
  'seg-121.ts',
  '#EXTINF:2.000,',
  'seg-122.ts',
].join('\r\n');

describe('a stream link’s playlist, read before its FFmpeg starts', () => {
  it('reads a master playlist’s variants in their order, each address made whole, with its height and codecs', () => {
    const read = readPlaylist(MASTER, BASE);
    expect(read.kind).toBe('master');
    if (read.kind !== 'master') return;
    expect(read.variants.map((v) => [v.index, v.url, v.height, v.bandwidth])).toEqual([
      [0, 'https://media.example.org/live/placeholder/360p/index.m3u8', 360, 800000],
      [1, 'https://media.example.org/live/placeholder/2160p/index.m3u8', 2160, 12000000],
      [2, 'https://cdn.example.org/1080p/index.m3u8', 1080, 5000000],
      [3, 'https://media.example.org/live/placeholder/1080p-hevc/index.m3u8', 1080, 6000000],
      [4, 'https://media.example.org/live/placeholder/720p/index.m3u8', 720, 2500000],
    ]);
    // A quoted list keeps its commas.
    expect(read.variants[0]?.codecs).toBe('avc1.4d401e,mp4a.40.2');
  });

  it('reads a media playlist still going as live, and one with an end (or a VOD one) as ended', () => {
    expect(readPlaylist(LIVE, BASE)).toEqual({ kind: 'media', ended: false, segments: 3, targetSeconds: 2 });
    expect(readPlaylist(`${LIVE}\r\n#EXT-X-ENDLIST\r\n`, BASE)).toMatchObject({ kind: 'media', ended: true });
    const vod = LIVE.replace('#EXT-X-VERSION:6', '#EXT-X-VERSION:6\r\n#EXT-X-PLAYLIST-TYPE:VOD');
    expect(readPlaylist(vod, BASE)).toMatchObject({ kind: 'media', ended: true });
    // An EVENT playlist is still going until its end comes.
    const event = LIVE.replace('#EXT-X-VERSION:6', '#EXT-X-VERSION:6\r\n#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(readPlaylist(event, BASE)).toMatchObject({ kind: 'media', ended: false });
  });

  it('reads anything that is not an HLS playlist as not one (a web page, a video file, a byte-order mark kept)', () => {
    expect(readPlaylist('<!doctype html><title>Placeholder</title>', BASE)).toEqual({ kind: 'not-hls' });
    expect(readPlaylist('', BASE)).toEqual({ kind: 'not-hls' });
    expect(readPlaylist(`\uFEFF${LIVE}`, BASE)).toMatchObject({ kind: 'media' });
  });
});

describe('which variant Drashti receives', () => {
  it('takes H.264 at the tallest no taller than 1080 lines: never a 4K picture, never HEVC while H.264 is offered', () => {
    const read = readPlaylist(MASTER, BASE);
    if (read.kind !== 'master') throw new Error('a master playlist expected');
    expect(chooseVariant(read.variants)?.index).toBe(2);
    expect(chooseVariant(read.variants, 720)?.index).toBe(4);
  });

  it('takes the shortest when every variant is taller, and the highest bandwidth when none gives a height', () => {
    const tall = readPlaylist(MASTER, BASE);
    if (tall.kind !== 'master') throw new Error('a master playlist expected');
    expect(chooseVariant(tall.variants, 240)?.index).toBe(0);
    const unsized = readPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=900000',
        'low.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3000000',
        'high.m3u8',
      ].join('\n'),
      BASE,
    );
    if (unsized.kind !== 'master') throw new Error('a master playlist expected');
    expect(chooseVariant(unsized.variants)?.url).toBe('https://media.example.org/live/placeholder/high.m3u8');
  });

  it('never takes a variant whose address is not a web one', () => {
    const read = readPlaylist(
      ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1', 'file:///etc/placeholder.m3u8'].join('\n'),
      BASE,
    );
    if (read.kind !== 'master') throw new Error('a master playlist expected');
    expect(chooseVariant(read.variants)).toBeNull();
  });

  it('knows the codecs every screen plays', () => {
    expect(playableCodecs(null)).toBe(true);
    expect(playableCodecs('avc1.64001f,mp4a.40.2')).toBe(true);
    expect(playableCodecs('avc3.640028')).toBe(true);
    expect(playableCodecs('hvc1.2.4.L123.B0,mp4a.40.2')).toBe(false);
    expect(playableCodecs('av01.0.08M.08,opus')).toBe(false);
  });
});
