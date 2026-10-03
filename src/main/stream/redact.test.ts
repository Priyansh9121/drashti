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
});
