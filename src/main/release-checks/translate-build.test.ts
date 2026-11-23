import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCES, TARGETS } from '../../../scripts/fetch-translate.mjs';
import { HELPER_PROTOCOL } from '../translation/translation-helper';

/*
 * Prepare translations' engine (alpha.22, a22-mt; the owner's "Yes, bundle all three"): drashti-translate built from
 * CTranslate2's and SentencePiece's official sources, each download pinned to its SHA-256 (scripts/fetch-translate.mjs);
 * their licences in LICENSES/translation/; the program alone in each installer; built in CI's full runs and in the
 * release build (never from a cache there), and started in each packaged app (scripts/check-ffmpeg.mjs).
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the translation engine’s pinned sources and packaging (alpha.22)', () => {
  it('pins every source to an official GitHub download and its SHA-256', () => {
    expect(SOURCES.map((s) => s.name)).toEqual([
      'CTranslate2-4.9.1.tar.gz',
      'ruy-363f2522.tar.gz',
      'cpuinfo-082deffc.tar.gz',
      'cpu_features-8a494eb1.tar.gz',
      'spdlog-76fb40d9.tar.gz',
      'sentencepiece-0.2.1.tar.gz',
    ]);
    for (const s of SOURCES) {
      expect(s.url, s.name).toMatch(
        /^https:\/\/github\.com\/(OpenNMT\/CTranslate2|google\/ruy|pytorch\/cpuinfo|google\/cpu_features|gabime\/spdlog|google\/sentencepiece)\//u,
      );
      expect(s.sha256, s.name).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(Object.keys(TARGETS)).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
  });

  it('keeps every licence text, named in the notice', () => {
    const notice = read('LICENSES/translation/README.md');
    for (const file of [
      'CTranslate2-LICENSE.txt',
      'ctranslate2-third-party-headers.txt',
      'ruy-LICENSE.txt',
      'cpuinfo-LICENSE.txt',
      'cpu_features-LICENSE.txt',
      'spdlog-LICENSE.txt',
      'fmt-LICENSE.txt',
      'sentencepiece-LICENSE.txt',
      'protobuf-lite-LICENSE.txt',
      'abseil-LICENSE.txt',
      'darts-clone-LICENSE.txt',
      'IndicTransToolkit-LICENSE.txt',
      'indic-nlp-library-LICENSE.txt',
      'sacremoses-LICENSE.txt',
    ]) {
      expect(existsSync(join(root, 'LICENSES', 'translation', file)), file).toBe(true);
      expect(notice, file).toContain(file);
    }
    for (const pin of ['v4.9.1', '363f2522', '082deffc', '8a494eb1', '76fb40d9', 'v0.2.1'])
      expect(notice).toContain(pin);
  });

  it('puts the program alone in each installer, and starts it in each packaged app', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(
      /- from: vendor\/translate\/darwin-\$\{arch\}\n\s+to: translate\n\s+filter: \[drashti-translate\]/u,
    );
    expect(builder).toMatch(
      /- from: vendor\/translate\/win32-\$\{arch\}\n\s+to: translate\n\s+filter: \[drashti-translate\.exe\]/u,
    );
    expect(read('scripts/check-ffmpeg.mjs')).toContain('checkTranslate(label, command, args)');
  });

  it('builds it in CI’s full runs and in the release, the release never from a cache', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('run: node scripts/fetch-translate.mjs\n');
    expect(ci).toContain('run: node scripts/fetch-translate.mjs --target darwin-x64');
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('run: node scripts/fetch-translate.mjs\n');
    expect(release).toContain('run: node scripts/fetch-translate.mjs --target darwin-x64');
    expect(release).not.toContain('vendor/translate');
  });

  it('builds the helper from Drashti’s own source, which speaks the protocol the app expects', () => {
    const source = read('tools/translate/drashti-translate.cc');
    expect(source).toContain(`constexpr int kProtocol = ${String(HELPER_PROTOCOL)};`);
    expect(read('tools/translate/CMakeLists.txt')).toContain('set(WITH_MKL OFF');
  });
});
