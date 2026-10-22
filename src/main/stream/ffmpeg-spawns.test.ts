import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every FFmpeg Drashti starts gets the stream's clean environment (Session 31, MED-6; ./worker/ffmpeg-env.ts):
 * the conversions, Save as MP4's keyframe listing, the phones' previews, the self-test and the stream's own.
 * The conversion test (src/main/convert/convert.test.ts) shows it from the outside with FFREPORT; this
 * reads every place that starts one, so a new spawn cannot forget it.
 */

const FILES = [
  'src/main/convert/convert-service.ts',
  // Reading what a file holds, for a conversion and (Session 50) each video and sound at import.
  'src/main/convert/read-info.ts',
  'src/main/convert/trim-saves.ts',
  'src/main/network/previews.ts',
  'src/main/stream/ffmpeg-selftest.ts',
  'src/main/stream/worker/pipeline.ts',
  'src/main/stream/worker/encoders.ts',
];

/** Each `spawn(`, `spawnSync(` or `execFile(` call in the text, up to its closing parenthesis. */
function calls(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\b(?:spawn|spawnSync|execFile)\(/gu)) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    found.push(text.slice(m.index, end + 1));
  }
  return found;
}

describe('FFmpeg’s environment', () => {
  it('is the clean one wherever Drashti starts FFmpeg', () => {
    let seen = 0;
    for (const file of FILES) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      for (const call of calls(text)) {
        seen++;
        expect(call, `${file}: ${call.slice(0, 80)}`).toMatch(/env: ffmpegEnv\(/u);
      }
    }
    // The conversion's probe, conversion and file saving, the keyframe listing, a preview, the self-test,
    // the stream's encoder, its connections and its encoder test.
    expect(seen).toBeGreaterThanOrEqual(9);
  });
});
