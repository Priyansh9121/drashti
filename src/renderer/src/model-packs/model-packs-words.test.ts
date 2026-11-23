import { describe, expect, it } from 'vitest';
import type { InstalledPackView, ModelPacksStatus, PackModelView } from '../../../shared/model-packs';
import { importingText, modelCredit, modelLine, modelPurposes, packLine } from './model-packs-words';

/* Help › Caption and Translation Models…'s words (alpha.22, cap-pack). Placeholder packs only. */

const pack: InstalledPackView = {
  id: 'placeholder-pack',
  name: 'Placeholder models',
  release: '2026.11.1',
  importedAt: Date.UTC(2026, 10, 23, 12),
  bytes: 3 * 1024 ** 3,
  models: [
    {
      id: 'gu-placeholder',
      purposes: ['captions-gu'],
      format: 'whisper-ggml',
      licences: ['MIT'],
      attributions: ['Placeholder Gujarati model, made by the tests'],
      bytes: 512 * 1024 ** 2,
    },
    {
      id: 'en-indic-placeholder',
      purposes: ['translation-en-gu', 'translation-en-hi'],
      format: 'ctranslate2',
      licences: ['MIT', 'Apache-2.0'],
      attributions: [
        'Placeholder translation model, made by the tests',
        'Placeholder vocabulary, made by the tests',
      ],
      bytes: 210 * 1024 ** 2,
    },
  ],
  licences: [{ file: 'licences/MIT.txt', licence: 'MIT' }],
  inUse: false,
  problem: null,
};

const status = (importing: ModelPacksStatus['importing']): ModelPacksStatus => ({
  packs: [],
  importing,
  problem: null,
});

describe('the caption and translation models’ words (alpha.22, cap-pack)', () => {
  it('say what an import is doing', () => {
    expect(importingText(status({ phase: 'idle' }))).toBeNull();
    expect(importingText(status({ phase: 'importing', name: null, done: 0, total: 0 }))).toBe(
      'Reading the pack’s list…',
    );
    expect(
      importingText(
        status({ phase: 'importing', name: 'Placeholder models', done: 1024 ** 3, total: 3 * 1024 ** 3 }),
      ),
    ).toBe('Copying and checking Placeholder models: 33% of 3.0 GB.');
  });

  it('say what is installed: each pack’s release, size and day, each model’s purposes, size, format and licences', () => {
    expect(packLine(pack, 'en-AU')).toBe('Release 2026.11.1, 2 models, 3.0 GB, imported 23 November 2026');
    expect(packLine({ ...pack, models: pack.models.slice(0, 1) }, 'en-AU')).toMatch(
      /^Release 2026\.11\.1, 1 model,/u,
    );
    const [gu, enIndic] = pack.models as [PackModelView, PackModelView];
    expect(modelPurposes(gu)).toBe('Captions in Gujarati');
    expect(modelPurposes(enIndic)).toBe(
      'Translation from English into Gujarati; Translation from English into Hindi',
    );
    expect(modelLine(enIndic)).toBe('210.0 MB, ctranslate2, MIT and Apache-2.0 licence');
    expect(modelCredit(gu)).toBe('By Placeholder Gujarati model, made by the tests');
    expect(modelCredit(enIndic)).toBe(
      'By Placeholder translation model, made by the tests; Placeholder vocabulary, made by the tests',
    );
  });
});
