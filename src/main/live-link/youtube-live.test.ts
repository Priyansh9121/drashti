import { describe, expect, it } from 'vitest';
import { youtubeLiveStream } from './youtube-live';

/*
 * Made-up answers only, shaped as yt-dlp 2026.11.23's --dump-single-json gives them for a live video (placeholder ids,
 * example.org addresses): no real video, channel or stream is named here.
 */

const hls = (height: number, vcodec: string, extra: Record<string, unknown> = {}) => ({
  format_id: String(height),
  protocol: 'm3u8_native',
  url: `https://manifest.example.org/hls/${String(height)}/index.m3u8`,
  height,
  vcodec,
  acodec: 'mp4a.40.2',
  tbr: height * 4,
  ...extra,
});

const answer = (fields: Record<string, unknown>) =>
  JSON.stringify({ id: 'AAAAAAAAAAA', title: 'Placeholder live', ...fields });

describe('a YouTube live link, from yt-dlp’s look', () => {
  it('takes the HLS stream of picture and sound together, H.264, the tallest no taller than 1080 lines', () => {
    const json = answer({
      live_status: 'is_live',
      formats: [
        hls(360, 'avc1.4d401e'),
        hls(720, 'avc1.4d401f'),
        hls(1080, 'avc1.640028'),
        hls(1440, 'vp09.00.40.08'),
        hls(2160, 'avc1.640033'),
        // A picture-only DASH stream and a sound-only one are never taken.
        {
          format_id: '299',
          protocol: 'https',
          url: 'https://example.org/dash',
          height: 1080,
          vcodec: 'avc1',
          acodec: 'none',
        },
        {
          format_id: '140',
          protocol: 'm3u8_native',
          url: 'https://example.org/a.m3u8',
          vcodec: 'none',
          acodec: 'mp4a.40.2',
        },
      ],
    });
    expect(youtubeLiveStream(json)).toEqual({
      ok: true,
      url: 'https://manifest.example.org/hls/1080/index.m3u8',
      title: 'Placeholder live',
    });
    expect(youtubeLiveStream(json, 720)).toMatchObject({
      ok: true,
      url: 'https://manifest.example.org/hls/720/index.m3u8',
    });
  });

  it('says plainly when the video is not live now, not started, or ended', () => {
    const say = (fields: Record<string, unknown>) => {
      const r = youtubeLiveStream(answer({ formats: [hls(720, 'avc1.4d401f')], ...fields }));
      return r.ok ? null : r.problem;
    };
    expect(say({ live_status: 'not_live' })).toBe('not-live');
    expect(say({})).toBe('not-live');
    expect(say({ live_status: 'is_upcoming' })).toBe('upcoming');
    expect(say({ live_status: 'was_live' })).toBe('ended');
    expect(say({ live_status: 'post_live' })).toBe('ended');
    // yt-dlp's older word for it.
    expect(say({ is_live: true })).toBeNull();
  });

  it('says so when it gives no stream Drashti can show, or an answer that cannot be read', () => {
    const none = youtubeLiveStream(answer({ live_status: 'is_live', formats: [] }));
    expect(none).toMatchObject({ ok: false, problem: 'no-stream' });
    const web = youtubeLiveStream(
      answer({
        live_status: 'is_live',
        formats: [hls(720, 'avc1.4d401f', { url: 'file:///etc/placeholder.m3u8' })],
      }),
    );
    expect(web).toMatchObject({ ok: false, problem: 'no-stream' });
    expect(youtubeLiveStream('not json')).toMatchObject({ ok: false, problem: 'changed' });
    expect(youtubeLiveStream('[]')).toMatchObject({ ok: false, problem: 'changed' });
    const r = youtubeLiveStream(answer({ live_status: 'is_upcoming' }));
    expect(r.ok ? '' : r.message).toBe(
      'That YouTube live stream has not started yet. Show it again once it is live.',
    );
  });
});
