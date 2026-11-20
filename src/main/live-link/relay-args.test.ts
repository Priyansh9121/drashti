import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_PLAYLIST, LOCAL_SEGMENT, RELAY_PROTOCOLS, relayArgs } from './relay-args';

/** The value given after an option, or null. */
const after = (args: string[], option: string): string | null => {
  const i = args.indexOf(option);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

const DIR = join('placeholder', 'Stream links', 'abc');

describe('the stream link’s FFmpeg', () => {
  it('may open the web only, for the link and whatever its playlists name: never a file or a pipe', () => {
    const args = relayArgs({
      url: 'https://media.example.org/live.m3u8',
      program: null,
      dir: DIR,
      again: false,
    });
    expect(after(args, '-protocol_whitelist')).toBe(RELAY_PROTOCOLS);
    expect(RELAY_PROTOCOLS.split(',').sort()).toEqual(['crypto', 'http', 'https', 'tcp', 'tls']);
    // Before the input, so it holds for it.
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
    expect(after(args, '-i')).toBe('https://media.example.org/live.m3u8');
  });

  it('copies the picture and its sound as they come, never decoding or encoding, starting near live', () => {
    const args = relayArgs({
      url: 'https://media.example.org/live.m3u8',
      program: null,
      dir: DIR,
      again: false,
    });
    expect(after(args, '-c')).toBe('copy');
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('-vf');
    expect(after(args, '-live_start_index')).toBe('-3');
    // It must have a picture; its sound if it has one.
    expect(args.filter((_a, i) => args[i - 1] === '-map')).toEqual(['0:v:0', '0:a:0?']);
  });

  it('takes a master playlist’s chosen variant by its program', () => {
    const args = relayArgs({
      url: 'https://media.example.org/master.m3u8',
      program: 2,
      dir: DIR,
      again: false,
    });
    expect(args.filter((_a, i) => args[i - 1] === '-map')).toEqual(['0:p:2:v:0', '0:p:2:a:0?']);
  });

  it('writes a short local HLS of MPEG-TS segments in its own folder, about six of them, the older deleted', () => {
    const args = relayArgs({
      url: 'https://media.example.org/live.m3u8',
      program: null,
      dir: DIR,
      again: false,
    });
    expect(after(args, '-f')).toBe('hls');
    expect(after(args, '-hls_list_size')).toBe('6');
    expect(after(args, '-hls_segment_filename')).toBe(join(DIR, 'seg-%06d.ts'));
    expect(args.at(-1)).toBe(join(DIR, LOCAL_PLAYLIST));
    const flags = after(args, '-hls_flags')?.split('+') ?? [];
    expect(flags).toEqual(expect.arrayContaining(['delete_segments', 'omit_endlist', 'temp_file']));
    // Never fragmented MP4 (it does not play on Windows' screens: x47's probe).
    expect(args).not.toContain('-hls_segment_type');
    expect(LOCAL_SEGMENT.test('seg-000042.ts')).toBe(true);
    expect(LOCAL_SEGMENT.test('seg-000042.ts.tmp')).toBe(false);
    expect(LOCAL_SEGMENT.test('../seg-000042.ts')).toBe(false);
  });

  it('started again after a drop, carries the local playlist on, the gap marked', () => {
    const first = after(
      relayArgs({ url: 'https://e.org/l.m3u8', program: null, dir: DIR, again: false }),
      '-hls_flags',
    );
    const again = after(
      relayArgs({ url: 'https://e.org/l.m3u8', program: null, dir: DIR, again: true }),
      '-hls_flags',
    );
    expect(first?.split('+')).not.toContain('append_list');
    expect(again?.split('+')).toEqual(expect.arrayContaining(['append_list', 'discont_start']));
  });

  it('asks with the user agent given, and FFmpeg’s own otherwise', () => {
    const plain = relayArgs({ url: 'https://e.org/l.m3u8', program: null, dir: DIR, again: false });
    expect(plain).not.toContain('-user_agent');
    const asked = relayArgs({
      url: 'https://e.org/l.m3u8',
      program: null,
      dir: DIR,
      again: false,
      userAgent: 'Placeholder/1.0',
    });
    expect(after(asked, '-user_agent')).toBe('Placeholder/1.0');
  });
});
