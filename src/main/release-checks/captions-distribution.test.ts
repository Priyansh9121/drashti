import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';

const root = join(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('Live captions distribution', () => {
  it.each(['darwin', 'win32'])('ships Whisper for %s without offline helper resources', (platform) => {
    const builder = read('electron-builder.yml');
    expect(builder.includes(`from: vendor/whisper/${platform}-\${arch}\n      to: whisper`)).toBe(true);
    expect(builder.includes(`from: vendor/ai/${platform}-\${arch}`)).toBe(false);
  });

  it.each(['ci', 'release'])('does not fetch offline helper resources in %s', (workflow) => {
    expect(read(`.github/workflows/${workflow}.yml`).includes('fetch-ai-models.mjs')).toBe(false);
  });

  it('exposes Live captions and typed Books without helper channels', () => {
    expect(IPC).toHaveProperty('captions');
    expect(IPC).toHaveProperty('shastra.search');
    expect(IPC).not.toHaveProperty('ai');
    expect(IPC).not.toHaveProperty('aiSpeech');
  });
});
