import { describe, expect, it } from 'vitest';
import { HIDDEN_KEY, redact } from './redact';

/* A made-up key: never a real one. */
const KEY = 'test-made-up-key-0000-aaaa';

describe('redacting FFmpeg’s words', () => {
  it('hides the key wherever it is, and the key part of any RTMP address', () => {
    const line = `[rtmps @ 0x1] Failed to connect to rtmps://a.rtmps.youtube.com/live2/${KEY}: Connection refused`;
    expect(redact(line, [KEY])).toBe(
      `[rtmps @ 0x1] Failed to connect to rtmps://a.rtmps.youtube.com/live2/${HIDDEN_KEY}: Connection refused`,
    );
    expect(redact(`key=${KEY} and ${encodeURIComponent(KEY)}`, [KEY])).not.toContain(KEY);
    // Without being told the key, an address still loses everything after its first folder.
    expect(redact('rtmp://127.0.0.1:1935/live2/anything-here')).toBe(
      `rtmp://127.0.0.1:1935/live2/${HIDDEN_KEY}`,
    );
    expect(redact('rtmp://127.0.0.1:1935/live2')).toBe('rtmp://127.0.0.1:1935/live2');
  });

  it('hides a made-up key of Facebook’s shape (decision 19), on its own, in Facebook’s address and as -rtmp_playpath', () => {
    const facebook = 'FB-1234567890123456-0-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv_Wx-Yz1Ab2Cd3Ef4Gh5Ij6Kl7';
    const lines = [
      `the key ${facebook} alone`,
      `[out#0/flv @ 0x1] Error opening output rtmps://live-api-s.facebook.com:443/rtmp/${facebook}: I/O error`,
      `ffmpeg -rtmp_playpath ${facebook} rtmps://live-api-s.facebook.com:443/rtmp`,
    ];
    for (const line of lines) {
      const out = redact(line, [facebook]);
      expect(out, line).not.toContain(facebook);
      expect(out).toContain(HIDDEN_KEY);
    }
    // In an address even when the key is not known (a line from somewhere else).
    expect(redact(lines[1] ?? '')).not.toContain(facebook);
  });

  it('leaves a line already redacted as it is: the key shows hidden once, not "[stream key] key]"', () => {
    // FFmpeg's connection lines are redacted, then redacted again on their way to the log.
    const line = `[tls @ 0x2] Connection to rtmps://a.rtmps.youtube.com/live2/${KEY}`;
    for (const keys of [[KEY], []]) {
      const twice = redact(redact(line, keys), keys);
      expect(twice).toBe(`[tls @ 0x2] Connection to rtmps://a.rtmps.youtube.com/live2/${HIDDEN_KEY}`);
      expect(twice.split(HIDDEN_KEY)).toHaveLength(2);
    }
    expect(redact(`rtmp://127.0.0.1:1935/live2/${HIDDEN_KEY}: Broken pipe`)).toBe(
      `rtmp://127.0.0.1:1935/live2/${HIDDEN_KEY}: Broken pipe`,
    );
  });
});
