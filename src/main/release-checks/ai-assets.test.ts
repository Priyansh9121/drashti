import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_MODEL } from '../../shared/ai';

const root = join(import.meta.dirname, '../../..');
const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
describe('offline helper distribution contract', () => {
  it.each(['darwin', 'win32'])('bundles the %s target outside the application archive', (platform) => {
    expect(builder).toContain(`from: vendor/ai/${platform}-\${arch}\n      to: ai`);
  });
  it.each(['darwin-arm64', 'darwin-x64', 'win32-x64'])(
    'keeps %s preparation pins identical to the encoder without fetching during inspection',
    (target) => {
      const result = spawnSync(
        process.execPath,
        [join(root, 'scripts/fetch-ai-models.mjs'), '--target', target, '--describe'],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf8',
        },
      );
      expect(result.status).toBe(0);
      const description = JSON.parse(result.stdout) as {
        id: string;
        revision: string;
        licence: string;
        dimensions: number;
        target: string;
        files: unknown;
        packages: { native: string[]; common: string[]; tokenizer: string[] };
      };
      expect(description).toMatchObject({
        id: AI_MODEL.id,
        revision: AI_MODEL.revision,
        licence: 'MIT',
        dimensions: AI_MODEL.dimensions,
        target,
        files: AI_MODEL.files,
      });
      expect(description.packages.native.slice(0, 2)).toEqual([
        'onnxruntime-node',
        target === 'darwin-x64' ? '1.23.2' : '1.30.0',
      ]);
      expect(description.packages.common[1]).toBe(description.packages.native[1]);
      expect(description.packages.tokenizer.slice(0, 2)).toEqual(['@huggingface/tokenizers', '0.2.0']);
    },
  );
});
